import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "../prisma";
import { env } from "../env";
import { dateKeyOf } from "../date";
import { currentPeriod, shiftPeriod, READING_TZ } from "../meter-readings";
import { getMeterSnap } from "./meter-cache";
import { logAudit, type AuditActor } from "./audit";
import {
  ONEC_SOURCE,
  SUBSCRIBER_TYPE,
  oneCSourceOf,
  parseConfirmedCount,
  type FailedItem,
  type OneCDocument,
  type OneCSource,
  type PingResult,
  type SendLogEntry,
  type SendBatchLog,
  type SendPreview,
  type SendResult,
  type SourceCount,
} from "../onec-readings";

/**
 * Trimiterea citirilor către 1C (serviciul `to1c`): documentele „Introducerea indicilor contoarelor pentru un abonat”, câte unul pentru fiecare
 * abonat + sursă + zi. Sursele (Контролер / Абонент / LoRaWAN / Расчетный / Акт) nu se amestecă niciodată într-un document.
 *
 * Se trimit într-o LISTĂ (loturi de BATCH documente); serviciul întoarce lungimea listei primite. Dacă lungimea întoarsă e egală cu a celei trimise, citirile lotului
 * se marchează ca trimise (`sent1cAt` / `sent1cValue`) și nu se mai trimit; altfel lotul rămâne „netrimis” și apare în rezultat, ca să se vadă care s-au trimis și care nu.
 * O citire corectată după trimitere (indexul diferă de `sent1cValue`) se retrimite.
 */

const REQUEST_TIMEOUT_MS = 60_000;
/** Cât timp lucrează o cerere (limita funcției e 300 s); restul se continuă cu o nouă cerere. */
const RUN_BUDGET_MS = 230_000;
const SAMPLE_DOCS = 3;
const MAX_FAILED_LISTED = 300;
const LOCK_KEY = "onec-readings-lock";
const LOCK_MS = 6 * 60_000;
/** după atâtea grupe de cereri la rând fără niciun răspuns de la 1C (conexiune / 5xx), rularea se oprește */
const MAX_DEAD_GROUPS = 2;

export const oneCReadingsConfigured = () => !!env.onecReadings.token && !!env.onecReadings.url;

const SOURCE_ORDER: OneCSource[] = [ONEC_SOURCE.CONTROLLER, ONEC_SOURCE.SUBSCRIBER, ONEC_SOURCE.LORAWAN, ONEC_SOURCE.ESTIMATED, ONEC_SOURCE.ACT];

type Pending = {
  id: string;
  meterId: string;
  contor: string;
  /** indexul exact, ca în baza de date (marcarea „trimis” se potrivește pe el) */
  raw: number;
  /** indexul trimis (3 zecimale) */
  value: number;
  readAt: Date;
  sursa: OneCSource;
  corrected: boolean;
};

