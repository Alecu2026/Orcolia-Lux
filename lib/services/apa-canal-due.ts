import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { apaCanalDueDate, APA_CANAL_DUE_DAY } from "../apa-canal-due";

/**
 * Aduce la zi scadența TUTUROR facturilor Apă-Canal: ziua de 25 a lunii facturii. Găsește dintr-o singură agregare lunile care au facturi cu altă
 * scadență (sau fără), apoi corectează doar acele luni. Rulează zilnic (cron) și după fiecare import / sincronizare 1C; fără nimic de corectat
 * costă o singură interogare. Întoarce câte facturi s-au modificat (și atunci listele din cache se reconstruiesc).
 */
export async function normalizeApaCanalDueDates(): Promise<number> {
  if (DEMO) return 0;
  const months = (await prisma.invoice.aggregateRaw({
    pipeline: [
      { $match: { kind: "APA_CANAL" } },
      {
        $project: {
          ym: { $dateToString: { format: "%Y-%m", date: "$issueDate" } },
          // OK = scadența există, e pe 25 și în aceeași lună cu emiterea
          ok: {
            $and: [
              { $ne: [{ $type: "$dueDate" }, "missing"] },
              { $ne: ["$dueDate", null] },
              { $eq: [{ $dayOfMonth: "$dueDate" }, APA_CANAL_DUE_DAY] },
              { $eq: [{ $dateToString: { format: "%Y-%m", date: "$dueDate" } }, { $dateToString: { format: "%Y-%m", date: "$issueDate" } }] },
            ],
          },
        },
      },
      { $match: { ok: false } },
      { $group: { _id: "$ym", n: { $sum: 1 } } },
    ] as never,
    options: { allowDiskUse: true },
  })) as unknown as { _id: string | null; n: number }[];

  let changed = 0;
  for (const m of months) {
    if (!m._id || !/^\d{4}-\d{2}$/.test(m._id)) continue;
    const [y, mo] = m._id.split("-").map(Number);
    const start = new Date(Date.UTC(y, mo - 1, 1));
    const next = new Date(Date.UTC(y, mo, 1));
    const due = apaCanalDueDate(start);
    const res = await prisma.invoice.updateMany({
      where: { kind: "APA_CANAL", issueDate: { gte: start, lt: next } },
      data: { dueDate: due },
    });
    changed += res.count;
  }
  if (changed > 0) {
    console.log(`[apa-canal] scadența adusă la ziua de ${APA_CANAL_DUE_DAY} pentru ${changed} facturi`);
    // listele de plătitori și de facturi arată scadența: se reconstruiesc
    const [{ invalidatePayers }, { invalidateInvoices }] = await Promise.all([import("./payer-cache"), import("./invoice-cache")]);
    await Promise.allSettled([invalidatePayers(), invalidateInvoices()]);
    (await import("../portal-cache")).bumpPortalEpoch(); // scadențele se văd și în portal
  }
  return changed;
}
