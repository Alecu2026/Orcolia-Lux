import "server-only";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { listInvoices } from "../queries/invoices";
import {
  INVOICE_STATUS_CODES,
  decodeInvoices,
  encodeInvoices,
  filterInvoices,
  toListItem,
  type InvTuple,
  type InvoiceFilters,
  type InvoiceListItem,
  type InvRow,
} from "../invoice-list";

/**
 * Cache-ul listei de facturi — același model ca lista de plătitori (lib/services/payer-cache.ts), vezi acolo explicațiile:
 * memorie (L1) → un rând în baza de date, comprimat gzip, partajat între instanțe (L2) → reconstruire din facturi, doar la nevoie
 * (o dată pe zi, la modificări, când lipsește). Revalidare „stale-while-revalidate" pentru vechimea de 24 h; modificările „tari" (factură
 * creată / editată / ștearsă / status) fac cititorii să aștepte datele proaspete, cele „moi" (nume client) se reîmprospătează în fundal.
 *
 * Diferența: lista de facturi poate fi mult mai mare decât cea de plătitori (o factură pe plătitor pe lună). Peste \`INVOICE_SNAPSHOT_MAX\`
 * (implicit 150.000) NU se mai trimite tot setul în browser: modul devine „server" (paginare/filtrare în baza de date, cu cache scurt
 * pe rezultate), iar browserul folosește /api/invoices/list.
 */

const ID = "inv:snapshot";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const META_CHECK_MS = 10_000;
const HARD_DELAY_MS = 1_200;
const SOFT_DELAY_MS = 8_000;
const SNAPSHOT_MAX = Math.max(1, Number(process.env.INVOICE_SNAPSHOT_MAX) || 150_000);

export type InvoiceSnap = {
  version: string;
  builtAt: number;
  /** "snapshot" = toate facturile în `rows` (și în browser); "server" = prea multe, se filtrează în baza de date. */
  mode: "snapshot" | "server";
  total: number;
  gz: Buffer;
  rows: InvRow[];
};

type Artifact = { v: 1; at: number; mode: "snapshot" | "server"; total: number; rows: InvTuple[] };

let l1: InvoiceSnap | null = null;
let l1CheckedAt = 0;
let localHardDirtyAt = 0;
let localSoftDirtyAt = 0;
let building: Promise<InvoiceSnap> | null = null;
let rebuildScheduled = false;
/** Câte modificări locale (syncInvoiceToCache) s-au aplicat peste snapshot-ul curent; 0 = varianta comprimată din L1/L2 e la zi. */
let patchSeq = 0;
let patchedPayload: { seq: number; gz: Buffer; version: string } | null = null;
const serverListCache = new Map<string, { at: number; val: ServerPage }>();

type ServerPage = { items: InvoiceListItem[]; total: number; totalPages: number; page: number };

function toSnap(a: Artifact, gz: Buffer, version: string): InvoiceSnap {
  return { version, builtAt: a.at, mode: a.mode, total: a.total, gz, rows: decodeInvoices(a.rows) };
}

async function readMeta() {
  return prisma.payerCacheEntry.findUnique({ where: { id: ID }, select: { version: true, builtAt: true, dirtyAt: true, softDirtyAt: true } });
}

async function loadFromDb(): Promise<InvoiceSnap | null> {
  const row = await prisma.payerCacheEntry.findUnique({ where: { id: ID }, select: { version: true, gz: true } });
  if (!row) return null;
  try {
    const gz = Buffer.from(row.gz);
    const art = JSON.parse(gunzipSync(gz).toString("utf8")) as Artifact;
    if (art.v !== 1 || !Array.isArray(art.rows)) return null;
    return toSnap(art, gz, row.version);
  } catch (e) {
    console.error("[invoice-cache] rândul din baza de date e ilizibil, îl reconstruiesc:", e);
    return null;
  }
}

const TUPLE_SELECT = {
  id: true, number: true, status: true, kind: true, issueDate: true, dueDate: true, paidAt: true, grandTotal: true, currency: true,
  publicToken: true, consumerName: true, contPersonal: true, clientId: true,
} as const;