type Prepared = {
  docs: { doc: OneCDocument; readings: Pending[] }[];
  periods: string[];
  /** citiri noi, netrimise încă (fără cele corectate după trimitere) */
  newReadings: number;
  /** citiri trimise deja, dar corectate după trimitere */
  correctedReadings: number;
  alreadySent: number;
  unmatched: FailedItem[];
};

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Citirile din luna curentă și din cea de dinainte, împărțite în „de trimis” / „deja trimise”, și documentele formate din cele de trimis. */
async function prepare(exclude: ReadonlySet<string> = new Set(), opts: { resend?: boolean; since?: Date | null } = {}): Promise<Prepared> {
  const cur = currentPeriod();
  const periods = [shiftPeriod(cur, 1), cur];
  const [rows, snap] = await Promise.all([
    prisma.meterReading.findMany({
      where: { period: { in: periods } },
      select: { id: true, meterId: true, contor: true, value: true, readAt: true, source: true, sent1cAt: true, sent1cValue: true },
      orderBy: { readAt: "asc" },
    }),
    getMeterSnap(),
  ]);
  const meterBy = new Map(snap.rows.map((r) => [r.id, r]));

  const pending: Pending[] = [];
  let alreadySent = 0;
  for (const r of rows) {
    const unchanged = r.sent1cAt != null && r.sent1cValue != null && same(r.sent1cValue, r.value);
    // Retrimitere completă: și citirile deja trimise (neschimbate) pleacă din nou, cu excepția celor trimise chiar în rularea curentă (rundele următoare ale aceleiași apăsări).
    const sentThisRun = !!opts.since && r.sent1cAt != null && r.sent1cAt.getTime() >= opts.since.getTime();
    if (unchanged && (!opts.resend || sentThisRun)) {
      alreadySent++;
      continue;
    }
    const isCorrected = r.sent1cAt != null && !unchanged;
    if (exclude.has(r.id)) continue;
    pending.push({ id: r.id, meterId: r.meterId, contor: r.contor, raw: r.value, value: round3(r.value), readAt: r.readAt, sursa: oneCSourceOf(r.source), corrected: isCorrected });
  }

  const unmatched: FailedItem[] = [];
  const groups = new Map<string, { head: Omit<OneCDocument, "id" | "contoare">; readings: Pending[] }>();
  for (const p of pending) {
    const m = meterBy.get(p.meterId);
    if (!m) {
      unmatched.push({ contor: p.contor, abonat: "", sursa: p.sursa, indice: p.value, reason: "Contorul nu mai e în lista din 1C." });
      continue;
    }
    const person = m.person;
    const account = (m.account ?? "").trim();
    const contract = (m.contract ?? "").trim();
    if (person ? !account : !contract) {
      unmatched.push({ contor: p.contor, abonat: m.name, sursa: p.sursa, indice: p.value, reason: person ? "Lipsește contul personal al abonatului." : "Lipsește numărul contractului." });
      continue;
    }
    const data = dateKeyOf(p.readAt, READING_TZ);
    const key = [m.clientId ?? m.name, person ? account : contract, p.sursa, data].join("|");
    let g = groups.get(key);
    if (!g) {
      g = {
        head: {
          data,
          abonat: m.name,
          tip_abonat: person ? SUBSCRIBER_TYPE.PERSON : SUBSCRIBER_TYPE.COMPANY,
          cont_personal: person ? account : null,
          nr_contract: person ? null : contract,
          sursa: p.sursa,
        },
        readings: [],
      };
      groups.set(key, g);
    }
    g.readings.push(p);
  }

  const docs = [...groups.values()]
    .sort((a, b) => SOURCE_ORDER.indexOf(a.head.sursa) - SOURCE_ORDER.indexOf(b.head.sursa) || a.head.data.localeCompare(b.head.data) || a.head.abonat.localeCompare(b.head.abonat, "ro"))
    .map((g) => {
      const ids = g.readings.map((r) => r.id).sort();
      const id = `crm-${createHash("sha1").update(ids.join(",")).digest("hex").slice(0, 16)}`;
      return { doc: { id, ...g.head, contoare: g.readings.map((r) => ({ nr_uzina: r.contor, indice: r.value })) } satisfies OneCDocument, readings: g.readings };
    });

  return { docs, periods, newReadings: pending.filter((r) => !r.corrected).length, correctedReadings: pending.filter((r) => r.corrected).length, alreadySent, unmatched };
}

function countBySource(docs: Prepared["docs"]): SourceCount[] {
  const m = new Map<OneCSource, SourceCount>();
  for (const { doc, readings } of docs) {
    const c = m.get(doc.sursa) ?? { source: doc.sursa, readings: 0, documents: 0 };
    c.readings += readings.length;
    c.documents += 1;
    m.set(doc.sursa, c);
  }
  return SOURCE_ORDER.filter((s) => m.has(s)).map((s) => m.get(s)!);
}

/** Ce s-ar trimite acum (nimic nu pleacă): numere pe surse, câte sunt deja trimise, ce nu se poate trimite și câteva documente ca exemplu. */
export async function previewSend(resend = false): Promise<SendPreview> {
  const p = await prepare(new Set(), { resend });
  return {
    configured: oneCReadingsConfigured(),
    periods: p.periods,
    pendingReadings: p.newReadings,
    correctedReadings: p.correctedReadings,
    alreadySent: p.alreadySent,
    unmatched: p.unmatched.length,
    documents: p.docs.length,
    resend,
    bySource: countBySource(p.docs),
    sample: p.docs.slice(0, SAMPLE_DOCS).map((d) => d.doc),
  };
}

