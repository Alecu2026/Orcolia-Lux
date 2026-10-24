import "server-only";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import {
  countPayersNeedingNameFix, getPayerSnapshot, getPayerMonthSlice, listPayerMonths, listPayers, loadPayerMonths, normalizePerPage, type PayerRow,
} from "../queries/payers";
import { filtersToListOptsAsync, notifiedClientIds } from "../queries/payer-notify";
import {
  decodeMonth,
  decodeSnapshot,
  filterSnapshot,
  notifyCriterion,
  sortTuplesByName,
  type MonthTuple,
  type NotifyFilters,
  type SnapInvoice,
  type SnapRow,
  type SnapTuple,
} from "../payer-notify";

/**
 * Cache-ul listei de plătitori. Datele vin din 1C o dată pe zi (cron) și se modifică rar între timp, deci citirea lor din baza de
 * date (toți clienții + agregarea tuturor facturilor + datele de instalare, 3–20 s) NU se face la fiecare cerere:
 *
 *  1. L1 — memoria procesului: plătitorii decodați (gata de filtrat) + varianta comprimată pentru browser. Instantaneu.
 *  2. L2 — baza de date (PayerCacheEntry, un singur rând): partajat de toate instanțele (Vercel pornește oricâte), supraviețuiește
 *     repornirilor. Citirea ~1 MB comprimat durează sub o secundă, față de zeci de secunde pentru reconstruire.
 *  3. Reconstruirea completă: o singură dată pe zi (cron-ul zilnic / sincronizarea 1C o face înainte de dimineață), la orice
 *     modificare a datelor (`invalidatePayers`) și când lipsește complet.
 *
 * Revalidare (stil ISR „stale-while-revalidate"):
 *  - mai vechi de 24 h → se servește imediat versiunea existentă, iar reconstruirea rulează în fundal;
 *  - modificat (dirtyAt > builtAt) → NU servim date vechi (altfel „am salvat, dar se vede valoarea veche"): cititorul așteaptă
 *    reconstruirea (single-flight: toți așteaptă aceeași execuție), care e pornită oricum imediat după modificare.
 */

const ID = "snapshot";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const META_CHECK_MS = 10_000; // cel mult o citire de metadate din baza de date la 10 s pe instanță
const HARD_DELAY_MS = 1_200; // modificările în rafală (import, lot de facturi) se grupează într-o singură reconstruire
const SOFT_DELAY_MS = 8_000; // modificările minore (ex. loturi de notificări) se grupează și mai mult

export type PayerSnap = {
  /** ETag-ul listei: se schimbă la fiecare reconstruire. */
  version: string;
  builtAt: number;
  /** JSON-ul comprimat gzip, exact ce primește browserul. */
  gz: Buffer;
  rows: SnapRow[];
  months: { month: string; count: number }[];
  nameFixCount: number;
};

type Artifact = { v: 2; at: number; sorted: true; rows: SnapTuple[]; months: { month: string; count: number }[] };

let l1: PayerSnap | null = null;
let l1CheckedAt = 0;
let localHardDirtyAt = 0;
let localSoftDirtyAt = 0;
let building: Promise<PayerSnap> | null = null;
let rebuildScheduled = false;
const monthCache = new Map<string, { gz: Buffer; tuples: MonthTuple[]; map: Map<string, SnapInvoice> }>();

function toSnap(a: Artifact, gz: Buffer, version: string): PayerSnap {
  const rows = decodeSnapshot(a.rows, true);
  return { version, builtAt: a.at, gz, rows, months: a.months, nameFixCount: rows.reduce((n, r) => (r.name.includes("?") ? n + 1 : n), 0) };
}

async function readMeta() {
  return prisma.payerCacheEntry.findUnique({ where: { id: ID }, select: { version: true, builtAt: true, dirtyAt: true, softDirtyAt: true } });
}

/** Citește din baza de date, decodează și folosește ca L1. null dacă rândul lipsește sau nu se poate citi. */
async function loadFromDb(): Promise<PayerSnap | null> {
  const row = await prisma.payerCacheEntry.findUnique({ where: { id: ID }, select: { version: true, gz: true } });
  if (!row) return null;
  try {
    const gz = Buffer.from(row.gz);
    const art = JSON.parse(gunzipSync(gz).toString("utf8")) as Artifact;
    if (art.v !== 2 || !Array.isArray(art.rows)) return null;
    return toSnap(art, gz, row.version);
  } catch (e) {
    console.error("[payer-cache] rândul din baza de date e ilizibil, îl reconstruiesc:", e);
    return null;
  }
}

