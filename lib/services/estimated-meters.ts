import "server-only";
import { prisma } from "../prisma";
import { currentPeriod, shiftPeriod } from "../meter-readings";
import { isEstimatedSource } from "../meters";
import { parseMeterId } from "../queries/meters";
import { getMeterSnap } from "./meter-cache";

/**
 * Raportul „contoare estimate”: contoarele a căror citire a fost CALCULATĂ (estimată, „Расчетный”), nu făcută de un cititor, în fiecare dintre ultimele N luni la rând —
 * deci contoare pe care nimeni nu le-a citit în perioada aceea. O lună nu e „estimată” dacă a avut o citire reală: din 1C (altă sursă decât cea calculată) sau din CRM
 * (cititor, portal sau LoRaWAN). O lună fără nicio citire în date întrerupe șirul (nu se presupune estimare).
 *
 * Istoricul lunilor vine din documentele 1C (OneCRecord), citite printr-o agregare care aduce doar contorul, data și sursa fiecărei citiri (nu documentele întregi).
 * Rezultatul se ține 10 minute în memorie, pe numărul de luni.
 */

export type EstimatedMeter = { id: string; contor: string; name: string; address: string | null; sector: string | null };
export type EstimatedReport = { months: string[]; rows: EstimatedMeter[]; builtAt: number; scanned: number };

const TTL_MS = 10 * 60_000;
const g = globalThis as unknown as { __estReport?: Map<number, { at: number; p: Promise<EstimatedReport> }> };
const cache = (g.__estReport ??= new Map());

type Slim = { c?: string | null; k?: string | null; n?: string | null; d?: string | null; r?: { o?: string | null; d?: string | null; s?: string | null }[] };

const subscriberKey = (r: Slim) => (r.c ? `c:${r.c}` : r.k ? `k:${r.k}` : `n:${(r.n ?? "").trim().toLowerCase()}`);

async function build(n: number): Promise<EstimatedReport> {
  const now = currentPeriod();
  // luna de sfârșit = cea mai recentă lună cu documente 1C (cel mult luna curentă), ca perioada să nu se încheie într-o lună fără date
  const start = shiftPeriod(now, n + 1);
  const raw = (await prisma.oneCRecord.aggregateRaw({
    pipeline: [
      { $match: { dataDoc: { $gte: `${start}-01` } } },
      { $project: { _id: 0, c: "$contPersonal", k: "$nrContract", n: "$nume", d: "$dataDoc", r: { $map: { input: { $ifNull: ["$readings", []] }, as: "x", in: { o: "$$x.contor", d: "$$x.dataCitire", s: "$$x.sursa" } } } } },
    ] as never,
    options: { allowDiskUse: true },
  })) as unknown as Slim[];

  let end = "";
  for (const doc of raw) {
    const m = (doc.d ?? "").slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(m) && m <= now && m > end) end = m;
  }
  if (!end) return { months: [], rows: [], builtAt: Date.now(), scanned: raw.length };
  const months = Array.from({ length: n }, (_, i) => shiftPeriod(end, n - 1 - i)); // vechi → nou
  const inWindow = new Set(months);

  // (abonat~contor, lună) → ultima citire din lună și dacă a fost estimată
  const last = new Map<string, { d: string; est: boolean }>();
  for (const doc of raw) {
    const sub = subscriberKey(doc);
    for (const r of doc.r ?? []) {
      if (!r.o) continue;
      const day = (r.d ?? doc.d ?? "").slice(0, 10);
      const month = day.slice(0, 7);
      if (!inWindow.has(month)) continue;
      const key = `${sub}~${r.o}|${month}`;
      const cur = last.get(key);
      const est = isEstimatedSource(r.s);
      if (!cur || day > cur.d || (day === cur.d && !est)) last.set(key, { d: day, est });
    }
  }

  // citirile reale din CRM în perioadă (cititor / portal / LoRaWAN) întrerup șirul de estimări
  const real = new Set<string>();
  const crm = await prisma.meterReading.findMany({ where: { period: { in: months } }, select: { meterId: true, period: true } });
  for (const r of crm) real.add(`${r.meterId}|${r.period}`);

  const snap = await getMeterSnap();
  const rows: EstimatedMeter[] = [];
  for (const r of snap.rows) {
    if (r.removedAt || r.source !== "1c") continue;
    const p = parseMeterId(r.id);
    if (!p) continue;
    let all = true;
    for (const m of months) {
      const x = last.get(`${p.subKey}~${p.contor}|${m}`);
      if (!x || !x.est || real.has(`${r.id}|${m}`)) {
        all = false;
        break;
      }
    }
    if (all) rows.push({ id: r.id, contor: r.contor, name: r.name, address: r.address, sector: r.uch });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "ro") || a.contor.localeCompare(b.contor, "ro", { numeric: true }));
  console.log(`[estimated-meters] ${n} luni (${months[0]}…${end}): ${rows.length} contoare, ${raw.length} documente 1C`);
  return { months, rows, builtAt: Date.now(), scanned: raw.length };
}

/** Contoarele estimate în fiecare dintre ultimele `n` luni (2–12), din memorie dacă raportul e recent. */
export function estimatedMeters(n: number): Promise<EstimatedReport> {
  const months = Math.min(12, Math.max(2, Math.floor(n) || 3));
  const hit = cache.get(months);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = build(months);
  p.catch(() => cache.delete(months));
  cache.set(months, { at: Date.now(), p });
  return p;
}