type TupleSource = {
  id: string; number: string; status: string; kind: string; issueDate: Date; dueDate: Date | null; paidAt: Date | null; grandTotal: number;
  currency: string; publicToken: string; consumerName: string | null; contPersonal: string | null;
};
function toTuple(r: TupleSource, clientName: string | null): InvTuple {
  return [
    r.id, r.number, Math.max(0, INVOICE_STATUS_CODES.indexOf(r.status as (typeof INVOICE_STATUS_CODES)[number])), r.kind === "APA_CANAL" ? 1 : 0,
    r.issueDate.getTime(), r.dueDate ? r.dueDate.getTime() : null, r.paidAt ? r.paidAt.getTime() : null,
    r.grandTotal, r.currency, clientName, r.publicToken,
    [r.consumerName, r.contPersonal].filter(Boolean).join("\n") || null,
  ];
}

/**
 * Modificarea unei singure facturi (creare / editare / status / ștergere): o citim din baza de date și o punem DIRECT în memoria acestui proces
 * (inserată prima dacă e nouă, înlocuită la locul ei dacă există, scoasă dacă a fost ștearsă). Așa lista de pe server e corectă imediat, fără
 * să așteptăm reconstruirea completă (zeci de mii de facturi = câteva secunde); varianta comprimată pentru browsere și celelalte instanțe se
 * reface în fundal (modificare „moale"). Folosit împreună cu `invalidateInvoices({ soft: true })`.
 */
export async function syncInvoiceToCache(id: string): Promise<void> {
  if (DEMO || !l1 || l1.mode !== "snapshot") return;
  try {
    const r = await prisma.invoice.findUnique({ where: { id }, select: { ...TUPLE_SELECT, client: { select: { name: true } } } });
    const cur = l1;
    if (!cur || cur.mode !== "snapshot") return;
    const idx = cur.rows.findIndex((x) => x.id === id);
    let rows: InvRow[];
    if (!r) {
      if (idx < 0) return;
      rows = cur.rows.slice(0, idx).concat(cur.rows.slice(idx + 1));
    } else {
      const [row] = decodeInvoices([toTuple(r, r.client?.name ?? null)]);
      rows = idx >= 0 ? cur.rows.map((x, i) => (i === idx ? row : x)) : [row, ...cur.rows];
    }
    l1 = { ...cur, rows, total: rows.length };
    patchSeq++;
    patchedPayload = null;
    serverListCache.clear();
  } catch (e) {
    console.error("[invoice-cache] nu am putut pune factura în memorie:", e);
  }
}

/** Reconstruiește de la zero și salvează în L2. O singură execuție la un moment dat. */
export function rebuildInvoiceSnap(reason = "manual"): Promise<InvoiceSnap> {
  if (building) return building;
  building = (async () => {
    const t0 = Date.now();
    const startedAt = new Date();
    const total = await prisma.invoice.count();
    let mode: Artifact["mode"] = "snapshot";
    let tuples: InvTuple[] = [];
    if (total > SNAPSHOT_MAX) {
      mode = "server";
    } else {
      const [invoices, clients] = await Promise.all([
        prisma.invoice.findMany({
          select: TUPLE_SELECT,
          orderBy: { createdAt: "desc" },
        }),
        prisma.client.findMany({ select: { id: true, name: true } }),
      ]);
      const nameById = new Map(clients.map((c) => [c.id, c.name]));
      tuples = invoices.map((r) => toTuple(r, r.clientId ? (nameById.get(r.clientId) ?? null) : null));
    }
    const art: Artifact = { v: 1, at: startedAt.getTime(), mode, total, rows: tuples };
    const gz = gzipSync(Buffer.from(JSON.stringify(art), "utf8"), { level: 6 });
    const version = createHash("sha1").update(gz).digest("hex").slice(0, 16);
    try {
      const data = { version, builtAt: startedAt, rows: tuples.length, gz: Uint8Array.from(gz) };
      const upd = await prisma.payerCacheEntry.updateMany({ where: { id: ID }, data });
      if (upd.count === 0) await prisma.payerCacheEntry.create({ data: { id: ID, ...data } });
    } catch (e) {
      console.error("[invoice-cache] nu am putut salva în baza de date (rămâne doar în memorie):", e);
    }
    const snap = toSnap(art, gz, version);
    l1 = snap;
    patchSeq = 0;
    patchedPayload = null;
    l1CheckedAt = Date.now();
    serverListCache.clear();
    console.log(`[invoice-cache] reconstruit (${reason}): ${mode}, ${total} facturi, ${(gz.length / 1e6).toFixed(2)} MB comprimat, ${Date.now() - t0} ms`);
    return snap;
  })().finally(() => {
    building = null;
  });
  return building;
}

