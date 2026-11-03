import "server-only";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { ONEC_COLUMNS } from "../apa-canal-1c";
import type { OneCPayload, OneCTuple } from "../onec-table";

/**
 * Tabelul 1C, ținut în memoria serverului ca listă compactă (tupluri), comprimată gzip și cu versiune (ETag) — ca la Plătitori și Contoare: nicio interogare grea la fiecare filtru,
 * iar browserul își păstrează lista (IndexedDB) și o reîntreabă condiționat (304). Un snapshot = o perioadă: „latest” (un rând per abonat, luna cea mai recentă) sau o lună „YYYY-MM”.
 * „Toate lunile” nu se ține în memorie (ar fi de zeci de ori mai mare): rămâne pe interogări server (vezi lib/queries/onec.ts).
 *
 * Snapshot-urile se refac la schimbări (import 1C, facturi, plătitori — vezi `invalidateOneC`) și cel târziu după 3 minute; se păstrează cel mult 3 perioade (cele folosite recent).
 * Memoria stă în globalThis (pachetele Next de producție nu partajează variabilele de modul).
 */

const TTL_MS = 3 * 60_000;
const MAX_PERIODS = 3;
const PERIOD_RE = /^\d{4}-\d{2}$/;
const TOL = 0.011;

export type OneCSnap = { period: string; version: string; builtAt: number; gz: Buffer; count: number };
type Slot = {
  snaps: Map<string, OneCSnap>;
  building: Map<string, Promise<OneCSnap>>;
  index: { at: number; latest: Map<string, string>; months: { month: string; count: number }[] } | null;
  indexBuilding: Promise<NonNullable<Slot["index"]>> | null;
  dirtyAt: number;
};
const g = globalThis as unknown as { __onec?: Slot };
const slot = (): Slot => (g.__onec ??= { snaps: new Map(), building: new Map(), index: null, indexBuilding: null, dirtyAt: 0 });

/** Ceva s-a schimbat (import 1C, facturi, plătitori): următoarea citire reface lista. Nu aruncă niciodată. */
export function invalidateOneC(): void {
  slot().dirtyAt = Date.now();
}

/** Perioada primită din URL adusă la una validă pentru snapshot („latest” sau „YYYY-MM”); „all” NU se ține în memorie (null). */
export function snapshotPeriod(raw: string | null): string | null {
  const v = (raw ?? "latest").trim();
  return v === "latest" || PERIOD_RE.test(v) ? v : null;
}

const subscriberKey = (r: { contPersonal: string | null; nrContract: string | null; nume: string | null }) =>
  r.contPersonal ? `c:${r.contPersonal}` : r.nrContract ? `k:${r.nrContract}` : `n:${(r.nume ?? "").trim().toLowerCase()}`;

type PeriodIndex = { latest: Map<string, string>; months: { month: string; count: number }[] };

/**
 * Indexul calculat în MongoDB (grupare pe server): se întoarce doar un rând per abonat și câte unul per lună, nu toate înregistrările 1C (sute de mii, cu toate lunile) — citirea
 * lor întreagă prin Prisma dura zeci de secunde la volumul real. Cheia abonatului e aceeași ca în `subscriberKey`; la același abonat și aceeași dată se alege primul înregistrat (id-ul cel mai mic), ca la citirea completă. `$top` cere MongoDB 5.2+; dacă serverul nu-l are, agregarea eșuează și se folosește varianta de rezervă.
 */
