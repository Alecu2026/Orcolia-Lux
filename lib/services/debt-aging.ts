import "server-only";
import { prisma } from "../prisma";
import { currentPeriod } from "../meter-readings";
import { AGING_BUCKETS, bucketOf, type AgingReport, type AgingRow } from "../debt-aging";
import { getPayerSnap } from "./payer-cache";

/**
 * Raportul datoriilor pe vechime. Plătitorii cu datorie = cei cu „Datorii (+)” pe ultima factură (lista din memorie); vechimea = luna celei mai vechi facturi Apă-Canal rămase
 * neachitate (statusul Trimisă / Restantă din lanțul de plăți), dintr-o singură agregare pe facturi (grupată pe plătitor). Ținut 10 minute în memorie.
 */

const EPS = 0.005;
const TTL_MS = 10 * 60_000;
const g = globalThis as unknown as { __debtAging?: { at: number; p: Promise<AgingReport> } };

async function build(): Promise<AgingReport> {
  const [snap, oldest] = await Promise.all([
    getPayerSnap(),
    prisma.invoice.aggregateRaw({
      pipeline: [
        { $match: { kind: "APA_CANAL", status: { $in: ["SENT", "OVERDUE"] }, clientId: { $ne: null } } },
        { $group: { _id: "$clientId", oldest: { $min: "$issueDate" } } },
      ] as never,
      options: { allowDiskUse: true },
    }) as unknown as Promise<{ _id: { $oid?: string } | string; oldest: { $date?: string | { $numberLong?: string } } | string | null }[]>,
  ]);

  const sinceBy = new Map<string, string>();
  for (const r of oldest) {
    const id = typeof r._id === "string" ? r._id : r._id?.$oid;
    const d = r.oldest;
    const raw = typeof d === "string" ? d : d && typeof d === "object" ? (typeof d.$date === "string" ? d.$date : d.$date && typeof d.$date === "object" ? new Date(Number(d.$date.$numberLong)).toISOString() : "") : "";
    if (id && /^\d{4}-\d{2}/.test(raw)) sinceBy.set(id, raw.slice(0, 7));
  }

  const now = currentPeriod();
  const nowIdx = Number(now.slice(0, 4)) * 12 + Number(now.slice(5, 7));
  const rows: AgingRow[] = [];
  for (const r of snap.rows) {
    const inv = r.latestInvoice;
    const debt = inv?.debt ?? 0;
    if (!inv || !(debt > EPS)) continue;
    // Fără factură neachitată găsită (datoria vine din 1C, iar lanțul de facturi o arată achitată), plătitorul NU dispare din raport: vechimea se estimează după scadența ultimei facturi
    let since = sinceBy.get(r.id);
    let approx = false;
    if (!since) {
      approx = true;
      since = inv.dueDate && /^\d{4}-\d{2}/.test(inv.dueDate) ? inv.dueDate.slice(0, 7) : now;
    }
    const months = Math.max(1, nowIdx - (Number(since.slice(0, 4)) * 12 + Number(since.slice(5, 7))));
    rows.push({
      id: r.id,
      name: r.name,
      account: r.meterSeries ?? r.contract,
      address: r.consumAddress,
      phone: r.phone,
      debt,
      total: inv.grandTotal,
      since,
      months,
      bucket: bucketOf(months),
      ...(approx ? { approx: true } : {}),
    });
  }
  rows.sort((a, b) => b.months - a.months || b.debt - a.debt);
  const buckets = AGING_BUCKETS.map((b) => {
    const inB = rows.filter((r) => r.bucket === b.key);
    return { key: b.key, count: inB.length, sum: Math.round(inB.reduce((s, r) => s + r.debt, 0) * 100) / 100 };
  });
  console.log(`[debt-aging] ${rows.length} plătitori cu datorie`);
  return { builtAt: Date.now(), rows, buckets };
}

/** Id-urile plătitorilor dintr-un interval de vechime (pentru filtrul din Plătitori / Notificări). */
export async function agingIds(bucket: string): Promise<string[]> {
  if (!AGING_BUCKETS.some((b) => b.key === bucket)) return [];
  return (await debtAgingReport()).rows.filter((r) => r.bucket === bucket).map((r) => r.id);
}

export function debtAgingReport(): Promise<AgingReport> {
  const hit = g.__debtAging;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = build();
  p.catch(() => {
    if (g.__debtAging?.p === p) g.__debtAging = undefined;
  });
  g.__debtAging = { at: Date.now(), p };
  return p;
}
