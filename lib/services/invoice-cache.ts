import "server-only";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { invalidateOneC } from "./onec-cache";
import { allClientNames, dropClientNames } from "../queries/client-names";
import { DEMO } from "../demo";
import {
  INVOICE_STATUS_CODES,
  MONTH_RE,
  bucharestOffsetMs,
  dayOfKey,
  decodeInvoices,
  defaultPeriod,
  encodeInvoices,
  groupServiceRows,
  monthBoundsMs,
  monthOf,
  periodFitsLocally,
  periodMonths,
  queryInvoices,
  toListItem,
  serviceOfItems,
  type InvQuery,
  type InvRow,
  type InvServiceRow,
  type InvSvc,
  type InvSums,
  type InvTuple,
  type InvoiceListItem,
  type MonthCount,
} from "../invoice-list";

/**
 * Cache-ul listei de facturi, împărțit pe LUNA EMITERII (ora României). Volumul real e de sute de mii de facturi (≈ 19.000 pe lună, una pe plătitor), deci nu există „lista întreagă":
 * fiecare lună e un snapshot de sine stătător (≈ 0,7 MB comprimat), cu versiunea (ETag) ei, și se reface doar el când se schimbă ceva în luna aceea.
 *
 *   memorie (L1, cel mult `L1_MAX` luni, cele folosite recent) → un rând în baza de date per lună, comprimat gzip, partajat între instanțe (L2) → reconstruire din facturi, doar la nevoie.
 *
 * Modificările: o factură (creare / editare / status / ștergere) se aplică DIRECT în luna ei din memorie (`syncInvoiceToCache`) și marchează doar luna aceea pentru reîmprospătare în fundal;
 * modificările în masă (import 1C, tarife) marchează toate lunile (se refac la prima cerere); numele clienților — modificare „moale" (se vede imediat, se salvează în fundal).
 * Căutările peste „toate lunile" nu trec prin snapshot-uri: rulează în baza de date (`listInvoicesServer`), cu index pe data emiterii.
 *
 * Starea stă pe `globalThis`: în producție paginile și acțiunile primesc instanțe separate ale modulului, iar invalidarea trebuie să ajungă peste tot.
 */

// „m3”: snapshot-urile au și serviciile facturii (apă / canalizare); cele vechi („inv:m:”) se șterg la prewarm și lunile se reconstruiesc la prima cerere
const SHARD_PREFIX = "inv:m4:";
const OLD_SHARD_PREFIXES = ["inv:m:", "inv:m3:"];
const ALL_ID = "inv:all";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const META_CHECK_MS = 10_000;
const HARD_DELAY_MS = 1_200;
const SOFT_DELAY_MS = 8_000;
const L1_MAX = 4;
const INDEX_TTL_MS = 60_000;

export type InvoiceShard = {
  month: string;
  version: string;
  builtAt: number;
  total: number;
  gz: Buffer;
  rows: InvRow[];
  /** Serviciile (apă / canalizare) ale unor facturi încă nu sunt calculate: luna se servește imediat fără ele, iar în fundal se completează (vezi `enqueueSvcFill`). Nu se salvează în baza de date. */
  incomplete?: boolean;
};

type Artifact = { v: 3; at: number; month: string; total: number; rows: InvTuple[]; /** 1 = serviciile (apă / canalizare) ale facturilor încă nu sunt calculate; se completează în fundal */ inc?: 1 };

type State = {
  l1: Map<string, InvoiceShard>;
  checkedAt: Map<string, number>;
  loading: Map<string, Promise<InvoiceShard>>;
  building: Map<string, Promise<InvoiceShard>>;
  patchSeq: Map<string, number>;
  patched: Map<string, { seq: number; gz: Buffer; version: string }>;
  hardAt: number;
  softAt: number;
  monthHard: Map<string, number>;
  monthSoft: Map<string, number>;
  scheduled: Set<string>;
  index: { at: number; months: MonthCount[] } | null;
  indexLoading: Promise<MonthCount[]> | null;
  lists: Map<string, { at: number; val: ServerPage }>;
  listFlights: Map<string, Promise<ServerPage>>;
  indexEnsured: boolean;
};
const g = globalThis as unknown as { __invShards?: State };
const S: State = (g.__invShards ??= {
  l1: new Map(), checkedAt: new Map(), loading: new Map(), building: new Map(), patchSeq: new Map(), patched: new Map(),
  hardAt: 0, softAt: 0, monthHard: new Map(), monthSoft: new Map(), scheduled: new Set(),
  index: null, indexLoading: null, lists: new Map(), listFlights: new Map(), indexEnsured: false,
});

type ServerPage = { items: InvoiceListItem[]; total: number; totalPages: number; page: number };

const shardId = (month: string) => SHARD_PREFIX + month;

// ───────────────────────────── index pe data emiterii ─────────────────────────────

/**
 * Interogările pe luni (reconstruirea unui snapshot, căutarea peste perioade) filtrează după data emiterii: fără index ar citi toată colecția (sute de mii de facturi).
 * Indexul se creează o singură dată, în fundal, idempotent (același nume ca cel din schema Prisma, deci un `db push` ulterior nu-l dublează). Nu blochează și nu aruncă.
 */
function ensureIssueDateIndex(): void {
  if (S.indexEnsured || DEMO) return;
  S.indexEnsured = true;
  void prisma
    .$runCommandRaw({ createIndexes: "Invoice", indexes: [{ key: { issueDate: 1 }, name: "Invoice_issueDate_idx" }] })
    .then(() => console.log("[invoice-cache] index pe issueDate verificat"))
    .catch((e) => console.error("[invoice-cache] nu am putut crea indexul pe issueDate (merge și fără, mai lent):", e));
}

// ───────────────────────────── luni ─────────────────────────────

