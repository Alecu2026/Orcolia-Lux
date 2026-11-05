import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { apaCanalDueDate, apaCanalDueKeyForMonth, APA_CANAL_DUE_DAY } from "../apa-canal-due";

/**
 * Aduce la zi scadența TUTUROR facturilor Apă-Canal: ziua de 25 a lunii URMĂTOARE celei de emitere (emisă 31.10 → 25.11). Găsește dintr-o singură agregare lunile care au facturi cu altă
 * scadență (sau fără), apoi corectează doar acele luni. Rulează zilnic (cron) și după fiecare import / sincronizare 1C; fără nimic de corectat
 * costă o singură interogare. Întoarce câte facturi s-au modificat (și atunci listele din cache se reconstruiesc).
 */
export async function normalizeApaCanalDueDates(): Promise<number> {
  if (DEMO) return 0;
  // grupuri (luna emiterii, scadența de pe factură): puține (luni × câteva valori), oricâte facturi ar fi
  const groups = (await prisma.invoice.aggregateRaw({
    pipeline: [
      { $match: { kind: "APA_CANAL" } },
      {
        $group: {
          _id: {
            ym: { $dateToString: { format: "%Y-%m", date: "$issueDate" } },
            due: { $dateToString: { format: "%Y-%m-%d", date: "$dueDate", onNull: null } },
          },
          n: { $sum: 1 },
        },
      },
    ] as never,
    options: { allowDiskUse: true },
  })) as unknown as { _id: { ym: string | null; due: string | null }; n: number }[];

  const bad = new Set<string>();
  for (const g of groups) {
    const ym = g._id?.ym;
    if (!ym || !/^\d{4}-\d{2}$/.test(ym)) continue;
    if (g._id.due !== apaCanalDueKeyForMonth(ym)) bad.add(ym);
  }

  let changed = 0;
  for (const ym of bad) {
    const [y, mo] = ym.split("-").map(Number);
    const start = new Date(Date.UTC(y, mo - 1, 1));
    const next = new Date(Date.UTC(y, mo, 1));
    const due = apaCanalDueDate(start);
    // scriere brută: Prisma ar actualiza și `updatedAt` pe toate facturile, iar plățile din lanțul de facturi le-ar relua inutil pe toate (scadența nu intră în ele)
    const res = (await prisma.$runCommandRaw({
      update: "Invoice",
      updates: [
        {
          q: {
            kind: "APA_CANAL",
            issueDate: { $gte: { $date: start.toISOString() }, $lt: { $date: next.toISOString() } },
            $or: [{ dueDate: null }, { dueDate: { $ne: { $date: due.toISOString() } } }],
          },
          u: { $set: { dueDate: { $date: due.toISOString() } } },
          multi: true,
        },
      ] as never,
    })) as { nModified?: number };
    changed += res.nModified ?? 0;
  }
  if (changed > 0) {
    console.log(`[apa-canal] scadența adusă la ziua de ${APA_CANAL_DUE_DAY} a lunii următoare pentru ${changed} facturi`);
    // listele de plătitori și de facturi arată scadența: se reconstruiesc
    const [{ invalidatePayers }, { invalidateInvoices }] = await Promise.all([import("./payer-cache"), import("./invoice-cache")]);
    await Promise.allSettled([invalidatePayers(), invalidateInvoices()]);
    (await import("../portal-cache")).bumpPortalEpoch(); // scadențele se văd și în portal
  }
  return changed;
}