function runInBackground(fn: () => Promise<unknown>) {
  const safe = () => fn().catch((e) => console.error("[invoice-cache] eșec în fundal:", e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}

function scheduleRebuild(delayMs: number, reason: string) {
  if (rebuildScheduled) return;
  rebuildScheduled = true;
  runInBackground(async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    rebuildScheduled = false;
    await rebuildInvoiceSnap(reason);
  });
}

function agedOut(s: InvoiceSnap, builtAtMs = s.builtAt): InvoiceSnap {
  if (Date.now() - builtAtMs > MAX_AGE_MS) runInBackground(() => rebuildInvoiceSnap("24h"));
  return s;
}

/** Snapshot-ul curent: din memorie, altfel din baza de date, altfel reconstruit (doar când lipsește sau a fost modificat). */
export async function getInvoiceSnap(): Promise<InvoiceSnap> {
  if (DEMO) return { version: "demo", builtAt: Date.now(), mode: "snapshot", total: 0, gz: gzipSync(Buffer.from('{"v":1,"at":0,"mode":"snapshot","total":0,"rows":[]}')), rows: [] };
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
          patchSeq = 0;
          patchedPayload = null;
          serverListCache.clear();
        }
        const soft = (!!meta.softDirtyAt && meta.softDirtyAt.getTime() > builtMs) || localSoftDirtyAt > builtMs;
        if (soft) scheduleRebuild(SOFT_DELAY_MS, "modificare minoră");
        return agedOut(cur, builtMs);
      }
    }
  }
  return rebuildInvoiceSnap(meta ? "modificat" : "lipsește");
}

/** Versiunea (ETag) a listei CA ȘI-O VEDE browserul: se schimbă și la modificările locale încă nereflectate în varianta comprimată din baza de date. */
export function payloadVersion(snap: InvoiceSnap): string {
  return patchSeq > 0 && snap === l1 ? `${snap.version}p${patchSeq}` : snap.version;
}

/** Ce se trimite browserului: varianta comprimată curentă, sau — dacă s-au aplicat modificări locale — una refăcută pe loc din memorie (o singură dată per rafală). */
export async function getInvoicePayload(): Promise<{ version: string; gz: Buffer; mode: InvoiceSnap["mode"] }> {
  const snap = await getInvoiceSnap();
  if (patchSeq === 0 || snap !== l1 || snap.mode !== "snapshot") return { version: snap.version, gz: snap.gz, mode: snap.mode };
  const seq = patchSeq;
  if (patchedPayload?.seq === seq) return { version: patchedPayload.version, gz: patchedPayload.gz, mode: snap.mode };
  const art: Artifact = { v: 1, at: snap.builtAt, mode: "snapshot", total: snap.rows.length, rows: encodeInvoices(snap.rows) };
  const gz = gzipSync(Buffer.from(JSON.stringify(art), "utf8"), { level: 4 });
  const version = `${snap.version}p${seq}`;
  if (seq === patchSeq) patchedPayload = { seq, gz, version };
  return { version, gz, mode: snap.mode };
}

/** Anunță că s-au schimbat facturi (sau numele unui client de pe ele). Nu aruncă niciodată. \`soft\`: modificare minoră (nume client). */
export async function invalidateInvoices(opts: { soft?: boolean } = {}): Promise<void> {
  if (DEMO) return;
  const soft = !!opts.soft;
  if (soft) localSoftDirtyAt = Date.now();
  else localHardDirtyAt = Date.now();
  serverListCache.clear();
  try {
    await prisma.payerCacheEntry.updateMany({ where: { id: ID }, data: soft ? { softDirtyAt: new Date() } : { dirtyAt: new Date() } });
  } catch (e) {
    console.error("[invoice-cache] nu am putut marca modificarea:", e);
  }
  scheduleRebuild(soft ? SOFT_DELAY_MS : HARD_DELAY_MS, soft ? "modificare minoră" : "după modificare");
}