/** Reconstruiește de la zero din baza de date și salvează în L2. O singură execuție la un moment dat. */
export function rebuildPayerSnap(reason = "manual"): Promise<PayerSnap> {
  if (building) return building;
  building = (async () => {
    const t0 = Date.now();
    const startedAt = new Date(); // „datele sunt cel târziu de la acest moment": o modificare ulterioară rămâne marcată ca depășită
    const [tuples, months] = await Promise.all([getPayerSnapshot(), loadPayerMonths()]);
    const art: Artifact = { v: 2, at: startedAt.getTime(), sorted: true, rows: sortTuplesByName(tuples), months };
    const gz = gzipSync(Buffer.from(JSON.stringify(art), "utf8"), { level: 6 });
    const version = createHash("sha1").update(gz).digest("hex").slice(0, 16);
    try {
      const data = { version, builtAt: startedAt, rows: tuples.length, gz };
      const upd = await prisma.payerCacheEntry.updateMany({ where: { id: ID }, data });
      if (upd.count === 0) await prisma.payerCacheEntry.create({ data: { id: ID, ...data } });
    } catch (e) {
      console.error("[payer-cache] nu am putut salva în baza de date (rămâne doar în memorie):", e);
    }
    const snap = toSnap(art, gz, version);
    l1 = snap;
    l1CheckedAt = Date.now();
    monthCache.clear();
    console.log(`[payer-cache] reconstruit (${reason}): ${tuples.length} plătitori, ${(gz.length / 1e6).toFixed(2)} MB comprimat, ${Date.now() - t0} ms`);
    return snap;
  })().finally(() => {
    building = null;
  });
  return building;
}

/** Pentru cron-ul zilnic: reface cache-ul dacă lipsește, e depășit sau mai vechi de 20 h (sincronizarea 1C îl reface oricum la fiecare scriere). */
export async function prewarmPayers(): Promise<boolean> {
  if (DEMO) return false;
  const meta = await readMeta();
  const builtMs = meta?.builtAt.getTime() ?? 0;
  const stale = !meta || Date.now() - builtMs > 20 * 60 * 60 * 1000 || (!!meta.dirtyAt && meta.dirtyAt.getTime() > builtMs) || (!!meta.softDirtyAt && meta.softDirtyAt.getTime() > builtMs);
  if (!stale) return false;
  await rebuildPayerSnap("cron zilnic");
  return true;
}

