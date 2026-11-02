import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { env } from "../env";
import { getMeterSnap } from "./meter-cache";
import { invalidatePortalClient } from "../portal-cache";
import { invalidateLorawanMap } from "./lorawan-map";
import { invalidatePayers } from "./payer-cache";
import { currentPeriod, shiftPeriod, READING_TZ } from "../meter-readings";
import type { DiagKind, DiagTuple, LorawanDiag } from "../lorawan";
import { LORAWAN_HOUR, LORAWAN_MINUTE, LORAWAN_SOURCE, normalizeMeterName, parseLorawan, meterDigitCores, stripLeadingZeros, type LorawanRow, type LorawanStats, type LorawanStatus } from "../lorawan";

/**
 * Extragerea contoarelor LoRaWAN: o dată pe zi, la 23:30 (ora firmei), se citește lista de la serverul de noduri (`[{ name, volume_m3, ts }]`). Pentru fiecare contor:
 *  1. numele fără „S” se caută între contoarele ACTIVE din CRM (exportul 1C); plătitorul vine odată cu contorul (același abonat ca în lista de contoare);
 *  2. dacă transmisia NU e din luna curentă (fusul firmei), contorul se ignoră (rămâne doar marcat LoRaWAN);
 *  3. altfel indexul se salvează ca citire a lunii (MeterReading, sursa „LORAWAN”): se actualizează zilnic, nu suprascrie o citire făcută de cititor și nu poate fi modificat manual.
 * Pornirea: temporizatorul serverului (instrumentation.ts), ruta /api/cron/lorawan (scheduler extern) sau butonul din pagina „LoRaWAN” (administrator).
 * Doar o extragere la un moment dat (blocaj în baza de date, valabil între instanțe); una eșuată se reia după 30 de minute.
 */

const STATE_ID = "main";
const EPOCH = new Date("1970-01-01T00:00:00.000Z");
/** Blocajul expiră singur: dacă funcția e oprită de platformă (limita de timp), după atât se poate porni din nou. */
const LOCK_MIN = 6;
/** Cât lucrează o extragere înainte să se oprească singură și să salveze ce a făcut (funcțiile Vercel au maximum 300 s); restul se continuă la următoarea pornire. */
const BUDGET_MS = 230_000;
const BULK_SIZE = 500;
const RETRY_MIN = 30;
const FETCH_TIMEOUT_MS = 60_000;
/** Dacă extragerea nu s-a terminat până aici, scrie în stare unde a rămas (platforma oprește funcția la 300 s fără să lase vreo urmă). */
const WATCHDOG_MS = 265_000;
const UNMATCHED_KEEP = 200;
/** Un contor care nu mai apare în lista LoRaWAN de atâtea zile nu mai e considerat LoRaWAN (iese din blocaj). */
const FORGET_AFTER_DAYS = 45;

/**
 * Plătitorii cu cel puțin un contor LoRaWAN primesc marcajul `meterLorawan` (filtrul „Contor LoRaWAN” din Plătitori / Notificări). Se scriu doar diferențele; dacă s-a schimbat ceva,
 * lista de plătitori din memorie se reface.
 */
async function syncPayerFlags(): Promise<void> {
  const [meters, flagged] = await Promise.all([prisma.lorawanMeter.findMany({ select: { clientId: true } }), prisma.client.findMany({ where: { meterLorawan: true }, select: { id: true } })]);
  const want = new Set(meters.map((m) => m.clientId).filter((x): x is string => !!x));
  const have = new Set(flagged.map((c) => c.id));
  const on = [...want].filter((id) => !have.has(id));
  const off = [...have].filter((id) => !want.has(id));
  const chunk = async (ids: string[], value: boolean) => {
    for (let i = 0; i < ids.length; i += 300) await prisma.client.updateMany({ where: { id: { in: ids.slice(i, i + 300) } }, data: { meterLorawan: value } });
  };
  await chunk(on, true);
  await chunk(off, false);
  if (on.length || off.length) await invalidatePayers();
}