/** Lunile cu facturi (cea mai recentă prima) și câte facturi are fiecare. Memorie ~60 s; se golește la orice modificare cunoscută. */
export async function getInvoiceMonths(): Promise<MonthCount[]> {
  if (DEMO) return [];
  if (S.index && Date.now() - S.index.at < INDEX_TTL_MS) return S.index.months;
  // lista expirată se mai folosește o dată cât se reîmprospătează în fundal (interogarea numără toate facturile): nimeni nu așteaptă după ea, decât la prima citire
  if (S.index) {
    if (!S.indexLoading) void getInvoiceMonthsFresh().catch(() => {});
    return S.index.months;
  }
  return getInvoiceMonthsFresh();
}

function getInvoiceMonthsFresh(): Promise<MonthCount[]> {
  if (!S.indexLoading) {
    ensureIssueDateIndex();
    const startedAt = Date.now();
    const epochHard = S.hardAt + S.softAt;
    S.indexLoading = (async () => {
      const rows = (await prisma.invoice.aggregateRaw({
        pipeline: [{ $group: { _id: { $dateToString: { format: "%Y-%m", date: "$issueDate", timezone: "Europe/Bucharest" } }, n: { $sum: 1 } } }],
      })) as unknown as { _id: string | null; n: number }[];
      const months = rows
        .filter((r) => r._id && MONTH_RE.test(r._id))
        .map((r) => ({ month: r._id as string, count: r.n }))
        .sort((a, b) => b.month.localeCompare(a.month));
      if (epochHard === S.hardAt + S.softAt) S.index = { at: startedAt, months }; // o modificare în timpul interogării → nu păstrăm rezultatul
      return months;
    })().finally(() => {
      S.indexLoading = null;
    });
  }
  return S.indexLoading as Promise<MonthCount[]>;
}

// ───────────────────────────── citire / construire snapshot ─────────────────────────────

const TUPLE_SELECT = {
  id: true, number: true, status: true, kind: true, issueDate: true, dueDate: true, paidAt: true, grandTotal: true, currency: true,
  publicToken: true, consumerName: true, contPersonal: true, clientId: true, datoriiAvans: true, paidAmount: true, prevPaid: true,
} as const;

type TupleSource = {
  id: string; number: string; status: string; kind: string; issueDate: Date; dueDate: Date | null; paidAt: Date | null; grandTotal: number;
  currency: string; publicToken: string; consumerName: string | null; contPersonal: string | null;
  datoriiAvans: number; paidAmount: number | null; prevPaid: number | null;
};
function toTuple(r: TupleSource, clientName: string | null, svc: InvSvc = 0): InvTuple {
  return [
    r.id, r.number, Math.max(0, INVOICE_STATUS_CODES.indexOf(r.status as (typeof INVOICE_STATUS_CODES)[number])), r.kind === "APA_CANAL" ? 1 : 0,
    r.issueDate.getTime(), r.dueDate ? r.dueDate.getTime() : null, r.paidAt ? r.paidAt.getTime() : null,
    r.grandTotal, r.currency, clientName, r.publicToken,
    [r.consumerName, r.contPersonal].filter(Boolean).join("\n") || null,
    svc, r.datoriiAvans ?? 0, r.paidAmount ?? null, r.prevPaid ?? null,
  ];
}

/**
 * Un snapshot de lună. `rows` (obiectele decodate, pentru filtrarea de pe server) se construiesc LA PRIMA FOLOSIRE: cererea /api/invoices/snapshot are nevoie doar de varianta
 * comprimată, deci o lună încărcată din baza de date nu se mai despachetează degeaba (≈ 100–200 ms la 19.000 de facturi).
 */
function makeShard(month: string, version: string, builtAt: number, total: number, gz: Buffer, tuples?: InvTuple[], incomplete = false): InvoiceShard {
  let rows: InvRow[] | null = null;
  let tup: InvTuple[] | null = tuples ?? null;
  return {
    month, version, builtAt, total, gz, incomplete,
    get rows(): InvRow[] {
      if (!rows) {
        if (!tup) tup = (JSON.parse(gunzipSync(gz).toString("utf8")) as Artifact).rows;
        rows = decodeInvoices(tup);
        tup = null;
      }
      return rows;
    },
  };
}

async function readMetas(month: string) {
  const rows = await prisma.payerCacheEntry.findMany({
    where: { id: { in: [shardId(month), ALL_ID] } },
    select: { id: true, version: true, builtAt: true, dirtyAt: true, softDirtyAt: true },
  });
  return { shard: rows.find((r) => r.id === shardId(month)) ?? null, all: rows.find((r) => r.id === ALL_ID) ?? null };
}

async function loadFromDb(month: string): Promise<InvoiceShard | null> {
  const row = await prisma.payerCacheEntry.findUnique({ where: { id: shardId(month) }, select: { version: true, builtAt: true, rows: true, gz: true } });
  if (!row) return null;
  const gz = Buffer.from(row.gz);
  if (gz.length < 20 || gz[0] !== 0x1f || gz[1] !== 0x8b) {
    console.error(`[invoice-cache] rândul ${month} din baza de date e ilizibil, îl reconstruiesc`);
    return null;
  }
  return makeShard(month, row.version, row.builtAt.getTime(), row.rows, gz);
}

function setL1(shard: InvoiceShard) {
  S.l1.delete(shard.month);
  S.l1.set(shard.month, shard);
  while (S.l1.size > L1_MAX) {
    const old = S.l1.keys().next().value as string;
    S.l1.delete(old);
    S.patchSeq.delete(old);
    S.patched.delete(old);
    S.checkedAt.delete(old);
  }
}

