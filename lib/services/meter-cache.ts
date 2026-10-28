import "server-only";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { after } from "next/server";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { buildMeterStatic, parseMeterId } from "../queries/meters";
import { getSectorMap } from "./meter-route-data";
import { getPayerSnap, type PayerSnap } from "./payer-cache";
import {
  decodeMeters,
  filterMeters,
  plainMeter,
  sortMeterTuples,
  type MeterFilters,
  type MeterRow,
  type MeterRowBase,
  type MeterStatic,
  type MeterTuple,
} from "../meters";

/**
 * Cache-ul listei de contoare, în DOUĂ straturi (ca să nu repetăm munca grea când se schimbă doar un plătitor):
 *
 *  1. Stratul STATIC — contoarele din exportul 1C/Axioma (citiri, instalări, sigilii, sume pe contor). Citirea lor din baza de date e grea
 *     (conținutul ultimei înregistrări a fiecărui abonat), dar datele se schimbă o dată pe zi, la sincronizarea 1C. Memorie → baza de date
 *     (PayerCacheEntry „meters-static", partajat între instanțe) → reconstruire. Se reface la sincronizarea 1C (`invalidateMeters`) și după 24 h.
 *  2. Stratul JOINT — static + datele plătitorului (nume, telefon, email, factura curentă, sector), alipite din lista de plătitori
 *     din memorie. Ieftin (zeci de milisecunde): se reface oricând se schimbă versiunea listei de plătitori sau a stratului static.
 *
 * Ce primește browserul (gzip + ETag) și ce filtrează serverul la prima afișare vine din stratul joint.
 */

const STATIC_ID = "meters-static";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const META_CHECK_MS = 10_000;
const REBUILD_DELAY_MS = 2_000;

// v2: id-uri stabile ale contoarelor (cheie abonat~nr. contor~k) — rândurile salvate cu v1 se ignoră și lista se reconstruiește
type StaticArtifact = { v: 2; at: number; rows: MeterStatic[] };
type StaticSnap = { version: string; builtAt: number; rows: MeterStatic[] };

let sl1: StaticSnap | null = null;
let slCheckedAt = 0;
let localDirtyAt = 0;
let sBuilding: Promise<StaticSnap> | null = null;
/** Reconstruirea pornită pentru că datele au fost modificate (sau lipsesc): cine citește între timp așteaptă rezultatul proaspăt, nu primește lista veche. */
let sDirtyBuild: Promise<StaticSnap> | null = null;
let rebuildScheduled = false;

async function readMeta() {
  return prisma.payerCacheEntry.findUnique({ where: { id: STATIC_ID }, select: { version: true, builtAt: true, dirtyAt: true } });
}

async function loadStaticFromDb(): Promise<StaticSnap | null> {
  const row = await prisma.payerCacheEntry.findUnique({ where: { id: STATIC_ID }, select: { version: true, gz: true } });
  if (!row) return null;
  try {
    const art = JSON.parse(gunzipSync(Buffer.from(row.gz)).toString("utf8")) as StaticArtifact;
    if (art.v !== 2 || !Array.isArray(art.rows)) return null;
    return { version: row.version, builtAt: art.at, rows: art.rows };
  } catch (e) {
    console.error("[meter-cache] rândul din baza de date e ilizibil, îl reconstruiesc:", e);
    return null;
  }
}