/** Rulează `fn` după răspuns când suntem într-o cerere (serverless nu oprește funcția înainte), altfel imediat în fundal. */
function runInBackground(fn: () => Promise<unknown>) {
  const safe = () => fn().catch((e) => console.error("[payer-cache] eșec în fundal:", e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}

/**
 * Snapshot-ul curent al plătitorilor. Întoarce de obicei din memorie; la nevoie citește din baza de date; reconstruiește doar când
 * lipsește sau a fost modificat.
 */
export async function getPayerSnap(): Promise<PayerSnap> {
  if (DEMO) return { version: "demo", builtAt: Date.now(), gz: gzipSync(Buffer.from('{"v":2,"at":0,"sorted":true,"rows":[],"months":[]}')), rows: [], months: [], nameFixCount: 0 };
  const now = Date.now();
  const hardLocal = !!l1 && localHardDirtyAt > l1.builtAt;

  if (l1 && !hardLocal && now - l1CheckedAt < META_CHECK_MS) return agedOut(l1);

  const meta = await readMeta();
  l1CheckedAt = Date.now();
  if (meta) {
    const builtMs = meta.builtAt.getTime();
    const hard = (!!meta.dirtyAt && meta.dirtyAt.getTime() > builtMs) || localHardDirtyAt > builtMs;
    if (!hard) {
      const cur = l1 && l1.version === meta.version ? l1 : await loadFromDb();
      if (cur) {
        if (cur !== l1) {
          l1 = cur;
          monthCache.clear();
        }
        // Modificare minoră: servim ce avem și reîmprospătăm în fundal.
        const soft = (!!meta.softDirtyAt && meta.softDirtyAt.getTime() > builtMs) || localSoftDirtyAt > builtMs;
        if (soft) scheduleRebuild(SOFT_DELAY_MS, "modificare minoră");
        return agedOut(cur, builtMs);
      }
    }
  }
  return rebuildPayerSnap(meta ? "modificat" : "lipsește");
}

/** Reconstruire în fundal, după o pauză în care modificările în rafală se strâng într-una singură. */
function scheduleRebuild(delayMs: number, reason: string) {
  if (rebuildScheduled) return;
  rebuildScheduled = true;
  runInBackground(async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    rebuildScheduled = false;
    await rebuildPayerSnap(reason);
  });
}

/** Mai vechi de 24 h → se servește imediat ce avem, iar reconstruirea rulează în fundal (stale-while-revalidate). */
function agedOut(s: PayerSnap, builtAtMs = s.builtAt): PayerSnap {
  if (Date.now() - builtAtMs > MAX_AGE_MS) runInBackground(() => rebuildPayerSnap("24h"));
  return s;
}

/**
 * Anunță că s-au schimbat date care intră în lista de plătitori (editare, notificare trimisă, factură, import…). Nu așteaptă
 * reconstruirea; aceasta pornește imediat în fundal, iar cine citește între timp așteaptă rezultatul proaspăt (nu date vechi).
 * Nu aruncă niciodată: o eroare aici nu trebuie să strice acțiunea utilizatorului.
 */
export async function invalidatePayers(opts: { soft?: boolean } = {}): Promise<void> {
  if (DEMO) return;
  const soft = !!opts.soft;
  if (soft) localSoftDirtyAt = Date.now();
  else localHardDirtyAt = Date.now();
  try {
    await prisma.payerCacheEntry.updateMany({ where: { id: ID }, data: soft ? { softDirtyAt: new Date() } : { dirtyAt: new Date() } });
  } catch (e) {
    console.error("[payer-cache] nu am putut marca modificarea:", e);
  }
  scheduleRebuild(soft ? SOFT_DELAY_MS : HARD_DELAY_MS, soft ? "modificare minoră" : "după modificare");
}

// ── Facturile unei luni (filtrul „Luna facturii"): 3 niveluri ca la lista principală — memorie, baza de date (valabil cât timp lista principală
//    are aceeași versiune), apoi citire din facturi. Servite comprimat; browserul le aduce în avans, deci alegerea unei luni e instant. ──
export async function getMonthSlice(month: string): Promise<{ gz: Buffer; tuples: MonthTuple[]; map: Map<string, SnapInvoice> }> {
  const snap = await getPayerSnap(); // asigură că L1 e la zi (și golește monthCache dacă s-a reconstruit)
  const hit = monthCache.get(month);
  if (hit) return hit;
  const rowId = `m:${month}`;
  let tuples: MonthTuple[] | null = null;
  let gz: Buffer | null = null;
  try {
    const row = await prisma.payerCacheEntry.findUnique({ where: { id: rowId }, select: { version: true, gz: true } });
    if (row && row.version === snap.version) {
      gz = Buffer.from(row.gz);
      tuples = (JSON.parse(gunzipSync(gz).toString("utf8")) as { rows: MonthTuple[] }).rows;
    }
  } catch (e) {
    console.error("[payer-cache] felia lunii din baza de date e ilizibilă:", e);
  }
  if (!tuples || !gz) {
    tuples = await getPayerMonthSlice(month);
    gz = gzipSync(Buffer.from(JSON.stringify({ month, rows: tuples }), "utf8"), { level: 6 });
    try {
      const data = { version: snap.version, builtAt: new Date(), rows: tuples.length, gz: Uint8Array.from(gz) };
      const upd = await prisma.payerCacheEntry.updateMany({ where: { id: rowId }, data });
      if (upd.count === 0) await prisma.payerCacheEntry.create({ data: { id: rowId, ...data } });
    } catch (e) {
      console.error("[payer-cache] nu am putut salva felia lunii:", e);
    }
  }
  const entry = { gz, tuples, map: decodeMonth(tuples) };
  monthCache.set(month, entry);
  return entry;
}

function toPayerRow(r: SnapRow): PayerRow {
  return {
    id: r.id, name: r.name, meterSeries: r.meterSeries, contract: r.contract, email: r.email, phone: r.phone, activated: r.activated,
    invoiceCount: r.invoiceCount, latestInvoice: r.latestInvoice, consumAddress: r.consumAddress, lastNotifiedAt: r.lastNotifiedAt, installedAt: r.installedAt,
  };
}

/** Filtrare + sortare + paginare pe server, tot din memorie (aceeași funcție ca motorul local din browser): fără interogări în baza de date. */
export async function listPayersFromSnap(filters: NotifyFilters, page: number, perPage: number): Promise<{ items: PayerRow[]; total: number; page: number; months: PayerSnap["months"]; nameFixCount: number; version: string | null }> {
  const snap = await getPayerSnap();
  const monthMap = filters.month ? (await getMonthSlice(filters.month)).map : null;
  const crit = notifyCriterion(filters);
  const notifySet = crit ? new Set(await notifiedClientIds(crit)) : null;
  const list = filterSnapshot(snap.rows, filters, monthMap, notifySet);
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return { items: list.slice((p - 1) * perPage, p * perPage).map(toPayerRow), total: list.length, page: p, months: snap.months, nameFixCount: snap.nameFixCount, version: snap.version };
}

/**
 * Prima pagină a listei, pentru randarea pe server a paginilor /platitori și /notificari-platitori: din cache (fără interogări în
 * baza de date); dacă cache-ul nu poate fi folosit (ex. tabela lipsește pe un server care n-a rulat încă `prisma generate`),
 * revine la interogările vechi — pagina nu se strică niciodată din cauza cache-ului.
 */
export async function ssrPayerPage(filters: NotifyFilters, page: number, perPage: number) {
  try {
    return await listPayersFromSnap(filters, page, perPage);
  } catch (e) {
    console.error("[payer-cache] cache indisponibil, citesc din baza de date:", e);
    const opts = { ...(await filtersToListOptsAsync(filters)), perPage: normalizePerPage(perPage) };
    const [first, months, nameFixCount] = await Promise.all([listPayers({ ...opts, page }), listPayerMonths(), countPayersNeedingNameFix()]);
    let res = first;
    let p = page;
    const last = Math.max(1, Math.ceil(first.total / perPage));
    if (p > last) {
      p = last;
      res = await listPayers({ ...opts, page: p });
    }
    return { items: res.items, total: res.total, page: p, months, nameFixCount, version: null as string | null };
  }
}