/** Serviciile fiecărei facturi Apă-Canal dintr-o lună (id → 0 niciunul / 1 apă / 2 canalizare / 3 amândouă), într-o singură agregare (grea: câte o căutare de linii per factură). NU se rulează în cererea utilizatorului, ci în fundal, pe rând (`enqueueSvcFill`). */
async function serviceMapForMonth(a: number, b: number): Promise<Map<string, InvSvc>> {
  const raw = (await prisma.invoice.aggregateRaw({
    pipeline: [
      { $match: { kind: "APA_CANAL", issueDate: { $gte: { $date: new Date(a).toISOString() }, $lt: { $date: new Date(b).toISOString() } } } },
      { $lookup: { from: "InvoiceItem", localField: "_id", foreignField: "invoiceId", as: "items" } },
      { $project: { w: svcLine("alimentare cu ap[aă]"), s: svcLine("canalizare") } },
    ],
  })) as unknown as { _id: { $oid: string } | string; w: boolean; s: boolean }[];
  const out = new Map<string, InvSvc>();
  for (const r of raw) out.set(typeof r._id === "string" ? r._id : r._id.$oid, r.w && r.s ? 3 : r.w ? 1 : r.s ? 2 : 0);
  return out;
}

const gsvc = globalThis as unknown as { __invSvc?: { queue: string[]; worker: boolean; maps: Map<string, { at: number; map: Map<string, InvSvc> }> } };
const SVC = (gsvc.__invSvc ??= { queue: [] as string[], worker: false, maps: new Map<string, { at: number; map: Map<string, InvSvc> }>() });
const SVC_MAP_TTL_MS = 5 * 60_000;

/** Calculează serviciile lunii (agregarea grea) și reface luna cu ele. */
async function fillServicesNow(month: string): Promise<void> {
  const [a, b] = monthBoundsMs(month);
  const map = await serviceMapForMonth(a, b);
  SVC.maps.set(month, { at: Date.now(), map });
  await rebuildInvoiceShard(month, "servicii", false);
}

/** Lunile cu servicii necalculate se completează în fundal, UNA câte una (agregarea e grea; pornită pe toate lunile deodată, bloca pagina de facturi). */
function enqueueSvcFill(month: string): void {
  if (!SVC.queue.includes(month)) SVC.queue.push(month);
  if (SVC.worker) return;
  SVC.worker = true;
  runInBackground(async () => {
    try {
      while (SVC.queue.length) {
        const m = SVC.queue.shift() as string;
        try {
          await fillServicesNow(m);
        } catch (e) {
          console.error(`[invoice-cache] servicii ${m}:`, e);
        }
        await new Promise((r) => setTimeout(r, 300));
      }
    } finally {
      SVC.worker = false;
    }
  });
}

/** Reconstruiește luna din facturi și o salvează în L2. O singură execuție per lună la un moment dat. */
export function rebuildInvoiceShard(month: string, reason = "manual", carry = false): Promise<InvoiceShard> {
  const cur = S.building.get(month);
  if (cur) return cur;
  const p = (async () => {
    const t0 = Date.now();
    const startedAt = new Date();
    ensureIssueDateIndex();
    const [a, b] = monthBoundsMs(month);
    const [invoices, names] = await Promise.all([
      prisma.invoice.findMany({ where: { issueDate: { gte: new Date(a), lt: new Date(b) } }, select: { ...TUPLE_SELECT, createdAt: true } }),
      allClientNames(),
    ]);
    // cele mai noi create primele (ordinea listei); sortarea e aici, nu în baza de date, ca interogarea să folosească indexul pe data emiterii
    invoices.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
    // Serviciile facturilor: dintr-un calcul proaspăt (vezi `enqueueSvcFill`), sau — la o modificare minoră — din luna veche aflată în memorie; ce nu se știe încă rămâne 0 și se completează în fundal.
    const fresh = SVC.maps.get(month);
    const known = fresh && Date.now() - fresh.at < SVC_MAP_TTL_MS ? fresh.map : null;
    const prev = S.l1.get(month);
    const carried: Map<string, InvSvc> | null = !known && carry && prev && !prev.incomplete ? new Map(prev.rows.filter((r) => r.kind === "APA_CANAL").map((r): [string, InvSvc] => [r.id, r.svc])) : null;
    const svcSrc: Map<string, InvSvc> | null = known ?? carried;
    if (known) SVC.maps.delete(month);
    let incomplete = false;
    const tuples = invoices.map((r) => {
      let svc: InvSvc = 0;
      if (r.kind === "APA_CANAL") {
        const v = svcSrc?.get(r.id);
        if (v === undefined) incomplete = true;
        else svc = v;
      }
      return toTuple(r, r.clientId ? (names.get(r.clientId) ?? null) : null, svc);
    });
    const art: Artifact = { v: 3, at: startedAt.getTime(), month, total: tuples.length, rows: tuples, ...(incomplete ? { inc: 1 as const } : {}) };
    const gz = gzipSync(Buffer.from(JSON.stringify(art), "utf8"), { level: 6 });
    const version = createHash("sha1").update(gz).digest("hex").slice(0, 16);
    // o lună fără servicii calculate nu se salvează în baza de date (ar rămâne așa): se salvează abia după completare
    if (!incomplete) {
      try {
        const data = { version, builtAt: startedAt, rows: tuples.length, gz: Uint8Array.from(gz) };
        const upd = await prisma.payerCacheEntry.updateMany({ where: { id: shardId(month) }, data });
        if (upd.count === 0) await prisma.payerCacheEntry.create({ data: { id: shardId(month), ...data } });
      } catch (e) {
        console.error(`[invoice-cache] nu am putut salva ${month} în baza de date (rămâne doar în memorie):`, e);
      }
    }
    const shard = makeShard(month, version, startedAt.getTime(), tuples.length, gz, tuples, incomplete);
    if (incomplete) enqueueSvcFill(month);
    setL1(shard);
    S.checkedAt.set(month, Date.now());
    S.patchSeq.set(month, 0);
    S.patched.delete(month);
    S.lists.clear();
    console.log(`[invoice-cache] ${month} reconstruit (${reason}): ${tuples.length} facturi, ${(gz.length / 1e6).toFixed(2)} MB comprimat, ${Date.now() - t0} ms`);
    return shard;
  })().finally(() => {
    S.building.delete(month);
  });
  S.building.set(month, p);
  return p;
}