/** Reconstruiește partea statică din baza de date și o salvează (o singură execuție la un moment dat). */
export function rebuildMeterStatic(reason = "manual"): Promise<StaticSnap> {
  if (sBuilding) return sBuilding;
  sBuilding = (async () => {
    const t0 = Date.now();
    const startedAt = new Date(); // „datele sunt cel târziu de la acest moment": o modificare ulterioară rămâne marcată ca depășită
    const rows = await buildMeterStatic();
    const art: StaticArtifact = { v: 2, at: startedAt.getTime(), rows };
    const gz = gzipSync(Buffer.from(JSON.stringify(art), "utf8"), { level: 6 });
    const version = createHash("sha1").update(gz).digest("hex").slice(0, 16);
    try {
      const data = { version, builtAt: startedAt, rows: rows.length, gz: Uint8Array.from(gz) };
      const upd = await prisma.payerCacheEntry.updateMany({ where: { id: STATIC_ID }, data });
      if (upd.count === 0) await prisma.payerCacheEntry.create({ data: { id: STATIC_ID, ...data } });
    } catch (e) {
      console.error("[meter-cache] nu am putut salva în baza de date (rămâne doar în memorie):", e);
    }
    const snap: StaticSnap = { version, builtAt: startedAt.getTime(), rows };
    sl1 = snap;
    slCheckedAt = Date.now();
    console.log(`[meter-cache] contoare reconstruite (${reason}): ${rows.length} rânduri, ${(gz.length / 1e6).toFixed(2)} MB comprimat, ${Date.now() - t0} ms`);
    return snap;
  })().finally(() => {
    sBuilding = null;
  });
  return sBuilding;
}

function runInBackground(fn: () => Promise<unknown>) {
  const safe = () => fn().catch((e) => console.error("[meter-cache] eșec în fundal:", e));
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
    await rebuildMeterStatic(reason);
  });
}

function agedOut(s: StaticSnap): StaticSnap {
  if (Date.now() - s.builtAt > MAX_AGE_MS) runInBackground(() => rebuildMeterStatic("24h"));
  return s;
}

async function getMeterStatic(): Promise<StaticSnap> {
  if (DEMO) return { version: "demo", builtAt: Date.now(), rows: [] };
  if (sDirtyBuild) return sDirtyBuild;
  const now = Date.now();
  if (sl1 && localDirtyAt <= sl1.builtAt && now - slCheckedAt < META_CHECK_MS) return agedOut(sl1);

  const meta = await readMeta();
  slCheckedAt = Date.now();
  if (meta) {
    const builtMs = meta.builtAt.getTime();
    const dirty = (!!meta.dirtyAt && meta.dirtyAt.getTime() > builtMs) || localDirtyAt > builtMs;
    if (!dirty) {
      const cur = sl1 && sl1.version === meta.version ? sl1 : await loadStaticFromDb();
      if (cur) {
        sl1 = cur;
        return agedOut(cur);
      }
    }
  }
  const fresh = rebuildMeterStatic(meta ? "modificat" : "lipsește");
  sDirtyBuild = fresh;
  void fresh.then(
    () => { if (sDirtyBuild === fresh) sDirtyBuild = null; },
    () => { if (sDirtyBuild === fresh) sDirtyBuild = null; },
  );
  return fresh;
}

/**
 * Anunță că exportul 1C s-a schimbat (sincronizare/import). Nu așteaptă reconstruirea: aceasta pornește imediat în fundal, iar cine citește
 * între timp așteaptă rezultatul proaspăt (nu date vechi). Nu aruncă niciodată.
 */
export async function invalidateMeters(): Promise<void> {
  if (DEMO) return;
  localDirtyAt = Date.now();
  try {
    await prisma.payerCacheEntry.updateMany({ where: { id: STATIC_ID }, data: { dirtyAt: new Date() } });
  } catch (e) {
    console.error("[meter-cache] nu am putut marca modificarea:", e);
  }
  scheduleRebuild(REBUILD_DELAY_MS, "după sincronizarea 1C");
}

/** Pentru cron-ul zilnic: reface partea statică dacă lipsește, e depășită sau are mai mult de 20 h. */
export async function prewarmMeters(): Promise<boolean> {
  if (DEMO) return false;
  const meta = await readMeta();
  const builtMs = meta?.builtAt.getTime() ?? 0;
  const stale = !meta || Date.now() - builtMs > 20 * 60 * 60 * 1000 || (!!meta.dirtyAt && meta.dirtyAt.getTime() > builtMs);
  if (!stale) return false;
  await rebuildMeterStatic("cron zilnic");
  return true;
}

// ── Stratul joint (static + plătitori) ─────────────────────────────────────────────────────────

export type MeterSnap = {
  /** ETag-ul listei: se schimbă când se schimbă oricare strat. */
  version: string;
  builtAt: number;
  /** JSON-ul comprimat gzip, exact ce primește browserul. */
  gz: Buffer;
  rows: MeterRow[];
};