async function periodIndexViaMongo(): Promise<PeriodIndex> {
  const dd = { $ifNull: ["$dataDoc", ""] };
  const key = {
    $let: {
      vars: { cp: { $ifNull: ["$contPersonal", ""] }, nc: { $ifNull: ["$nrContract", ""] }, nm: { $toLower: { $trim: { input: { $ifNull: ["$nume", ""] } } } } },
      in: { $cond: [{ $ne: ["$$cp", ""] }, { $concat: ["c:", "$$cp"] }, { $cond: [{ $ne: ["$$nc", ""] }, { $concat: ["k:", "$$nc"] }, { $concat: ["n:", "$$nm"] }] }] },
    },
  };
  const [latestRaw, monthsRaw] = (await Promise.all([
    prisma.oneCRecord.aggregateRaw({
      pipeline: [
        { $project: { d: dd, k: key } },
        { $group: { _id: "$k", best: { $top: { sortBy: { d: -1, _id: 1 }, output: ["$d", { $toString: "$_id" }] } } } },
      ],
    }),
    prisma.oneCRecord.aggregateRaw({
      pipeline: [{ $project: { d: dd } }, { $match: { d: { $ne: "" } } }, { $group: { _id: { $substrCP: ["$d", 0, 7] }, n: { $sum: 1 } } }],
    }),
  ])) as unknown as [{ best: [string, string] }[], { _id: string; n: number }[]];
  const latest = new Map<string, string>();
  for (const r of latestRaw) {
    if (!Array.isArray(r.best) || typeof r.best[0] !== "string" || !/^[0-9a-f]{24}$/i.test(r.best[1])) throw new Error("agregare neașteptată");
    latest.set(r.best[1], r.best[0]);
  }
  const months = monthsRaw.map((m) => ({ month: m._id, count: m.n })).sort((a, b) => b.month.localeCompare(a.month));
  return { latest, months };
}

/** Varianta de rezervă (dacă agregarea pe server nu merge): citește toate înregistrările și grupează aici. */
async function periodIndexViaScan(): Promise<PeriodIndex> {
  const rows = await prisma.oneCRecord.findMany({ select: { id: true, contPersonal: true, nrContract: true, nume: true, dataDoc: true } });
  const best = new Map<string, { id: string; dataDoc: string }>();
  const months = new Map<string, number>();
  for (const r of rows) {
    const d = r.dataDoc ?? "";
    const m = d.slice(0, 7);
    if (m) months.set(m, (months.get(m) ?? 0) + 1);
    const k = subscriberKey(r);
    const prev = best.get(k);
    if (!prev || d > prev.dataDoc) best.set(k, { id: r.id, dataDoc: d });
  }
  return {
    latest: new Map([...best.values()].map((b) => [b.id, b.dataDoc] as [string, string])),
    months: [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([month, count]) => ({ month, count })),
  };
}

/** Cel mai recent document al fiecărui abonat (id → data documentului) + lunile disponibile; o singură citire cu câmpuri mici, partajată între perioade. */
async function periodIndex() {
  const s = slot();
  if (s.index && s.index.at > s.dirtyAt && Date.now() - s.index.at < TTL_MS) return s.index;
  if (!s.indexBuilding) {
    s.indexBuilding = (async () => {
      const at = Date.now();
      const base = await periodIndexViaMongo().catch((e) => {
        console.error("[onec-cache] agregarea pe server a eșuat, citesc toate înregistrările:", e);
        return periodIndexViaScan();
      });
      const idx = { at, ...base };
      s.index = idx;
      return idx;
    })().finally(() => {
      s.indexBuilding = null;
    });
  }
  return s.indexBuilding;
}