function runInBackground(fn: () => Promise<unknown>) {
  const safe = () => fn().catch((e) => console.error("[invoice-cache] eșec în fundal:", e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}

function scheduleRebuild(month: string, delayMs: number, reason: string, carry = false) {
  if (S.scheduled.has(month)) return;
  S.scheduled.add(month);
  runInBackground(async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    S.scheduled.delete(month);
    await rebuildInvoiceShard(month, reason, carry);
  });
}

function agedOut(s: InvoiceShard, builtAtMs = s.builtAt): InvoiceShard {
  if (Date.now() - builtAtMs > MAX_AGE_MS) runInBackground(() => rebuildInvoiceShard(s.month, "24h"));
  return s;
}

const localHard = (month: string) => Math.max(S.hardAt, S.monthHard.get(month) ?? 0);
const localSoft = (month: string) => Math.max(S.softAt, S.monthSoft.get(month) ?? 0);

async function resolveShard(month: string): Promise<InvoiceShard> {
  const cur = S.l1.get(month);
  const metas = await readMetas(month);
  S.checkedAt.set(month, Date.now());
  const meta = metas.shard;
  // luna e în memorie, dar fără servicii calculate (nu e în baza de date): o servim așa, se completează în fundal — nu o refacem la fiecare cerere
  if (cur?.incomplete && !meta && localHard(month) <= cur.builtAt) {
    enqueueSvcFill(month);
    return cur;
  }
  if (meta) {
    const builtMs = meta.builtAt.getTime();
    const dirty = Math.max(meta.dirtyAt?.getTime() ?? 0, metas.all?.dirtyAt?.getTime() ?? 0, localHard(month));
    if (dirty <= builtMs) {
      const shard = cur && cur.version === meta.version ? cur : await loadFromDb(month);
      if (shard) {
        if (shard !== cur) {
          setL1(shard);
          S.patchSeq.set(month, 0);
          S.patched.delete(month);
          S.lists.clear();
        }
        const soft = Math.max(meta.softDirtyAt?.getTime() ?? 0, metas.all?.softDirtyAt?.getTime() ?? 0, localSoft(month));
        if (soft > builtMs) scheduleRebuild(month, SOFT_DELAY_MS, "modificare minoră", true);
        return agedOut(shard, builtMs);
      }
    }
  }
  return rebuildInvoiceShard(month, meta ? "modificat" : "lipsește");
}

/** Snapshot-ul unei luni: din memorie, altfel din baza de date, altfel reconstruit (doar când lipsește sau a fost modificat). */
export async function getInvoiceShard(month: string): Promise<InvoiceShard> {
  if (DEMO || !MONTH_RE.test(month)) return { month, version: "demo", builtAt: Date.now(), total: 0, gz: gzipSync(Buffer.from(`{"v":2,"at":0,"month":"${month}","total":0,"rows":[]}`)), rows: [] };
  const cur = S.l1.get(month);
  if (cur && localHard(month) <= cur.builtAt && Date.now() - (S.checkedAt.get(month) ?? 0) < META_CHECK_MS) {
    S.l1.delete(month);
    S.l1.set(month, cur); // cel mai recent folosit
    return agedOut(cur);
  }
  let p = S.loading.get(month);
  if (!p) {
    p = resolveShard(month).finally(() => {
      S.loading.delete(month);
    });
    S.loading.set(month, p);
  }
  return p;
}

/** Versiunea (ETag) a lunii CA ȘI-O VEDE browserul: se schimbă și la modificările locale încă nereflectate în varianta comprimată din baza de date. */
export function shardVersion(shard: InvoiceShard): string {
  const seq = S.patchSeq.get(shard.month) ?? 0;
  return seq > 0 && S.l1.get(shard.month) === shard ? `${shard.version}p${seq}` : shard.version;
}

/** Ce se trimite browserului pentru o lună: varianta comprimată curentă, sau — dacă s-au aplicat modificări locale — una refăcută pe loc din memorie (o dată per rafală). */
export async function getInvoiceShardPayload(month: string): Promise<{ version: string; gz: Buffer }> {
  const shard = await getInvoiceShard(month);
  const seq = S.patchSeq.get(month) ?? 0;
  if (seq === 0 || S.l1.get(month) !== shard) return { version: shard.version, gz: shard.gz };
  const hit = S.patched.get(month);
  if (hit?.seq === seq) return { version: hit.version, gz: hit.gz };
  const art: Artifact = { v: 3, at: shard.builtAt, month, total: shard.rows.length, rows: encodeInvoices(shard.rows), ...(shard.incomplete ? { inc: 1 as const } : {}) };
  const gz = gzipSync(Buffer.from(JSON.stringify(art), "utf8"), { level: 4 });
  const version = `${shard.version}p${seq}`;
  if (seq === (S.patchSeq.get(month) ?? 0)) S.patched.set(month, { seq, gz, version });
  return { version, gz };
}

// ───────────────────────────── modificări ─────────────────────────────

/**
 * Modificarea unei singure facturi (creare / editare / status / ștergere): o citim din baza de date și o punem DIRECT în luna ei din memoria acestui proces
 * (inserată prima dacă e nouă, înlocuită la locul ei dacă există, mutată dacă și-a schimbat luna, scoasă dacă a fost ștearsă). Doar luna (lunile) afectată e marcată
 * pentru reîmprospătare în fundal (varianta comprimată pentru browsere și celelalte instanțe); celelalte luni rămân neatinse.
 */
export async function syncInvoiceToCache(id: string): Promise<void> {
  if (DEMO) return;
  try {
    const r = await prisma.invoice.findUnique({ where: { id }, select: { ...TUPLE_SELECT } });
    const touched = new Set<string>();
    // unde era factura (în lunile din memorie)?
    let oldMonth: string | null = null;
    // întâi luna curentă a facturii (cazul obișnuit: schimbare de status); abia apoi celelalte luni din memorie (factura și-a mutat data / a fost ștearsă)
    const hereMonth = r ? monthOf(r.issueDate.getTime()) : null;
    if (hereMonth && S.l1.get(hereMonth)?.rows.some((x) => x.id === id)) oldMonth = hereMonth;
    else for (const [m, sh] of S.l1) if (m !== hereMonth && sh.rows.some((x) => x.id === id)) { oldMonth = m; break; }
    if (!r) {
      if (oldMonth) touched.add(oldMonth);
      else {
        // nu știm în ce lună era: toate lunile se reîmprospătează în fundal
        await invalidateInvoices({ soft: true });
        return;
      }
    } else {
      const month = monthOf(r.issueDate.getTime());
      touched.add(month);
      if (oldMonth) touched.add(oldMonth);
    }
    const names = r?.clientId ? await clientNameFor(r.clientId) : null;
    // serviciile facturii (doar Apă-Canal) după liniile ei
    const svc: InvSvc = r && r.kind === "APA_CANAL" ? serviceOfItems(await prisma.invoiceItem.findMany({ where: { invoiceId: id }, select: { description: true, quantity: true, lineTotal: true } })) : 0;
    for (const m of touched) {
      const sh = S.l1.get(m);
      if (!sh) continue;
      let rows = sh.rows;
      const idx = rows.findIndex((x) => x.id === id);
      const here = !!r && monthOf(r.issueDate.getTime()) === m;
      if (!here) {
        if (idx >= 0) rows = rows.slice(0, idx).concat(rows.slice(idx + 1));
      } else {
        const [row] = decodeInvoices([toTuple(r!, names, svc)]);
        rows = idx >= 0 ? rows.map((x, i) => (i === idx ? row : x)) : [row, ...rows];
      }
      const next: InvoiceShard = { month: sh.month, version: sh.version, builtAt: sh.builtAt, gz: sh.gz, rows, total: rows.length, incomplete: sh.incomplete };
      S.l1.set(m, next);
      S.patchSeq.set(m, (S.patchSeq.get(m) ?? 0) + 1);
      S.patched.delete(m);
    }
    S.lists.clear();
    // numărul de facturi pe lună se schimbă doar la creare / ștergere / mutare între luni (nu la schimbarea statusului)
    if (!oldMonth || !r || monthOf(r.issueDate.getTime()) !== oldMonth) S.index = null;
    invalidateOneC();
    await markMonths([...touched], true);
  } catch (e) {
    console.error("[invoice-cache] nu am putut pune factura în memorie:", e);
  }
}

async function clientNameFor(clientId: string): Promise<string | null> {
  try {
    return (await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } }))?.name ?? null;
  } catch {
    return null;
  }
}