let jl1: { key: string; snap: MeterSnap } | null = null;
let jBuilding: { key: string; p: Promise<MeterSnap> } | null = null;

/** Alipește datele plătitorului la fiecare contor (după client; dacă legătura lipsește — după contul personal sau contract). */
function join(rows: MeterStatic[], pay: PayerSnap, sectors: Map<string, string>): MeterTuple[] {
  const byId = new Map(pay.rows.map((r) => [r.id, r]));
  const bySeries = new Map<string, string>();
  const byContract = new Map<string, string>();
  for (const r of pay.rows) {
    if (r.meterSeries) bySeries.set(r.meterSeries, r.id);
    if (r.contract) byContract.set(r.contract, r.id);
  }
  const out = rows.map((s): MeterTuple => {
    const cid = s[1] ?? (s[4] ? bySeries.get(s[4]) : undefined) ?? (s[5] ? byContract.get(s[5]) : undefined) ?? null;
    const p = cid ? byId.get(cid) : undefined;
    const inv = p?.latestInvoice ?? null;
    const t: MeterTuple = [
      s[0], cid, s[2], p?.name ?? s[3], s[4] ?? p?.meterSeries ?? null, s[5] ?? p?.contract ?? null,
      s[6] ?? p?.consumAddress ?? null, s[7], s[8], s[9], s[10], s[11],
      s[12], s[13], s[14], s[15], s[16],
      s[17], s[18], s[19], s[20], s[21],
      s[22], s[23], s[24],
      p?.phone ?? null, p?.email ?? null, p?.activated ? 1 : 0, (p ? p.meterSeries != null : s[4] != null) ? 1 : 0,
      inv?.number ?? null, inv?.status ?? null, inv?.grandTotal ?? null, inv?.currency ?? null, inv?.dueDate ? Date.parse(inv.dueDate) : null,
      p?.sector ?? null,
      sectors.get(parseMeterId(s[0])?.subKey ?? "") ?? null,
    ];
    return t;
  });
  return sortMeterTuples(out);
}

/** Lista curentă de contoare, gata de filtrat (în memorie) și de trimis browserului (gzip). Refăcută doar când se schimbă un strat. */
export async function getMeterSnap(): Promise<MeterSnap> {
  const [st, pay] = await Promise.all([getMeterStatic(), getPayerSnap()]);
  const key = `${st.version}.${pay.version}`;
  if (jl1 && jl1.key === key) return jl1.snap;
  if (jBuilding && jBuilding.key === key) return jBuilding.p;
  const p = (async () => {
    const t0 = Date.now();
    const tuples = join(st.rows, pay, await getSectorMap(st.version));
    const gz = gzipSync(Buffer.from(JSON.stringify({ v: 1, at: st.builtAt, sorted: true, rows: tuples }), "utf8"), { level: 6 });
    const snap: MeterSnap = { version: createHash("sha1").update(key).digest("hex").slice(0, 16), builtAt: st.builtAt, gz, rows: decodeMeters(tuples, true) };
    jl1 = { key, snap };
    console.log(`[meter-cache] lista alipită: ${tuples.length} contoare, ${(gz.length / 1e6).toFixed(2)} MB comprimat, ${Date.now() - t0} ms`);
    return snap;
  })().finally(() => {
    if (jBuilding?.key === key) jBuilding = null;
  });
  jBuilding = { key, p };
  return p;
}

/** Filtrare + sortare + paginare pe server, tot din memorie (aceeași funcție ca motorul din browser). */
export async function listMetersFromSnap(
  filters: MeterFilters,
  page: number,
  perPage: number,
): Promise<{ items: MeterRowBase[]; total: number; page: number; version: string }> {
  const snap = await getMeterSnap();
  const list = filterMeters(snap.rows, filters);
  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const p = Math.min(Math.max(1, page), pages);
  return { items: list.slice((p - 1) * perPage, p * perPage).map(plainMeter), total: list.length, page: p, version: snap.version };
}