export type Trigger = "timer" | "cron" | "manual";
export type LorawanRun = { ok: true; message: string; stats: LorawanStats } | { ok: false; error: string };

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: READING_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: READING_TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const dayKey = (d: Date) => dayFmt.format(d);
/** Minutele scurse de la miezul nopții, în fusul firmei. */
const minuteOfDay = (d: Date) => {
  const [h, m] = timeFmt.format(d).split(":").map(Number);
  return h * 60 + m;
};

export const lorawanConfigured = () => !!env.lorawan.token;

async function fetchRows(): Promise<ReturnType<typeof parseLorawan>> {
  const res = await fetch(env.lorawan.url, { headers: { token: env.lorawan.token, accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Serverul LoRaWAN a răspuns ${res.status}.`);
  return parseLorawan(await res.json());
}

/**
 * Indexurile citirilor: dacă baza de date a fost creată fără `prisma db push`, citirile nu au indexul (contor + lună) pe care îl așteaptă schema, iar fiecare căutare / upsert ar parcurge toată colecția
 * (mii de contoare × zeci de mii de citiri = minute). Se creează o singură dată, cu aceleași nume ca în schemă (o rulare viitoare de `db push` le găsește deja); dacă există, nu se întâmplă nimic.
 */
async function ensureIndexes(): Promise<void> {
  const wanted: { key: Record<string, 1>; name: string; unique?: boolean }[] = [
    { key: { meterId: 1, period: 1 }, name: "MeterReading_meterId_period_key", unique: true },
    { key: { period: 1, readAt: 1 }, name: "MeterReading_period_readAt_idx" },
  ];
  const res = (await prisma.$runCommandRaw({ listIndexes: "MeterReading" }).catch(() => null)) as { cursor?: { firstBatch?: { key: Record<string, number> }[] } } | null;
  const have = new Set((res?.cursor?.firstBatch ?? []).map((i) => JSON.stringify(i.key)));
  for (const w of wanted) {
    if (have.has(JSON.stringify(w.key))) continue;
    await prisma.$runCommandRaw({ createIndexes: "MeterReading", indexes: [{ key: w.key, name: w.name, ...(w.unique ? { unique: true } : {}) }] }).catch(async (e) => {
      console.error(`[lorawan] indexul ${w.name}:`, String(e?.message ?? e).slice(0, 160));
      // există dubluri (nu ar trebui): măcar un index obișnuit, ca să nu mai fie căutări prin toată colecția
      if (w.unique) await prisma.$runCommandRaw({ createIndexes: "MeterReading", indexes: [{ key: w.key, name: "MeterReading_meterId_period_idx" }] }).catch(() => {});
    });
  }
}

/** EJSON pentru comenzile brute MongoDB (`$runCommandRaw`): date și ObjectId. */
const D = (d: Date) => ({ $date: d.toISOString() });
const OID = (id: string | null) => (id && /^[0-9a-f]{24}$/i.test(id) ? { $oid: id } : null);

/** Trimite upsert-urile în blocuri (o comandă la 500 de documente, nu o interogare pe contor): mii de contoare se salvează în secunde, nu în minute. */
async function bulkUpsert(collection: string, updates: object[], deadline: number): Promise<{ failed: number; sent: number }> {
  let failed = 0;
  let sent = 0;
  for (let i = 0; i < updates.length && Date.now() < deadline; i += BULK_SIZE) {
    const part = updates.slice(i, i + BULK_SIZE);
    const res = (await prisma.$runCommandRaw({ update: collection, updates: part, ordered: false })) as { writeErrors?: unknown[]; ok?: number };
    failed += res.writeErrors?.length ?? 0;
    sent += part.length;
  }
  return { failed, sent };
}

async function claim(): Promise<boolean> {
  await prisma.lorawanState.upsert({ where: { id: STATE_ID }, create: { id: STATE_ID }, update: {} });
  const now = new Date();
  const r = await prisma.lorawanState.updateMany({ where: { id: STATE_ID, lockUntil: { lt: now } }, data: { lockUntil: new Date(now.getTime() + LOCK_MIN * 60_000) } });
  return r.count === 1;
}

type CrmRow = Awaited<ReturnType<typeof getMeterSnap>>["rows"][number];

/** Cum se potrivește un număr din feedul LoRaWAN cu contoarele din CRM (aceeași logică la extragere și în pagina de diagnostic). */
export type Classified = { kind: "placeholder" } | { kind: "unmatched" } | { kind: "removed" } | { kind: "found"; hits: CrmRow[]; viaSuffix: boolean };

export function buildMatcher(rows: CrmRow[], period: string): (lw: LorawanRow) => Classified {
  // contoarele CRM după număr (exact, apoi fără zerourile din față); doar cele din exportul 1C, nu rândurile „doar Axioma”
  const exact = new Map<string, CrmRow[]>();
  const loose = new Map<string, CrmRow[]>();
  // contoarele cu text lângă număr („…-wc”, „…-bc”, „… buc”, zerouri în față) după blocurile lor de cifre: se folosesc doar când numărul simplu nu există în CRM
  const decorated = new Map<string, CrmRow[]>();
  const removed = new Set<string>();
  for (const r of rows) {
    if (r.source !== "1c") continue;
    const c = normalizeMeterName(r.contor);
    if (!c) continue;
    const cores = meterDigitCores(c);
    // „simplu” = doar cifre (cu sau fără zerouri în față); orice altceva are text lângă număr
    const isPlain = /^\d+$/.test(c);
    if (r.removedAt) {
      removed.add(c);
      removed.add(stripLeadingZeros(c));
      for (const k of cores) removed.add(k);
      continue;
    }
    if (!isPlain) {
      for (const k of cores) (decorated.get(k) ?? decorated.set(k, []).get(k)!).push(r);
      continue;
    }
    (exact.get(c) ?? exact.set(c, []).get(c)!).push(r);
    const z = stripLeadingZeros(c);
    (loose.get(z) ?? loose.set(z, []).get(z)!).push(r);
  }
  return (lw) => {
    // serverul de noduri listează și contoarele care n-au transmis încă niciodată: 0 m³ la o dată fixă dintr-o altă lună (ex. 01.01, ora 00:00) — nu sunt contoare active
    if (lw.volume === 0 && currentPeriod(lw.ts) !== period) return { kind: "placeholder" };
    const z = stripLeadingZeros(lw.name);
    // fără zerourile din față doar dacă toate rândurile potrivite au același număr (altfel ar fi o potrivire nesigură)
    const lz = loose.get(z);
    const plain = exact.get(lw.name) ?? (lz && new Set(lz.map((r) => r.contor.trim())).size === 1 ? lz : undefined);
    // niciun contor cu numărul simplu: se caută cele care îl conțin (-wc, -bc, buc, zerouri în față…) — tot ale aceluiași proprietar
    const bySfx = plain?.length ? undefined : decorated.get(z);
    const hits = plain?.length ? plain : bySfx;
    if (!hits?.length) return removed.has(lw.name) || removed.has(z) ? { kind: "removed" } : { kind: "unmatched" };
    return { kind: "found", hits, viaSuffix: !!bySfx?.length };
  };
}

export const NOT_ACTIVATED_ERROR = "Extragerea LoRaWAN nu e activată. Activeaz-o din pagina LoRaWAN.";

const isActivated = async () => !!(await prisma.lorawanState.findUnique({ where: { id: STATE_ID }, select: { activatedAt: true } }))?.activatedAt;

/**
 * `activate`: prima extragere pornită de administrator („Activează”) — dacă reușește, extragerea automată (zilnic la 23:30 / ruta cron) se pornește de-acum.
 * Până la activare, temporizatorul și ruta cron nu fac nimic.
 */
export async function runLorawanSync(trigger: Trigger, opts: { activate?: boolean } = {}): Promise<LorawanRun> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  if (!lorawanConfigured()) return { ok: false, error: "Lipsește LORAWAN_TOKEN în configurația serverului." };
  if (trigger !== "manual" && !(await isActivated())) return { ok: false, error: NOT_ACTIVATED_ERROR };
  if (!(await claim())) return { ok: false, error: "O extragere LoRaWAN rulează deja." };
  const t0 = Date.now();
  const now = new Date();
  const period = currentPeriod(now);
  const day = dayKey(now);
  const scheduled = trigger !== "manual";
  let partial = false;
  // etapele: se notează în stare („În curs: …”, vizibil în pagina LoRaWAN) și în jurnal, cu durata fiecăreia — ca o blocare să se vadă unde s-a întâmplat
  const timings: string[] = [];
  let stage = "pornire";
  let stageStart = Date.now();
  const mark = async (next: string) => {
    timings.push(`${stage} ${((Date.now() - stageStart) / 1000).toFixed(1)} s`);
    stage = next;
    stageStart = Date.now();
    console.log(`[lorawan] etapa „${next}” (după ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    await prisma.lorawanState.update({ where: { id: STATE_ID }, data: { message: `În curs: ${next}…` } }).catch(() => {});
  };
  const watchdog = setTimeout(() => {
    const message = `Oprită: nu s-a terminat în ${Math.round(WATCHDOG_MS / 1000)} s, a rămas la etapa „${stage}” (de ${Math.round((Date.now() - stageStart) / 1000)} s). ${timings.join(", ")}`;
    console.error(`[lorawan] ${message}`);
    void prisma.lorawanState.update({ where: { id: STATE_ID }, data: { lastRunAt: new Date(), lastOk: false, lastTrigger: trigger, message: message.slice(0, 400), durationMs: Date.now() - t0, lockUntil: EPOCH, ...(scheduled ? { retryAt: new Date(Date.now() + 60_000) } : {}) } }).catch(() => {});
  }, WATCHDOG_MS);
  try {
    await mark("descărcarea listei LoRaWAN");
    const parsed = await fetchRows();
    await mark("lista de contoare din CRM");
    const snap = await getMeterSnap();
    await mark("potrivirea cu contoarele din CRM");
    const classify = buildMatcher(snap.rows, period);
    const stats: LorawanStats = { received: parsed.rows.length + parsed.invalid + parsed.duplicates, invalid: parsed.invalid, placeholders: 0, stale: 0, matched: 0, removed: 0, unmatched: 0, noPayer: 0, bySuffix: 0, ambiguous: 0, saved: 0, unchanged: 0, skippedField: 0, lowerThanPrev: 0, errors: 0 };
    const unmatched: string[] = [];
    const known: { row: CrmRow; lw: LorawanRow; current: boolean }[] = [];
    for (const lw of parsed.rows) {
      const c = classify(lw);
      if (c.kind === "placeholder") {
        stats.placeholders++;
        continue;
      }
      if (c.kind === "removed") {
        stats.removed++;
        continue;
      }
      if (c.kind === "unmatched") {
        stats.unmatched++;
        if (unmatched.length < UNMATCHED_KEEP) unmatched.push(lw.name);
        continue;
      }
      if (c.viaSuffix) stats.bySuffix++;
      const hits = c.hits;
      if (new Set(hits.map((r) => r.clientId ?? r.id)).size > 1) stats.ambiguous++;
      const current = currentPeriod(lw.ts) === period;
      if (!current) stats.stale++;
      else stats.matched++;
      // același număr de contor la mai multe rânduri (abonați / consumatori diferiți): toate se marchează LoRaWAN; citirea o primește fiecare rând
      for (const row of hits) {
        known.push({ row, lw, current });
        if (current && !row.clientId) stats.noPayer++;
      }
    }

    await mark("verificarea indexurilor");
    await ensureIndexes();
    await mark("citirea datelor existente");
    // ce există deja (o singură interogare pe fiecare): contoarele marcate, citirile lunii și cele din lunile dinainte (pentru indexul anterior)
    const [marked, readings, before] = await Promise.all([
      prisma.lorawanMeter.findMany({ select: { id: true, volume: true, ts: true, period: true, status: true, updatedAt: true } }),
      prisma.meterReading.findMany({ where: { period }, select: { meterId: true, value: true, source: true } }),
      prisma.meterReading.findMany({ where: { period: { in: [shiftPeriod(period, 1), shiftPeriod(period, 2), shiftPeriod(period, 3)] } }, select: { meterId: true, value: true, readAt: true } }),
    ]);
    const markedBy = new Map(marked.map((m) => [m.id, m]));
    const readBy = new Map(readings.map((r) => [r.meterId, r]));
    const lastBefore = new Map<string, { value: number; readAt: Date }>();
    for (const r of before) {
      const cur = lastBefore.get(r.meterId);
      if (!cur || r.readAt > cur.readAt) lastBefore.set(r.meterId, r);
    }

    await mark("calcul în memorie");
    // totul se calculează în memorie; scrierile pleacă apoi în blocuri
    const readingOps: object[] = [];
    const markOps: object[] = [];
    const touched = new Set<string>();
    const nowMs = now.getTime();
    for (const { row, lw, current } of known) {
      let savedPeriod: string | null = markedBy.get(row.id)?.period ?? null;
      if (current) {
        const ex = readBy.get(row.id);
        if (ex && ex.source == null) {
          stats.skippedField++;
        } else if (ex && ex.source === LORAWAN_SOURCE && ex.value === lw.volume) {
          stats.unchanged++;
          savedPeriod = period;
        } else if (lw.ts.getTime() > nowMs + 10 * 60_000) {
          stats.errors++; // ora transmisiei e în viitor (ceasul dispozitivului)
        } else {
          // indexul anterior: cel mai recent între 1C și o citire dintr-o lună dinainte
          let prev: number | null = row.curr;
          let prevDate = row.currDate;
          const lf = lastBefore.get(row.id);
          if (lf) {
            const fd = lf.readAt.toISOString().slice(0, 10);
            if (!prevDate || fd > prevDate) {
              prev = lf.value;
              prevDate = fd;
            }
          }
          if (prev != null && lw.volume < prev) stats.lowerThanPrev++;
          readingOps.push({
            q: { meterId: row.id, period },
            u: {
              $set: {
                contor: row.contor, clientId: OID(row.clientId), value: lw.volume, prevValue: prev, readAt: D(lw.ts), lat: null, lng: null, accuracy: null, distanceM: null,
                userId: null, userName: "LoRaWAN", source: LORAWAN_SOURCE, verifiedAt: null, disputedAt: null, disputeNote: null, updatedAt: D(now),
              },
              $setOnInsert: { createdAt: D(now), avgConsum: null },
            },
            upsert: true,
          });
          stats.saved++;
          savedPeriod = period;
          touched.add(row.clientId ?? "");
        }
      }
      const status = current ? "matched" : "stale";
      const cur = markedBy.get(row.id);
      if (!cur || cur.volume !== lw.volume || cur.ts.getTime() !== lw.ts.getTime() || cur.period !== savedPeriod || cur.status !== status) {
        markOps.push({
          q: { _id: row.id },
          u: { $set: { contor: lw.name, clientId: OID(row.clientId), volume: lw.volume, ts: D(lw.ts), period: savedPeriod, status, updatedAt: D(now) }, $setOnInsert: { createdAt: D(now) } },
          upsert: true,
        });
      } else if (nowMs - cur.updatedAt.getTime() > 7 * 86_400_000) {
        // neschimbat de mult: se reînnoiește „văzut”, ca să nu fie uitat după 45 de zile
        markOps.push({ q: { _id: row.id }, u: { $set: { updatedAt: D(now) } }, upsert: false });
      }
    }
    // întâi citirile, apoi marcajele (un marcaj spune „citirea lunii e salvată”); la limita de timp se oprește și se salvează ce s-a făcut
    await mark(`scrierea a ${readingOps.length} citiri`);
    const deadline = t0 + BUDGET_MS;
    const wr = await bulkUpsert("MeterReading", readingOps, deadline);
    stats.errors += wr.failed;
    stats.saved -= readingOps.length - wr.sent + wr.failed; // doar ce a fost trimis și acceptat
    if (wr.sent < readingOps.length) partial = true;
    else {
      await mark(`marcarea a ${markOps.length} contoare`);
      if ((await bulkUpsert("LorawanMeter", markOps, deadline)).sent < markOps.length) partial = true;
    }
    for (const id of touched) invalidatePortalClient(id || null); // plătitorul vede imediat citirea în portal

    await prisma.lorawanMeter.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - FORGET_AFTER_DAYS * 86_400_000) } } });
    invalidateLorawanMap();
    await mark("marcarea plătitorilor");
    await syncPayerFlags().catch((e) => console.error("[lorawan] marcajul plătitorilor:", e));

    await mark("gata");
    const message = `${stats.received} contoare primite: ${stats.saved} citiri salvate, ${stats.unchanged} neschimbate, ${stats.stale} ignorate (transmisie din altă lună),${stats.bySuffix ? ` ${stats.bySuffix} potrivite prin număr cu text lângă el (-wc, -bc…),` : ""} ${stats.placeholders} fără nicio transmisie, ${stats.unmatched} negăsite în CRM${stats.errors ? `, ${stats.errors} erori` : ""}.${partial ? " Oprită la limita de timp: apasă din nou (sau așteaptă următoarea pornire) ca să continue de unde a rămas." : ""} (${timings.slice(1).join(", ")})`;
    const durationMs = Date.now() - t0;
    await prisma.lorawanState.update({
      where: { id: STATE_ID },
      data: {
        lastRunAt: new Date(),
        lastOk: true,
        lastTrigger: trigger,
        message,
        durationMs,
        stats: stats as unknown as Prisma.InputJsonValue,
        unmatched,
        lockUntil: EPOCH,
        // o extragere oprită la limita de timp nu activează și nu marchează ziua ca făcută: se reia (cele deja salvate se sar)
        ...(scheduled ? (partial ? { retryAt: new Date(Date.now() + 60_000) } : { lastRunDay: day, retryAt: EPOCH }) : {}),
        ...(opts.activate && !partial ? { activatedAt: new Date() } : {}),
      },
    });
    console.log(`[lorawan] ${message} (${durationMs} ms, ${trigger})`);
    return { ok: true, message, stats };
  } catch (e) {
    const error = `${e instanceof Error ? e.message : String(e)} (etapa „${stage}”)`;
    console.error("[lorawan] extragerea a eșuat:", error);
    await prisma.lorawanState
      .update({
        where: { id: STATE_ID },
        data: { lastRunAt: new Date(), lastOk: false, lastTrigger: trigger, message: error.slice(0, 300), durationMs: Date.now() - t0, lockUntil: EPOCH, ...(scheduled ? { retryAt: new Date(Date.now() + RETRY_MIN * 60_000) } : {}) },
      })
      .catch(() => {});
    return { ok: false, error };
  } finally {
    clearTimeout(watchdog);
  }
}