async function markMonths(months: string[], soft: boolean) {
  const now = Date.now();
  for (const m of months) (soft ? S.monthSoft : S.monthHard).set(m, now);
  try {
    await prisma.payerCacheEntry.updateMany({ where: { id: { in: months.map(shardId) } }, data: soft ? { softDirtyAt: new Date() } : { dirtyAt: new Date() } });
  } catch (e) {
    console.error("[invoice-cache] nu am putut marca modificarea:", e);
  }
  for (const m of months) scheduleRebuild(m, soft ? SOFT_DELAY_MS : HARD_DELAY_MS, soft ? "modificare minoră" : "după modificare", true); // o factură schimbată: serviciile celorlalte rămân cele știute
}

/**
 * Anunță că s-au schimbat facturi (sau numele unui client de pe ele) fără să știm care: toate lunile se marchează (fiecare se reface la prima cerere, nu toate deodată).
 * Nu aruncă niciodată. `soft`: modificare minoră (nume client) — se servește varianta existentă și se reface în fundal. `months`: doar lunile date.
 */
export async function invalidateInvoices(opts: { soft?: boolean; months?: string[] } = {}): Promise<void> {
  if (DEMO) return;
  invalidateOneC(); // „Total PWA” / „Diferență” din Tabel 1C vin din facturi
  const soft = !!opts.soft;
  S.lists.clear();
  S.index = null;
  dropClientNames();
  if (opts.months?.length) {
    await markMonths(opts.months.filter((m) => MONTH_RE.test(m)), soft);
    return;
  }
  const now = Date.now();
  if (soft) S.softAt = now;
  else S.hardAt = now;
  try {
    const data = soft ? { softDirtyAt: new Date() } : { dirtyAt: new Date() };
    const upd = await prisma.payerCacheEntry.updateMany({ where: { id: ALL_ID }, data });
    if (upd.count === 0) await prisma.payerCacheEntry.create({ data: { id: ALL_ID, version: "all", builtAt: new Date(0), rows: 0, gz: new Uint8Array(0), ...data } });
  } catch (e) {
    console.error("[invoice-cache] nu am putut marca modificarea:", e);
  }
  // lunile deja în memorie se reîmprospătează singure (la prima cerere sau în fundal); luna cea mai recentă o refacem din timp
  for (const m of S.l1.keys()) scheduleRebuild(m, soft ? SOFT_DELAY_MS : HARD_DELAY_MS, soft ? "modificare minoră" : "după modificare");
}

/** După un import / o sincronizare în masă: toate lunile sunt depășite; luna cea mai recentă se reface acum (cititorul n-o mai așteaptă). */
export async function rebuildInvoiceSnap(reason = "manual"): Promise<void> {
  if (DEMO) return;
  await invalidateInvoices();
  const months = await getInvoiceMonths();
  if (months[0]) await rebuildInvoiceShard(months[0].month, reason);
}