/** Pentru cron-ul zilnic: reface cache-ul dacă lipsește, e depășit sau are > 20 h. */
export async function prewarmInvoices(): Promise<boolean> {
  if (DEMO) return false;
  const meta = await readMeta();
  const builtMs = meta?.builtAt.getTime() ?? 0;
  const stale = !meta || Date.now() - builtMs > 20 * 60 * 60 * 1000 || (!!meta.dirtyAt && meta.dirtyAt.getTime() > builtMs) || (!!meta.softDirtyAt && meta.softDirtyAt.getTime() > builtMs);
  if (!stale) return false;
  await rebuildInvoiceSnap("cron zilnic");
  return true;
}

const PS_SERVER_MAX = 1000;

/** O pagină din listă, pentru randarea pe server și pentru /api/invoices/list. În modul „server" citește din baza de date (cu cache scurt). */
export async function listInvoicesPage(filters: InvoiceFilters, page: number, perPage: number): Promise<ServerPage & { mode: InvoiceSnap["mode"]; version: string | null }> {
  const snap = await getInvoiceSnap();
  if (snap.mode === "snapshot") {
    const list = filterInvoices(snap.rows, filters);
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    const p = Math.min(Math.max(1, page), totalPages);
    return { items: list.slice((p - 1) * perPage, p * perPage).map(toListItem), total: list.length, totalPages, page: p, mode: "snapshot", version: payloadVersion(snap) };
  }
  const ps = Math.min(perPage, PS_SERVER_MAX);
  const key = `${filters.status}|${filters.q.trim().toLowerCase()}|${page}|${ps}`;
  const hit = serverListCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return { ...hit.val, mode: "server", version: snap.version };
  const status = (INVOICE_STATUS_CODES as readonly string[]).includes(filters.status) ? (filters.status as (typeof INVOICE_STATUS_CODES)[number]) : undefined;
  let res = await listInvoices({ status, search: filters.q, page, perPage: ps });
  if (page > res.totalPages) res = await listInvoices({ status, search: filters.q, page: res.totalPages, perPage: ps });
  const val: ServerPage = {
    items: res.items.map((r) => ({
      id: r.id, number: r.number, status: r.status, kind: r.kind, issueDate: r.issueDate.toISOString(), dueDate: r.dueDate ? r.dueDate.toISOString() : null,
      paidAt: r.paidAt ? r.paidAt.toISOString() : null, grandTotal: r.grandTotal, currency: r.currency, clientName: r.clientName, publicToken: r.publicToken,
    })),
    total: res.total, totalPages: res.totalPages, page: res.page,
  };
  if (serverListCache.size > 200) serverListCache.clear();
  serverListCache.set(key, { at: Date.now(), val });
  return { ...val, mode: "server", version: snap.version };
}

/** Prima pagină pentru /invoices; dacă cache-ul nu poate fi folosit (ex. fără `prisma generate`), revine la interogarea veche. */
export async function ssrInvoicePage(filters: InvoiceFilters, page: number, perPage: number) {
  try {
    return await listInvoicesPage(filters, page, perPage);
  } catch (e) {
    console.error("[invoice-cache] cache indisponibil, citesc din baza de date:", e);
    const status = (INVOICE_STATUS_CODES as readonly string[]).includes(filters.status) ? (filters.status as (typeof INVOICE_STATUS_CODES)[number]) : undefined;
    let res = await listInvoices({ status, search: filters.q, page, perPage: Math.min(perPage, PS_SERVER_MAX) });
    if (page > res.totalPages) res = await listInvoices({ status, search: filters.q, page: res.totalPages, perPage: Math.min(perPage, PS_SERVER_MAX) });
    return {
      items: res.items.map((r) => ({
        id: r.id, number: r.number, status: r.status, kind: r.kind, issueDate: r.issueDate.toISOString(), dueDate: r.dueDate ? r.dueDate.toISOString() : null,
        paidAt: r.paidAt ? r.paidAt.toISOString() : null, grandTotal: r.grandTotal, currency: r.currency, clientName: r.clientName, publicToken: r.publicToken,
      })) as InvoiceListItem[],
      total: res.total, totalPages: res.totalPages, page: res.page, mode: "server" as const, version: null as string | null,
    };
  }
}