const SELECT: Record<string, true> = { id: true, clientId: true, invoiceNumber: true };
for (const c of ONEC_COLUMNS) SELECT[c.key] = true;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function build(period: string): Promise<OneCSnap> {
  const startedAt = Date.now();
  const idx = DEMO ? { latest: new Map<string, string>(), months: [] } : await periodIndex();
  type Rec = Record<string, string | number | null> & { id: string; clientId: string | null; invoiceNumber: string | null };
  let recs: Rec[] = [];
  if (!DEMO) {
    if (period === "latest") {
      // rândurile cele mai recente ale abonaților stau în câteva luni (de obicei cea mai nouă): citim lunile acelea întregi și păstrăm doar rândurile „latest”.
      // NU `id: { in: [...] }` cu ~19.000 de id-uri: MongoDB răspunde în zeci de secunde (măsurat).
      const monthsOfLatest = [...new Set([...idx.latest.values()].map((d) => d.slice(0, 7)))];
      const parts = await Promise.all(
        monthsOfLatest.map((m) =>
          // fără dată de document: câmpul poate lipsi din document, iar `null` nu potrivește câmpurile lipsă pe MongoDB — de-aia și `isSet: false`
          prisma.oneCRecord.findMany({ where: m ? { dataDoc: { startsWith: m } } : { OR: [{ dataDoc: null }, { dataDoc: { isSet: false } }, { dataDoc: "" }] }, select: SELECT as Prisma.OneCRecordSelect }),
        ),
      );
      recs = (parts.flat() as unknown as Rec[]).filter((r) => idx.latest.has(r.id));
    } else {
      recs = (await prisma.oneCRecord.findMany({ where: { dataDoc: { startsWith: period } }, select: SELECT as Prisma.OneCRecordSelect })) as unknown as Rec[];
    }
  }
  // totalul facturii din PWA, după număr (citit o dată; un `number: { in: [...] }` cu mii de valori ar fi lent)
  const invs = DEMO ? [] : await prisma.invoice.findMany({ where: { kind: "APA_CANAL" }, select: { number: true, grandTotal: true, publicToken: true } });
  const pwa = new Map(invs.map((i) => [i.number, i] as const));
  const keys = ONEC_COLUMNS.map((c) => c.key);
  const rows = recs.map((r): OneCTuple => {
    const num = typeof r.invoiceNumber === "string" && r.invoiceNumber ? r.invoiceNumber : null;
    const inv = num ? pwa.get(num) : undefined;
    const de = Number(r["deAchitat"]) || 0;
    const pwaTotal = inv ? inv.grandTotal : null;
    const diff = pwaTotal == null ? null : round2(pwaTotal - de);
    return [r.id, r.clientId ?? null, num, ...keys.map((k) => (r[k] ?? null) as string | number | null), pwaTotal, diff, inv?.publicToken ?? null];
  });
  const payload: OneCPayload = { v: 1, rows, months: idx.months };
  const gz = gzipSync(Buffer.from(JSON.stringify(payload), "utf8"), { level: 6 });
  const snap: OneCSnap = { period, version: createHash("sha1").update(gz).digest("hex").slice(0, 16), builtAt: startedAt, gz, count: rows.length };
  console.log(`[onec-cache] ${period}: ${rows.length} rânduri, ${(gz.length / 1e6).toFixed(2)} MB comprimat, ${Date.now() - startedAt} ms`);
  return snap;
}

/** Snapshot-ul unei perioade (din memorie, sau construit acum; o singură construire pe perioadă la un moment dat). */
export async function getOneCSnap(period: string): Promise<OneCSnap> {
  const s = slot();
  const cur = s.snaps.get(period);
  if (cur && cur.builtAt > s.dirtyAt && Date.now() - cur.builtAt < TTL_MS) {
    s.snaps.delete(period); // reintră ultimul = cel mai recent folosit
    s.snaps.set(period, cur);
    return cur;
  }
  let b = s.building.get(period);
  if (!b) {
    b = build(period)
      .then((snap) => {
        s.snaps.delete(period);
        s.snaps.set(period, snap);
        while (s.snaps.size > MAX_PERIODS) s.snaps.delete(s.snaps.keys().next().value as string);
        return snap;
      })
      .finally(() => {
        s.building.delete(period);
      });
    s.building.set(period, b);
  }
  return b;
}

/** Versiunea snapshot-ului curent, dacă e deja construit și proaspăt (altfel null) — fără să-l construiască. */
export function peekOneCVersion(period = "latest"): string | null {
  const s = slot();
  const cur = s.snaps.get(period);
  return cur && cur.builtAt > s.dirtyAt && Date.now() - cur.builtAt < TTL_MS ? cur.version : null;
}

export { TOL as ONEC_DIFF_TOLERANCE };