/** Pentru cron-ul zilnic: reface luna curentă și cea precedentă dacă lipsesc, sunt depășite sau au > 20 h. */
export async function prewarmInvoices(): Promise<boolean> {
  if (DEMO) return false;
  // rândul vechi al listei întregi (înainte de împărțirea pe luni) nu mai folosește nimănui
  void prisma.payerCacheEntry.deleteMany({ where: { id: { in: ["inv:snapshot"] } } }).catch(() => {});
  // snapshot-urile lunare vechi (fără servicii) nu mai sunt folosite: se șterg ca să nu ocupe loc în baza de date
  void prisma.payerCacheEntry.deleteMany({ where: { OR: OLD_SHARD_PREFIXES.map((p) => ({ id: { startsWith: p } })) } }).catch(() => {});
  const months = await getInvoiceMonths();
  let did = false;
  for (const { month } of months.slice(0, 2)) {
    const { shard: meta, all } = await readMetas(month);
    const builtMs = meta?.builtAt.getTime() ?? 0;
    const dirty = Math.max(meta?.dirtyAt?.getTime() ?? 0, all?.dirtyAt?.getTime() ?? 0);
    const soft = Math.max(meta?.softDirtyAt?.getTime() ?? 0, all?.softDirtyAt?.getTime() ?? 0);
    if (!meta || Date.now() - builtMs > 20 * 60 * 60 * 1000 || dirty > builtMs || soft > builtMs) {
      const sh = await rebuildInvoiceShard(month, "cron zilnic");
      // cronul are timp: completează acum serviciile lunii (în cererile utilizatorilor se completează în fundal)
      if (sh.incomplete) await fillServicesNow(month);
      did = true;
    }
  }
  return did;
}

// ───────────────────────────── raport pe servicii ─────────────────────────────

/** O linie de serviciu „există” dacă are consum sau sumă (formularul salvează mereu ambele linii, chiar și cu canalizare 0). */
const svcLine = (re: string) => ({
  $gt: [
    { $size: { $filter: { input: "$items", as: "i", cond: { $and: [
      { $regexMatch: { input: "$$i.description", regex: re, options: "i" } },
      { $or: [{ $gt: ["$$i.quantity", 0] }, { $gt: ["$$i.lineTotal", 0] }] },
    ] } } } },
    0,
  ],
});

const gr = globalThis as unknown as { __invReports?: Map<string, { version: string; rows: InvServiceRow[]; incomplete: boolean; at: number }> };
const REPORTS = (gr.__invReports ??= new Map());
const REPORT_CONCURRENCY = 2;
const REPORT_FRESH_MS = 60_000;
const REPORT_MAX_MONTHS = 240;

/**
 * O lună din raport, CALCULATĂ DIN SNAPSHOT (memorie sau baza de date, comprimat), nu din facturi: nicio agregare, nicio căutare de linii — doar o trecere peste câteva zeci de mii de rânduri
 * deja pregătite. Rezultatul stă în memorie legat de versiunea snapshot-ului, deci se invalidează singur la orice modificare (versiunea se schimbă) și nu are nevoie de nicio golire.
 */
async function serviceReportForMonth(month: string): Promise<{ rows: InvServiceRow[]; incomplete: boolean }> {
  const hit = REPORTS.get(month);
  // rezultat din ultimul minut: fără nicio verificare. Mai vechi: o verificare mică a versiunii (fără să încărcăm snapshot-ul lunii) — la o perioadă lungă, restul lunilor nu se mai despachetează
  if (hit && Date.now() - hit.at < REPORT_FRESH_MS) return hit;
  if (hit) {
    const metas = await readMetas(month);
    const cur = S.l1.get(month);
    const dirty = Math.max(metas.shard?.dirtyAt?.getTime() ?? 0, metas.all?.dirtyAt?.getTime() ?? 0, localHard(month));
    const ver = cur ? shardVersion(cur) : metas.shard?.version;
    if (metas.shard && dirty <= metas.shard.builtAt.getTime() && ver === hit.version) {
      hit.at = Date.now();
      return hit;
    }
  }
  const shard = await getInvoiceShard(month);
  const version = shardVersion(shard);
  const out = { version, rows: groupServiceRows(shard.rows), incomplete: !!shard.incomplete, at: Date.now() };
  if (REPORTS.size >= REPORT_MAX_MONTHS) REPORTS.delete(REPORTS.keys().next().value as string);
  REPORTS.set(month, out);
  return out;
}

/** Raportul pe servicii pentru o perioadă (`AAAA-LL` / `last3` / `year:AAAA` / `all`), adunat din snapshot-urile lunilor. `incomplete`: serviciile unei luni încă se calculează în fundal. */
export async function getInvoiceServiceReport(period: string): Promise<{ rows: InvServiceRow[]; incomplete: boolean }> {
  if (DEMO) return { rows: [], incomplete: false };
  const months = await getInvoiceMonths();
  const known = new Set(months.map((x) => x.month));
  const list = periodMonths(period, months).filter((m) => known.has(m));
  const perMonth: { rows: InvServiceRow[]; incomplete: boolean }[] = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(REPORT_CONCURRENCY, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      perMonth[i] = await serviceReportForMonth(list[i]);
    }
  }));
  const acc = new Map<string, InvServiceRow>();
  for (const m of perMonth) {
    for (const r of m.rows) {
      const k = `${r.svc}|${r.status}|${r.currency}`;
      const cur = acc.get(k);
      if (cur) { cur.n += r.n; cur.total += r.total; cur.calc += r.calc; cur.settled += r.settled; cur.paid += r.paid; cur.owes += r.owes; cur.rest += r.rest; } else acc.set(k, { ...r });
    }
  }
  return { rows: [...acc.values()], incomplete: perMonth.some((m) => m.incomplete) };
}

// ───────────────────────────── pagina / lista ─────────────────────────────

