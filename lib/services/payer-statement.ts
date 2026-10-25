import "server-only";
import type { InvoiceStatus } from "@prisma/client";
import { prisma } from "../prisma";

/**
 * "Decontare" per plătitor: un rând per lună facturată + totaluri, în același spirit cu raportul
 * "Взаиморасчеты с абонентами" pe care îl folosește Apă-Canal pentru reconcilierea de totaluri
 * (fără jurnalul de plăți individuale — nu-l avem, vezi app/api/export/route.ts). Folosit atât de
 * pagina /platitori/[id]/decontare (vizualizare), cât și de export (Excel/CSV/JSON) — o singură
 * sursă de adevăr pentru rânduri, ca cele două să arate mereu aceleași cifre.
 */

const isApa = (d: string) => /alimentare cu ap[aă]/i.test(d);
const isCanal = (d: string) => /canalizare/i.test(d);
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

export type PayerStatementRow = {
  invoiceId: string;
  /** Linkul public al facturii (portalul deschide factura prin el). */
  publicToken: string;
  number: string;
  status: InvoiceStatus;
  issueDate: Date;
  billingPeriodLabel: string | null;
  sectorNr: string | null;
  contPersonal: string | null;
  meterPrevReading: string | null;
  meterCurrReading: string | null;
  apaQty: number | null;
  apaTarif: number | null;
  canalQty: number | null;
  canalTarif: number | null;
  subtotal: number;
  datoriiAvans: number;
  recalculari: number;
  penalitati: number;
  grandTotal: number;
  currency: string;
};

export type PayerStatement = {
  client: { id: string; name: string; meterSeries: string | null; consumAddress: string | null };
  rows: PayerStatementRow[];
  totals: { apaQty: number; canalQty: number; subtotal: number; datoriiAvans: number; recalculari: number; penalitati: number; grandTotal: number };
};

/** `forPortal`: ce vede clientul în cabinetul personal — fără facturile ciornă (încă nerevizuite de staff). */
export async function getPayerStatement(clientId: string, opts: { forPortal?: boolean } = {}): Promise<PayerStatement | null> {
  const client = await prisma.client.findFirst({
    where: { id: clientId },
    select: { id: true, name: true, meterSeries: true, consumAddress: true },
  });
  if (!client) return null;

  const invoices = await prisma.invoice.findMany({
    where: { clientId: client.id, kind: "APA_CANAL", ...(opts.forPortal ? { status: { not: "DRAFT" as const } } : {}) },
    orderBy: { issueDate: "asc" },
    select: {
      id: true, publicToken: true, number: true, status: true, issueDate: true, billingPeriodLabel: true, sectorNr: true, contPersonal: true,
      meterPrevReading: true, meterCurrReading: true, subtotal: true, datoriiAvans: true, recalculari: true,
      penalitati: true, grandTotal: true, currency: true,
      items: { select: { description: true, quantity: true, unitPrice: true } },
    },
  });

  const totals = { apaQty: 0, canalQty: 0, subtotal: 0, datoriiAvans: 0, recalculari: 0, penalitati: 0, grandTotal: 0 };
  const rows: PayerStatementRow[] = invoices.map((inv) => {
    const apaItem = inv.items.find((it) => isApa(it.description));
    const canalItem = inv.items.find((it) => isCanal(it.description));
    totals.apaQty += apaItem?.quantity ?? 0;
    totals.canalQty += canalItem?.quantity ?? 0;
    totals.subtotal += inv.subtotal;
    totals.datoriiAvans += inv.datoriiAvans;
    totals.recalculari += inv.recalculari;
    totals.penalitati += inv.penalitati;
    totals.grandTotal += inv.grandTotal;
    return {
      invoiceId: inv.id,
      publicToken: inv.publicToken,
      number: inv.number,
      status: inv.status,
      issueDate: inv.issueDate,
      billingPeriodLabel: inv.billingPeriodLabel,
      sectorNr: inv.sectorNr,
      contPersonal: inv.contPersonal,
      meterPrevReading: inv.meterPrevReading,
      meterCurrReading: inv.meterCurrReading,
      apaQty: apaItem?.quantity ?? null,
      apaTarif: apaItem?.unitPrice ?? null,
      canalQty: canalItem?.quantity ?? null,
      canalTarif: canalItem?.unitPrice ?? null,
      subtotal: inv.subtotal,
      datoriiAvans: inv.datoriiAvans,
      recalculari: inv.recalculari,
      penalitati: inv.penalitati,
      grandTotal: inv.grandTotal,
      currency: inv.currency,
    };
  });

  return {
    client,
    rows,
    totals: {
      apaQty: round3(totals.apaQty),
      canalQty: round3(totals.canalQty),
      subtotal: round2(totals.subtotal),
      datoriiAvans: round2(totals.datoriiAvans),
      recalculari: round2(totals.recalculari),
      penalitati: round2(totals.penalitati),
      grandTotal: round2(totals.grandTotal),
    },
  };
}
