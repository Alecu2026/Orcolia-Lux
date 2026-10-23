import "server-only";
import type { prisma as PrismaInstance } from "../prisma";
import { refreshClientInvoiceSnapshot } from "./invoices";
import { invalidatePayers } from "./payer-cache";
import { invalidateInvoices } from "./invoice-cache";

// Tipul EXACT al clientului extins din lib/prisma.ts (nu PrismaClient brut — vezi explicația
// din apa-canal-import.ts despre de ce Pick<PrismaClient, ...> nu se potrivește structural).
type TariffPrisma = typeof PrismaInstance;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const isApa = (desc: string) => /alimentare cu ap[aă]/i.test(desc);
const isCanal = (desc: string) => /canalizare/i.test(desc);

export type TariffUpdatePlan = {
  invoiceUpdates: {
    invoiceId: string;
    clientId: string | null;
    oldGrandTotal: number;
    newGrandTotal: number;
    newSubtotal: number;
    itemUpdates: { id: string; unitPrice: number; lineTotal: number }[];
  }[];
  stats: {
    invoicesEligible: number;
    invoicesChanged: number;
    invoicesSkippedNoMatchingItem: number;
    itemsWithZeroQtyLeftAlone: number;
    oldTotalDue: number;
    newTotalDue: number;
  };
};

/**
 * Construiește (fără să scrie nimic) planul de aplicare a unui tarif nou (apă/canal, lei/m³)
 * peste facturile Apă-Canal EXISTENTE — folosit de butonul separat "Aplică și la cele vechi"
 * din Setări. NU atinge facturile PLĂTITE sau ANULATE (o factură deja achitată nu se
 * recalculează retroactiv). NU atinge liniile cu volum 0 — acelea sunt sume reziduale/de
 * ajustare fără bază de calcul pe m³ (vezi ApaCanalInvoicePublic.tsx), nu au ce tarif nou primi.
 */
export async function buildTariffUpdatePlan(
  prisma: TariffPrisma,
  tarifApa: number,
  tarifCanal: number,
): Promise<TariffUpdatePlan> {
  // Două interogări fără relație imbricată, NU una cu `items: { select: ... }` — Prisma/MongoDB
  // generează pentru asta un filtru `invoiceId IN (<18k+ id-uri>)`, care s-a dovedit catastrofal
  // de lent (~70s, peste limita de timp a funcției serverless — de-aici erau eșecurile "Failed
  // to fetch" din UI). Preluăm TOATE InvoiceItem fără filtru (rapid, ~1.5s pentru tot tabelul)
  // și le grupăm în memorie — la fel ca în scripts/backfill-client-invoice-snapshot.mjs.
  const invoices = await prisma.invoice.findMany({
    where: { kind: "APA_CANAL", status: { notIn: ["PAID", "CANCELLED"] } },
    select: {
      id: true,
      clientId: true,
      subtotal: true,
      recalculari: true,
      penalitati: true,
      datoriiAvans: true,
      grandTotal: true,
    },
  });
  const allItems = await prisma.invoiceItem.findMany({
    select: { id: true, invoiceId: true, description: true, quantity: true, unitPrice: true, lineTotal: true },
  });
  const itemsByInvoice = new Map<string, typeof allItems>();
  for (const it of allItems) {
    const arr = itemsByInvoice.get(it.invoiceId) ?? [];
    arr.push(it);
    itemsByInvoice.set(it.invoiceId, arr);
  }

  const invoiceUpdates: TariffUpdatePlan["invoiceUpdates"] = [];
  let invoicesChanged = 0;
  let invoicesSkippedNoMatchingItem = 0;
  let itemsWithZeroQtyLeftAlone = 0;
  let oldTotalDue = 0;
  let newTotalDue = 0;

  for (const inv of invoices) {
    oldTotalDue += inv.grandTotal;

    let touchedAny = false;
    const itemUpdates: TariffUpdatePlan["invoiceUpdates"][number]["itemUpdates"] = [];
    let newSubtotal = 0;
    const invItems = itemsByInvoice.get(inv.id) ?? [];

    for (const it of invItems) {
      const isWater = isApa(it.description);
      const isSewage = !isWater && isCanal(it.description);
      if ((isWater || isSewage) && it.quantity > 0) {
        const newUnitPrice = isWater ? tarifApa : tarifCanal;
        const newLineTotal = round2(it.quantity * newUnitPrice);
        itemUpdates.push({ id: it.id, unitPrice: newUnitPrice, lineTotal: newLineTotal });
        newSubtotal += newLineTotal;
        touchedAny = true;
      } else {
        if ((isWater || isSewage) && it.quantity === 0) itemsWithZeroQtyLeftAlone++;
        newSubtotal += it.lineTotal; // linie neschimbată — tot intră în noul subtotal
      }
    }
    newSubtotal = round2(newSubtotal);

    if (!touchedAny) {
      invoicesSkippedNoMatchingItem++;
      newTotalDue += inv.grandTotal;
      continue;
    }

    const newGrandTotal = round2(newSubtotal + inv.recalculari + inv.penalitati + inv.datoriiAvans);
    newTotalDue += newGrandTotal;
    invoicesChanged++;
    invoiceUpdates.push({
      invoiceId: inv.id,
      clientId: inv.clientId,
      oldGrandTotal: inv.grandTotal,
      newGrandTotal,
      newSubtotal,
      itemUpdates,
    });
  }

  return {
    invoiceUpdates,
    stats: {
      invoicesEligible: invoices.length,
      invoicesChanged,
      invoicesSkippedNoMatchingItem,
      itemsWithZeroQtyLeftAlone,
      oldTotalDue: round2(oldTotalDue),
      newTotalDue: round2(newTotalDue),
    },
  };
}

export type TariffApplyResult = { invoicesUpdated: number; itemsUpdated: number };

/** Scrie efectiv planul — recalculează în batch-uri moderate (fiecare factură are propriile linii). */
export async function applyTariffUpdatePlan(
  prisma: TariffPrisma,
  plan: TariffUpdatePlan,
): Promise<TariffApplyResult> {
  const CHUNK = 40;
  let invoicesUpdated = 0;
  let itemsUpdated = 0;
  const touchedClientIds = new Set<string>();

  for (let i = 0; i < plan.invoiceUpdates.length; i += CHUNK) {
    const slice = plan.invoiceUpdates.slice(i, i + CHUNK);
    await Promise.all(
      slice.map(async (u) => {
        await Promise.all(
          u.itemUpdates.map((it) =>
            prisma.invoiceItem.update({
              where: { id: it.id },
              data: { unitPrice: it.unitPrice, lineTotal: it.lineTotal },
            }),
          ),
        );
        await prisma.invoice.update({
          where: { id: u.invoiceId },
          data: { subtotal: u.newSubtotal, grandTotal: u.newGrandTotal },
        });
        itemsUpdated += u.itemUpdates.length;
        invoicesUpdated++;
        if (u.clientId) touchedClientIds.add(u.clientId);
      }),
    );
  }

  // refreshClientInvoiceSnapshot folosește propriul import al lui `prisma` (lib/prisma.ts),
  // nu parametrul de mai sus — ia doar clientId.
  for (const clientId of touchedClientIds) await refreshClientInvoiceSnapshot(clientId);
  if (touchedClientIds.size) {
    await invalidatePayers();
    await invalidateInvoices();
  }

  return { invoicesUpdated, itemsUpdated };
}