export type InvoicePageResult = {
  items: InvoiceListItem[];
  total: number;
  totalPages: number;
  page: number;
  /** "local" = perioada încape în browser (snapshot-uri pe luni); "server" = prea multe facturi, pagini de pe server. */
  mode: "local" | "server";
  period: string;
  months: MonthCount[];
  /** Lunile perioadei, în ordinea afișării (doar la mode "local"). */
  periodMonths: string[];
  /** Versiunea primei luni din perioadă (pentru preîncărcare). */
  firstVersion: string | null;
  sums: InvSums | null;
};

async function concatRows(list: string[]): Promise<{ rows: InvRow[]; firstVersion: string | null }> {
  const shards = await Promise.all(list.map((m) => getInvoiceShard(m)));
  const rows = shards.length === 1 ? shards[0].rows : shards.flatMap((s) => s.rows);
  return { rows, firstVersion: shards[0] ? shardVersion(shards[0]) : null };
}

/**
 * Prima pagină pentru /invoices și pentru /api/invoices/list: perioada încape local → se calculează din snapshot-urile lunilor (memorie); altfel din baza de date.
 */
export async function listInvoicesPage(q: InvQuery, periodReq: string | null, page: number, perPage: number): Promise<InvoicePageResult> {
  const months = await getInvoiceMonths();
  const period = defaultPeriod(periodReq, months);
  if (periodFitsLocally(period, months)) {
    const known = new Set(months.map((m) => m.month));
    const list = periodMonths(period, months).filter((m) => known.has(m)); // luni inexistente nu se construiesc (nici nu se salvează)
    if (list.length > L1_MAX) {
      // Perioadă pe mai multe luni decât ține serverul în memorie: browserul o încarcă oricum local (lună cu lună), dar serverul n-are rost să despacheteze zeci de mii de facturi
      // la fiecare cerere doar pentru prima pagină — o ia din baza de date (indexată pe data emiterii). Cheia de preîncărcare = prima lună (doar varianta comprimată, fără despachetare).
      const [res, first] = await Promise.all([listInvoicesServer(q, period, months, page, perPage), getInvoiceShard(list[0])]);
      return { ...res, mode: "local", period, months, periodMonths: list, firstVersion: shardVersion(first), sums: null };
    }
    const { rows, firstVersion } = await concatRows(list);
    const r = queryInvoices(rows, q);
    const totalPages = Math.max(1, Math.ceil(r.total / perPage));
    const p = Math.min(Math.max(1, page), totalPages);
    const items: InvoiceListItem[] = [];
    for (let k = (p - 1) * perPage; k < Math.min(r.total, p * perPage); k++) items.push(toListItem(rows[r.idx[k]]));
    return { items, total: r.total, totalPages, page: p, mode: "local", period, months, periodMonths: list, firstVersion, sums: r.sums };
  }
  const res = await listInvoicesServer(q, period, months, page, perPage);
  return { ...res, mode: "server", period, months, periodMonths: [], firstVersion: null, sums: null };
}

/** Prima pagină pentru /invoices; dacă cache-ul nu poate fi folosit (ex. fără `prisma generate`), revine la interogarea din baza de date. */
export async function ssrInvoicePage(q: InvQuery, periodReq: string | null, page: number, perPage: number): Promise<InvoicePageResult> {
  try {
    return await listInvoicesPage(q, periodReq, page, perPage);
  } catch (e) {
    console.error("[invoice-cache] cache indisponibil, citesc din baza de date:", e);
    const months: MonthCount[] = [];
    const period = periodReq && /^(all|last3|year:\d{4}|\d{4}-\d{2})$/.test(periodReq) ? periodReq : "all";
    const res = await listInvoicesServer(q, period, months, page, perPage);
    return { ...res, mode: "server", period, months, periodMonths: [], firstVersion: null, sums: null };
  }
}

const PS_SERVER_MAX = 1000;
const PRIMARY_SORT = new Set(["issue", "number"]);

/** Căutarea pe server (peste perioade prea mari ca să încapă în browser): filtre → `where` Prisma, cu indexul pe data emiterii; client după nume prin harta numelor din memorie. */
export async function listInvoicesServer(q: InvQuery, period: string, months: MonthCount[], page: number, perPage: number): Promise<ServerPage> {
  const ps = Math.min(Math.max(1, perPage), PS_SERVER_MAX);
  const key = `${JSON.stringify(q)}|${period}|${page}|${ps}`;
  const hit = S.lists.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.val;
  if (DEMO) return { items: [], total: 0, totalPages: 1, page: 1 };
  // aceeași căutare cerută de mai mulți deodată (taste, file deschise) → o singură interogare în baza de date
  const flying = S.listFlights.get(key);
  if (flying) return flying;
  const run = queryServer(q, period, months, page, ps, key).finally(() => {
    S.listFlights.delete(key);
  });
  S.listFlights.set(key, run);
  return run;
}