/** Apelată din temporizatorul serverului (în fiecare minut): după 23:30 (ora firmei) pornește extragerea zilei, o singură dată pe zi. */
export async function checkLorawanSchedule(now: Date = new Date()): Promise<void> {
  if (DEMO || !lorawanConfigured() || minuteOfDay(now) < LORAWAN_HOUR * 60 + LORAWAN_MINUTE) return;
  const st = await prisma.lorawanState.findUnique({ where: { id: STATE_ID }, select: { lastRunDay: true, retryAt: true, lockUntil: true, activatedAt: true } });
  if (!st?.activatedAt) return; // până la „Activează” (pagina LoRaWAN) nu pornește nimic singur
  if ((st.lastRunDay === dayKey(now) || st.retryAt > now || st.lockUntil > now)) return;
  await runLorawanSync("timer");
}

/**
 * Diagnostic: toate numerele din feedul LoRaWAN (descărcat acum) cu rezultatul potrivirii cu CRM-ul — găsit (cu contorul și plătitorul), ignorat (altă lună), fără transmisii, negăsit, scos din uz.
 * Doar citire: nu scrie nimic. Se folosește în pagina LoRaWAN ca să se vadă de ce un contor a fost sau nu potrivit.
 */
export async function getLorawanDiagnostics(): Promise<LorawanDiag> {
  if (DEMO) return { at: Date.now(), period: currentPeriod(), rows: [] };
  if (!lorawanConfigured()) throw new Error("Lipsește LORAWAN_TOKEN în configurația serverului.");
  const period = currentPeriod();
  const [parsed, snap, readings] = await Promise.all([fetchRows(), getMeterSnap(), prisma.meterReading.findMany({ where: { period }, select: { meterId: true, value: true, source: true } })]);
  const readBy = new Map(readings.map((r) => [r.meterId, r]));
  const classify = buildMatcher(snap.rows, period);
  const fmt = (n: number) => n.toLocaleString("ro-RO", { maximumFractionDigits: 3 });
  const rows: DiagTuple[] = [];
  for (const lw of [...parsed.rows].sort((a, b) => a.name.localeCompare(b.name))) {
    const ts = lw.ts.getTime();
    const c = classify(lw);
    if (c.kind !== "found") {
      rows.push([lw.name, lw.volume, ts, c.kind, "", "", "", "", "", "", ""]);
      continue;
    }
    const kind: DiagKind = currentPeriod(lw.ts) === period ? "ok" : "stale";
    for (const r of c.hits) {
      const rd = readBy.get(r.id);
      const read = rd ? `${rd.source === LORAWAN_SOURCE ? "LoRaWAN" : rd.source === "PORTAL" ? "portal" : "cititor"} ${fmt(rd.value)}` : "";
      rows.push([lw.name, lw.volume, ts, kind, r.contor, r.id, r.clientId ?? "", r.name ?? "", r.address ?? "", read, c.viaSuffix ? "cu text" : "exact"]);
    }
  }
  return { at: Date.now(), period, rows };
}

export async function getLorawanStatus(): Promise<LorawanStatus> {
  const empty: LorawanStatus = { configured: lorawanConfigured(), activated: false, lastRunAt: null, lastOk: true, lastTrigger: "", message: "", durationMs: 0, running: false, stats: null, unmatched: [], known: 0 };
  if (DEMO) return empty;
  const [st, known] = await Promise.all([prisma.lorawanState.findUnique({ where: { id: STATE_ID } }), prisma.lorawanMeter.count()]);
  if (!st) return { ...empty, known };
  return {
    configured: lorawanConfigured(),
    activated: !!st.activatedAt,
    lastRunAt: st.lastRunAt ? st.lastRunAt.toISOString() : null,
    lastOk: st.lastOk,
    lastTrigger: st.lastTrigger,
    message: st.message,
    durationMs: st.durationMs,
    running: st.lockUntil > new Date(),
    stats: (st.stats as unknown as LorawanStats | null) ?? null,
    unmatched: Array.isArray(st.unmatched) ? (st.unmatched as string[]) : [],
    known,
  };
}