function describeNetworkError(e: unknown): string {
  const err = e as { name?: string; message?: string; cause?: { code?: string } };
  const code = err?.cause?.code ?? "";
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "Serviciul 1C nu a răspuns la timp — 1C ar fi putut primi totuși lotul: verifică în 1C înainte de a retrimite.";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "Adresa serviciului 1C nu a fost găsită (DNS).";
  if (code === "ECONNREFUSED") return "Conexiune refuzată de serviciul 1C.";
  if (code === "ETIMEDOUT" || code === "EHOSTUNREACH" || code === "ENETUNREACH" || code === "UND_ERR_CONNECT_TIMEOUT") return "Serviciul 1C nu e accesibil de pe acest server.";
  if (/CERT|SSL|TLS|self.signed|unable to verify/i.test(code + " " + (err?.message ?? ""))) return "Certificatul SSL al serviciului 1C nu e valid.";
  return `Nu m-am putut conecta la serviciul 1C (${code || err?.message || "eroare necunoscută"}).`;
}

type PostOut = { ok: boolean; status: number | null; confirmed: number | null; message: string | null; ms: number; body: string | null };

const hostOf = () => {
  try {
    return new URL(env.onecReadings.url).host;
  } catch {
    return env.onecReadings.url.slice(0, 60);
  }
};