async function queryServer(q: InvQuery, period: string, months: MonthCount[], page: number, ps: number, key: string): Promise<ServerPage> {

  const and: Prisma.InvoiceWhereInput[] = [];
  // perioada → interval pe data emiterii (indexat)
  const list = periodMonths(period, months);
  if (period !== "all" && list.length) {
    const sorted = [...list].sort();
    and.push({ issueDate: { gte: new Date(monthBoundsMs(sorted[0])[0]), lt: new Date(monthBoundsMs(sorted[sorted.length - 1])[1]) } });
  }
  if (q.statuses.length) and.push({ status: { in: q.statuses as never } });
  if (q.kind) and.push({ kind: q.kind });
  if (q.currency) and.push({ currency: q.currency });
  const min = Number(q.min.replace(",", ".")), max = Number(q.max.replace(",", "."));
  if (q.min.trim() && Number.isFinite(min)) and.push({ grandTotal: { gte: min } });
  if (q.max.trim() && Number.isFinite(max)) and.push({ grandTotal: { lte: max } });
  const now = new Date();
  const unpaid: Prisma.InvoiceWhereInput = { status: { notIn: ["PAID", "CANCELLED"] } };
  if (q.quick === "unpaid") and.push(unpaid);
  if (q.quick === "overdue") and.push(unpaid, { dueDate: { not: null } }, { dueDate: { lt: now } });
  if (q.quick === "nodue") and.push({ OR: [{ dueDate: null }, { dueDate: { isSet: false } }] });
  if (q.quick === "paidnodate") and.push({ status: "PAID" }, { OR: [{ paidAt: null }, { paidAt: { isSet: false } }] });
  if (q.quick === "debt") and.push({ kind: "APA_CANAL" }, { status: { notIn: ["DRAFT", "CANCELLED"] } }, { datoriiAvans: { gt: 0.005 } });
  if (q.quick === "advance") and.push({ kind: "APA_CANAL" }, { status: { notIn: ["DRAFT", "CANCELLED"] } }, { datoriiAvans: { lt: -0.005 } });
  if (q.quick === "paidprev") and.push({ status: { notIn: ["DRAFT", "CANCELLED"] } }, { prevPaid: { gt: 0.005 } });
  if (q.quick === "settled") and.push({ kind: "APA_CANAL" }, { status: { notIn: ["DRAFT", "CANCELLED"] } }, { datoriiAvans: { lte: 0.005 } });
  if (q.quick === "partial") and.push({ status: { notIn: ["DRAFT", "CANCELLED"] } }, { prevPaid: { gt: 0.005 } }, { datoriiAvans: { gt: 0.005 } });
  const dayStart = (key: string) => {
    const d = dayOfKey(key);
    return d == null ? null : new Date(d * 86_400_000 - bucharestOffsetMs(d * 86_400_000));
  };
  const range = (field: "issueDate" | "dueDate" | "paidAt", from: string, to: string) => {
    const a = dayStart(from), b = dayOfKey(to) == null ? null : new Date(dayStart(to)!.getTime() + 86_400_000);
    if (!a && !b) return;
    and.push({ [field]: { ...(a ? { gte: a } : {}), ...(b ? { lt: b } : {}) } } as Prisma.InvoiceWhereInput);
  };
  range("issueDate", q.issueFrom, q.issueTo);
  range("dueDate", q.dueFrom, q.dueTo);
  range("paidAt", q.paidFrom, q.paidTo);

  const tokens = q.q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  let clientNames: Map<string, string> | null = null;
  // Un singur cuvânt care seamănă cu începutul unui număr de factură: întâi căutăm după prefix (folosește indexul pe număr — instant și la sute de mii de facturi);
  // doar dacă nu găsim nimic trecem la căutarea „conține” în număr / consumator / cont personal / nume client (citește toată perioada).
  if (tokens.length === 1 && /^[a-z0-9][a-z0-9._/-]{2,}$/i.test(q.q.trim())) {
    const raw = q.q.trim();
    const byNumber: Prisma.InvoiceWhereInput = { AND: [...and, { OR: [{ number: { startsWith: raw } }, { number: { startsWith: raw.toUpperCase() } }] }] };
    const [found, n] = await Promise.all([
      prisma.invoice.findMany({ where: byNumber, select: TUPLE_SELECT, orderBy: { number: "asc" }, skip: (Math.max(1, page) - 1) * ps, take: ps }),
      prisma.invoice.count({ where: byNumber }),
    ]);
    if (n > 0) {
      const names = found.some((r) => r.clientId) ? await allClientNames() : new Map<string, string>();
      const totalPages = Math.max(1, Math.ceil(n / ps));
      const val: ServerPage = {
        items: found.map((r) => toListItem(decodeInvoices([toTuple(r, r.clientId ? (names.get(r.clientId) ?? null) : null)])[0])),
        total: n, totalPages, page: Math.min(Math.max(1, page), totalPages),
      };
      S.lists.set(key, { at: Date.now(), val });
      return val;
    }
  }
  if (tokens.length) {
    clientNames = await allClientNames();
    for (const tk of tokens) {
      const ids: string[] = [];
      for (const [id, name] of clientNames) if (name.toLowerCase().includes(tk)) { ids.push(id); if (ids.length >= 300) break; } // `id in [mii]` e lent pe MongoDB
      and.push({
        OR: [
          { number: { contains: tk, mode: "insensitive" } },
          { consumerName: { contains: tk, mode: "insensitive" } },
          { contPersonal: { contains: tk, mode: "insensitive" } },
          ...(ids.length ? [{ clientId: { in: ids } }] : []),
        ],
      });
    }
  }
  const where: Prisma.InvoiceWhereInput = and.length ? { AND: and } : {};
  const orderBy: Prisma.InvoiceOrderByWithRelationInput =
    q.sort && PRIMARY_SORT.has(q.sort) ? (q.sort === "issue" ? { issueDate: q.dir } : { number: q.dir }) : { createdAt: "desc" };
  // fără filtre: totalul îl știm din index (fără să numărăm colecția)
  const knownTotal = and.length === 0 ? months.reduce((s, m) => s + m.count, 0) : null;
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({ where, select: TUPLE_SELECT, orderBy, skip: (Math.max(1, page) - 1) * ps, take: ps }),
    knownTotal != null && knownTotal > 0 ? Promise.resolve(knownTotal) : prisma.invoice.count({ where }),
  ]);
  const names = clientNames ?? (rows.some((r) => r.clientId) ? await allClientNames() : new Map<string, string>());
  const totalPages = Math.max(1, Math.ceil(total / ps));
  const val: ServerPage = {
    items: rows.map((r) => toListItem(decodeInvoices([toTuple(r, r.clientId ? (names.get(r.clientId) ?? null) : null)])[0])),
    total, totalPages, page: Math.min(Math.max(1, page), totalPages),
  };
  if (S.lists.size > 200) S.lists.clear();
  S.lists.set(key, { at: Date.now(), val });
  return val;
}