/** O cerere către serviciul 1C: lista de documente ca JSON, codul de acces în antetul `token`. Nu aruncă niciodată; nu loghează codul de acces. */
async function postList(docs: OneCDocument[]): Promise<PostOut> {
  const t0 = Date.now();
  try {
    const res = await fetch(env.onecReadings.url, {
      method: "POST",
      headers: { token: env.onecReadings.token, "content-type": "application/json; charset=utf-8", accept: "application/json, text/plain, */*" },
      body: JSON.stringify(docs),
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = (await res.text().catch(() => "")).slice(0, 2000);
    const body = text.slice(0, 300);
    const ms = Date.now() - t0;
    if (res.status === 401 || res.status === 403) return { ok: false, status: res.status, confirmed: null, message: `Serviciul 1C a respins codul de acces (${res.status}).`, ms, body };
    if (res.status >= 300 && res.status < 400) return { ok: false, status: res.status, confirmed: null, message: `Serviciul 1C redirecționează (${res.status}) către ${res.headers.get("location") ?? "altă adresă"}: pune adresa finală în ONEC_READINGS_URL.`, ms, body };
    if (!res.ok) return { ok: false, status: res.status, confirmed: null, message: `Serviciul 1C a răspuns cu eroarea ${res.status}${body ? `: ${body.slice(0, 160)}` : ""}.`, ms, body };
    const confirmed = parseConfirmedCount(text);
    if (confirmed == null) return { ok: false, status: res.status, confirmed: null, message: `Răspuns neînțeles de la 1C: „${body.slice(0, 160)}”. Verifică în 1C dacă documentele au fost primite înainte de a retrimite.`, ms, body };
    if (confirmed !== docs.length) return { ok: false, status: res.status, confirmed, message: `1C a confirmat ${confirmed} din ${docs.length} documente trimise. Verifică în 1C ce a primit înainte de a retrimite (pot fi dubluri).`, ms, body };
    return { ok: true, status: res.status, confirmed, message: null, ms, body };
  } catch (e) {
    return { ok: false, status: null, confirmed: null, message: describeNetworkError(e), ms: Date.now() - t0, body: null };
  }
}

/** Testul de conexiune: trimite o listă GOALĂ (nu creează nimic în 1C); serviciul ar trebui să răspundă 0. Arată starea HTTP, durata și răspunsul brut. */
export async function pingOneC(): Promise<PingResult> {
  if (!oneCReadingsConfigured()) return { ok: false, status: null, ms: 0, confirmed: null, body: null, message: "Lipsește ONEC_READINGS_TOKEN în setările serverului.", host: hostOf() };
  const r = await postList([]);
  console.log(`[onec-readings] test conexiune: status=${r.status ?? "-"} confirmat=${r.confirmed ?? "-"} ${r.ms}ms răspuns=${JSON.stringify(r.body ?? "")}`);
  return { ok: r.ok, status: r.status, ms: r.ms, confirmed: r.confirmed, body: r.body, message: r.message, host: hostOf() };
}

/** Marchează citirile unui lot ca trimise (cu indexul trimis): o instrucțiune per citire, condiționată de indexul trimis — o corectare făcută între timp nu se pierde. */
async function markSent(readings: Pending[]): Promise<void> {
  const when = new Date().toISOString();
  for (let i = 0; i < readings.length; i += 400) {
    const chunk = readings.slice(i, i + 400);
    await prisma.$runCommandRaw({
      update: "MeterReading",
      updates: chunk.map((r) => ({ q: { _id: { $oid: r.id }, value: r.raw }, u: { $set: { sent1cAt: { $date: when }, sent1cValue: r.raw } } })),
      ordered: false,
    });
  }
}

/** Blocare „o singură trimitere odată” (două persoane care apasă simultan ar trimite aceleași documente de două ori); expiră singură. */
async function acquireLock(): Promise<boolean> {
  const now = new Date();
  let row = await prisma.apiIntegration.findFirst({ where: { key: LOCK_KEY }, select: { id: true } });
  if (!row) row = await prisma.apiIntegration.create({ data: { key: LOCK_KEY }, select: { id: true } });
  const r = await prisma.apiIntegration.updateMany({
    where: { id: row.id, OR: [{ syncLockUntil: null }, { syncLockUntil: { isSet: false } }, { syncLockUntil: { lt: now } }] },
    data: { syncLockUntil: new Date(now.getTime() + LOCK_MS) },
  });
  return r.count === 1;
}
const releaseLock = () => prisma.apiIntegration.updateMany({ where: { key: LOCK_KEY }, data: { syncLockUntil: null } }).catch(() => {});

const trim = (s: string | null, n = 160) => (s ? s.replace(/\s+/g, " ").slice(0, n) : "");

/**
 * Trimite documentele „de trimis” în loturi (BATCH documente, câteva cereri în paralel), cât permite bugetul de timp. `exclude` = citirile din loturile eșuate la cererile
 * anterioare (nu se reîncearcă în buclă). `first` = prima cerere a seriei (doar atunci se listează citirile care nu pot fi trimise deloc).
 * Întoarce rezultatul rulării; `remaining` > 0 = mai sunt documente de trimis (se repetă cererea), `aborted` = 1C nu răspunde / refuză codul: nu se repetă.
 */
export async function sendReadings(actor: AuditActor, opts: { exclude?: string[]; budgetMs?: number; first?: boolean; resend?: boolean; since?: string | null } = {}): Promise<SendResult> {
  const runId = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  const out: SendResult = { ok: true, sent: 0, failed: 0, confirmed: 0, readingsSent: 0, remaining: 0, aborted: false, unmatched: 0, markErrors: 0, ms: 0, runId, batches: [], failedItems: [], failedReadingIds: [], bySource: [], message: null, since: null };
  if (!oneCReadingsConfigured()) {
    out.ok = false;
    out.aborted = true;
    out.message = "Trimiterea către 1C nu e configurată: lipsește ONEC_READINGS_TOKEN în setările serverului.";
    return out;
  }
  if (!(await acquireLock())) {
    out.ok = false;
    out.aborted = true;
    out.message = "O trimitere către 1C rulează deja (pornită de altcineva sau într-o altă fereastră). Așteaptă să se termine.";
    return out;
  }
  try {
    const budget = Math.min(opts.budgetMs ?? RUN_BUDGET_MS, RUN_BUDGET_MS);
    // retrimitere completă: prima cerere fixează momentul de start, rundele următoare îl primesc înapoi de la browser
    const sinceMs = opts.since ? Date.parse(opts.since) : NaN;
    const since = opts.resend ? (Number.isFinite(sinceMs) ? new Date(sinceMs) : new Date(t0)) : null;
    out.since = since ? since.toISOString() : null;
    const prep = await prepare(new Set(opts.exclude ?? []), { resend: !!opts.resend, since });
    out.unmatched = prep.unmatched.length;
    if (opts.first !== false) for (const u of prep.unmatched.slice(0, MAX_FAILED_LISTED)) out.failedItems.push(u);
    const batchSize = env.onecReadings.batch;
    const conc = env.onecReadings.concurrency;
    console.log(
      `[onec-readings] run=${runId} start${opts.resend ? " (retrimitere completă)" : ""}: ${prep.docs.length} documente, ${prep.docs.reduce((a, d) => a + d.readings.length, 0)} citiri (nou ${prep.newReadings}, corectate ${prep.correctedReadings}, deja trimise ${prep.alreadySent}, netrimisibile ${prep.unmatched.length}), lot ${batchSize} x ${conc} în paralel, utilizator ${actor.name}`,
    );

    if (prep.docs.length === 0) {
      out.message = prep.unmatched.length ? "Nu sunt documente de trimis (unele citiri nu pot fi trimise — vezi lista)." : "Nu e nimic de trimis: toate citirile sunt deja trimise.";
      out.ms = Date.now() - t0;
      return out;
    }

    const chunks: Prepared["docs"][] = [];
    for (let i = 0; i < prep.docs.length; i += batchSize) chunks.push(prep.docs.slice(i, i + batchSize));
    const sentBySource = new Map<OneCSource, SourceCount>();
    let batchNo = 0;
    let idx = 0;
    let deadGroups = 0;
    while (idx < chunks.length) {
      if (Date.now() - t0 > budget) break;
      const group = chunks.slice(idx, idx + conc);
      idx += group.length;
      const results = await Promise.all(group.map((chunk, k) => postList(chunk.map((c) => c.doc)).then((r) => ({ chunk, r, n: batchNo + k + 1 }))));
      batchNo += group.length;
      let authFail = false;
      for (const { chunk, r, n } of results) {
        const docsN = chunk.length;
        out.batches.push({ batch: n, documents: docsN, confirmed: r.confirmed, ok: r.ok, status: r.status, message: r.message, ms: r.ms, body: r.body });
        console.log(
          `[onec-readings] run=${runId} lot ${n}: ${docsN} documente, status=${r.status ?? "-"}, confirmat=${r.confirmed ?? "-"}, ${r.ms}ms, ${r.ok ? "OK" : `EȘUAT: ${trim(r.message)} răspuns=${JSON.stringify(trim(r.body, 120))}`}`,
        );
        if (r.confirmed != null) out.confirmed += r.confirmed;
        const readings = chunk.flatMap((c) => c.readings);
        if (r.ok) {
          let marked = false;
          for (let attempt = 0; attempt < 2 && !marked; attempt++) {
            try {
              await markSent(readings);
              marked = true;
            } catch (e) {
              console.error(`[onec-readings] run=${runId} lot ${n}: marcarea „trimis” a eșuat (încercarea ${attempt + 1}):`, String((e as Error)?.message ?? e).slice(0, 200));
            }
          }
          out.sent += docsN;
          out.readingsSent += readings.length;
          for (const c of chunk) {
            const sc = sentBySource.get(c.doc.sursa) ?? { source: c.doc.sursa, readings: 0, documents: 0 };
            sc.readings += c.readings.length;
            sc.documents += 1;
            sentBySource.set(c.doc.sursa, sc);
          }
          if (!marked) {
            // 1C le-a primit, dar baza de date nu a putut marca: la o nouă trimitere ar pleca din nou — se exclud din serie și se anunță clar
            out.markErrors++;
            out.ok = false;
            for (const rd of readings) out.failedReadingIds.push(rd.id);
            out.failedItems.push({ contor: `lot ${n}`, abonat: "", sursa: chunk[0].doc.sursa, indice: readings.length, reason: "1C a primit documentele, dar marcarea „trimis” a eșuat în CRM: NU retrimite acest lot (ar fi dubluri)." });
          }
        } else {
          out.failed += docsN;
          out.ok = false;
          for (const c of chunk) {
            for (const rd of c.readings) {
              out.failedReadingIds.push(rd.id);
              if (out.failedItems.length < MAX_FAILED_LISTED) out.failedItems.push({ contor: rd.contor, abonat: c.doc.abonat, sursa: c.doc.sursa, indice: rd.value, reason: r.message ?? "Netrimis." });
            }
          }
          if (r.status === 401 || r.status === 403) {
            authFail = true;
            out.message = r.message;
          }
        }
      }
      // 1C nu răspunde deloc (conexiune / 5xx) sau refuză codul: nu are rost să continuăm cu celelalte loturi
      const dead = results.every(({ r }) => r.status == null || r.status >= 500 || r.status === 401 || r.status === 403);
      deadGroups = dead ? deadGroups + 1 : 0;
      if (authFail || deadGroups >= MAX_DEAD_GROUPS) {
        out.aborted = true;
        out.message = out.message ?? results.find(({ r }) => r.message)?.r.message ?? "Serviciul 1C nu răspunde.";
        break;
      }
    }
    out.remaining = chunks.slice(idx).reduce((a, c) => a + c.length, 0);
    out.bySource = SOURCE_ORDER.filter((x) => sentBySource.has(x)).map((x) => sentBySource.get(x)!);
    if (!out.message) out.message = out.failed > 0 ? `${out.failed} documente nu au fost confirmate de 1C.` : out.remaining > 0 ? "Se continuă…" : null;
    out.ms = Date.now() - t0;
    console.log(
      `[onec-readings] run=${runId} gata în ${out.ms}ms: trimise ${out.sent} (citiri ${out.readingsSent}), confirmat de 1C ${out.confirmed}, eșuate ${out.failed}, erori de marcare ${out.markErrors}, rămase ${out.remaining}${out.aborted ? `, OPRIT: ${trim(out.message)}` : ""}`,
    );

    await prisma.oneCSendLog
      .create({
        data: {
          userId: actor.id,
          userName: actor.name,
          readings: out.readingsSent + out.failedReadingIds.length,
          documents: out.sent + out.failed,
          sent: out.sent,
          failed: out.failed,
          confirmed: out.confirmed,
          details: JSON.stringify({ runId, resend: !!opts.resend, ms: out.ms, batches: out.batches.slice(0, 200), bySource: out.bySource, failed: out.failedItems.slice(0, 100), unmatched: out.unmatched, remaining: out.remaining, aborted: out.aborted, markErrors: out.markErrors }).slice(0, 200_000),
        },
      })
      .catch((e) => console.error("[onec-readings] jurnal:", String(e?.message ?? e).slice(0, 160)));
    await logAudit(actor, {
      action: "meter.send_1c",
      module: "Meters",
      objectName: `${out.sent} documente / ${out.readingsSent} citiri`,
      newValue: `trimise ${out.sent}, confirmate de 1C ${out.confirmed}, eșuate ${out.failed}${out.remaining ? `, rămase ${out.remaining}` : ""}${out.aborted ? `, oprit: ${trim(out.message)}` : ""}`,
    }).catch(() => {});
    return out;
  } finally {
    await releaseLock();
  }
}

/** Ultimele rulări din jurnal (cele mai noi primele), pentru depanare în fereastra „Trimite către 1C”. */
export async function listSendLogs(limit = 15): Promise<SendLogEntry[]> {
  const rows = await prisma.oneCSendLog.findMany({ orderBy: { at: "desc" }, take: Math.min(50, Math.max(1, limit)) });
  return rows.map((r) => {
    let details: SendLogEntry["details"] = null;
    try {
      details = r.details ? (JSON.parse(r.details) as SendLogEntry["details"]) : null;
    } catch {
      details = null;
    }
    return { id: r.id, at: r.at.toISOString(), userName: r.userName, readings: r.readings, documents: r.documents, sent: r.sent, failed: r.failed, confirmed: r.confirmed, details };
  });
}
