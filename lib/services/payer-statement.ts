import "server-only";
import type { InvoiceStatus } from "@prisma/client";
import { prisma } from "../prisma";
import { derivePayerInvoices } from "../payment-chain";

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
  /** Scadența facturii. */
  dueDate: Date | null;
  /** Cât s-a plătit între factura anterioară și aceasta (dedus din lanțul de facturi, vezi lib/payment-chain.ts); null = prima factură. */
  prevPaid: number | null;
  /** Cât din ACEASTĂ factură s-a achitat; null = încă nu se știe (apare când se emite factura următoare). */
  paidAmount: number | null;
};

export type PayerStatement = {
  client: {
    id: string;
    name: string;
    meterSeries: string | null;
    consumAddress: string | null;
    /** Contul / contractul de afișat: contul personal, iar dacă lipsește — cel din ultima factură, din 1C sau nr. de contract (firme). */
    account: string | null;
    accountKind: "account" | "contract" | null;
    /** Adresa de afișat: cea a plătitorului, altfel cea de pe ultima factură sau din 1C. */
    address: string | null;
  };
  rows: PayerStatementRow[];
  totals: { apaQty: number; canalQty: number; subtotal: number; datoriiAvans: number; recalculari: number; penalitati: number; grandTotal: number; /** Suma plăților deduse (istoricul plăților). */ paid: number };
  /**
   * Situația pe tot istoricul (fără facturile ciornă / anulate): cât a avut de achitat în total (tot ce s-a calculat + datoria de la prima factură),
   * cât a achitat, cât mai are de achitat sau cât avans are acum (după ultima factură). due − paid = remaining − advance.
   */
  summary: { due: number; paid: number; remaining: number; advance: number; currency: string };
};

/** Totalurile de pe tot istoricul: soldul curent = „Total de plată” de pe ultima factură; ce s-a calculat = „Total de plată” − „Datorii / avans” de pe fiecare factură. */
export function statementSummary(rows: Pick<PayerStatementRow, "status" | "grandTotal" | "datoriiAvans" | "currency">[]): PayerStatement["summary"] {
  const live = rows.filter((r) => r.status !== "DRAFT" && r.status !== "CANCELLED");
  const currency = live[0]?.currency ?? rows[0]?.currency ?? "MDL";
  if (live.length === 0) return { due: 0, paid: 0, remaining: 0, advance: 0, currency };
  const billed = live.reduce((s, r) => s + (r.grandTotal - r.datoriiAvans), 0);
  const opening = Math.max(0, live[0].datoriiAvans); // datoria de dinainte de prima factură
  const balance = live[live.length - 1].grandTotal; // + = mai are de achitat, − = avans
  const due = billed + opening;
  return { due: round2(due), paid: round2(due - balance), remaining: round2(Math.max(0, balance)), advance: round2(Math.max(0, -balance)), currency };
}

type StatementInvoice = {
  id: string; publicToken: string; number: string; status: InvoiceStatus; issueDate: Date; billingPeriodLabel: string | null; sectorNr: string | null; contPersonal: string | null; consumAddress: string | null;
  meterPrevReading: string | null; meterCurrReading: string | null; subtotal: number; datoriiAvans: number; recalculari: number; penalitati: number; grandTotal: number; currency: string;
  dueDate: Date | null; prevPaid: number | null; paidAmount: number | null;
  items: { description: string; quantity: number; unitPrice: number }[];
};

// MongoDB (agregare brută) întoarce valorile în format EJSON ({ $oid }, { $date }) — le aducem la tipuri JS.
const ejId = (v: unknown): string => (typeof v === "string" ? v : v && typeof v === "object" && "$oid" in v ? String((v as { $oid: unknown }).$oid) : "");
const ejDate = (v: unknown): Date => {
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  const d = (v as { $date?: unknown } | null)?.$date;
  if (typeof d === "string" || typeof d === "number") return new Date(d);
  const n = (d as { $numberLong?: string } | undefined)?.$numberLong;
  return new Date(n ? Number(n) : NaN);
};
const ejNum = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const n = Number(o.$numberDouble ?? o.$numberInt ?? o.$numberLong ?? o.$numberDecimal ?? NaN);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Facturile Apă-Canal ale plătitorului, cu liniile lor, într-un SINGUR drum către baza de date (agregare cu $lookup) — cu Prisma ar fi două interogări la rând (facturile, apoi liniile lor).
 * Aceleași câmpuri și aceeași ordine (după data emiterii) ca interogarea veche.
 */
async function statementInvoices(clientId: string, forPortal: boolean): Promise<StatementInvoice[]> {
  const raw = (await prisma.invoice.aggregateRaw({
    pipeline: [
      { $match: { clientId: { $oid: clientId }, kind: "APA_CANAL", ...(forPortal ? { status: { $ne: "DRAFT" } } : {}) } },
      { $sort: { issueDate: 1 } },
      { $lookup: { from: "InvoiceItem", localField: "_id", foreignField: "invoiceId", as: "items" } },
      {
        $project: {
          publicToken: 1, number: 1, status: 1, issueDate: 1, billingPeriodLabel: 1, sectorNr: 1, contPersonal: 1, consumAddress: 1,
          meterPrevReading: 1, meterCurrReading: 1, subtotal: 1, datoriiAvans: 1, recalculari: 1, penalitati: 1, grandTotal: 1, currency: 1, dueDate: 1, prevPaid: 1, paidAmount: 1,
          items: { $map: { input: "$items", as: "i", in: { description: "$$i.description", quantity: "$$i.quantity", unitPrice: "$$i.unitPrice" } } },
        },
      },
    ],
  })) as unknown as Record<string, unknown>[];
  return raw.map((r) => ({
    id: ejId(r._id),
    publicToken: String(r.publicToken ?? ""),
    number: String(r.number ?? ""),
    status: String(r.status ?? "DRAFT") as InvoiceStatus,
    issueDate: ejDate(r.issueDate),
    billingPeriodLabel: str(r.billingPeriodLabel),
    sectorNr: str(r.sectorNr),
    contPersonal: str(r.contPersonal),
    consumAddress: str(r.consumAddress),
    meterPrevReading: str(r.meterPrevReading),
    meterCurrReading: str(r.meterCurrReading),
    subtotal: ejNum(r.subtotal),
    datoriiAvans: ejNum(r.datoriiAvans),
    recalculari: ejNum(r.recalculari),
    penalitati: ejNum(r.penalitati),
    grandTotal: ejNum(r.grandTotal),
    currency: String(r.currency ?? "MDL"),
    dueDate: r.dueDate == null ? null : ejDate(r.dueDate),
    prevPaid: r.prevPaid == null ? null : ejNum(r.prevPaid),
    paidAmount: r.paidAmount == null ? null : ejNum(r.paidAmount),
    items: ((r.items as Record<string, unknown>[] | undefined) ?? []).map((it) => ({ description: String(it.description ?? ""), quantity: ejNum(it.quantity), unitPrice: ejNum(it.unitPrice) })),
  }));
}

/** `forPortal`: ce vede clientul în cabinetul personal — fără facturile ciornă (încă nerevizuite de staff). */
export async function getPayerStatement(clientId: string, opts: { forPortal?: boolean } = {}): Promise<PayerStatement | null> {
  if (!/^[0-9a-f]{24}$/i.test(clientId)) return null;
  // Plătitorul, facturile cu liniile lor și ultimul document 1C (pentru cont / adresă lipsă) pornesc odată, în paralel: un singur drum către baza de date, nu trei-patru la rând.
  const [client, invoices, rec] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId }, select: { id: true, name: true, meterSeries: true, consumAddress: true, apaCanalContract: true } }),
    statementInvoices(clientId, !!opts.forPortal),
    prisma.oneCRecord
      .findFirst({ where: { clientId }, orderBy: { dataDoc: "desc" }, select: { contPersonal: true, nrContract: true, oras: true, strada: true, casa: true, apartament: true } })
      .catch(() => null),
  ]);
  if (!client) return null;

  const totals = { apaQty: 0, canalQty: 0, subtotal: 0, datoriiAvans: 0, recalculari: 0, penalitati: 0, grandTotal: 0, paid: 0 };
  // statusul și plățile din lanțul de facturi, calculate pe loc (corecte imediat, fără să așteptăm recalcularea în masă)
  const derived = derivePayerInvoices(invoices);
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
    const dv = derived.get(inv.id);
    const prevPaid = dv ? dv.prevPaid : inv.prevPaid;
    totals.paid += prevPaid ?? 0;
    return {
      invoiceId: inv.id,
      publicToken: inv.publicToken,
      number: inv.number,
      status: (dv?.status ?? inv.status) as InvoiceStatus,
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
      dueDate: inv.dueDate,
      prevPaid,
      paidAmount: dv ? dv.paidAmount : inv.paidAmount,
    };
  });

  // Contul și adresa pot lipsi de pe fișa plătitorului (nu toți vin cu ele din Axioma): le luăm de pe ultima factură, apoi din ultimul document 1C.
  const newest = [...invoices].reverse();
  let account: string | null = client.meterSeries || newest.find((i) => i.contPersonal)?.contPersonal || null;
  let address: string | null = client.consumAddress || newest.find((i) => i.consumAddress)?.consumAddress || null;
  let contract: string | null = account ? null : client.apaCanalContract || null;
  if (!account || !address || !contract) {
    if (rec) {
      account = account || rec.contPersonal || null;
      contract = account ? null : contract || rec.nrContract || null;
      if (!address) {
        address =
          [rec.oras?.trim(), rec.strada?.trim() ? `str. ${rec.strada.trim()}` : "", rec.casa?.trim() ? `nr. ${rec.casa.trim()}` : "", rec.apartament?.trim() ? `ap. ${rec.apartament.trim()}` : ""]
            .filter(Boolean)
            .join(", ") || null;
      }
    }
  }
  const shownAccount = account ?? contract;

  return {
    client: { ...client, account: shownAccount, accountKind: account ? "account" : contract ? "contract" : null, address },
    rows,
    totals: {
      apaQty: round3(totals.apaQty),
      canalQty: round3(totals.canalQty),
      subtotal: round2(totals.subtotal),
      datoriiAvans: round2(totals.datoriiAvans),
      recalculari: round2(totals.recalculari),
      penalitati: round2(totals.penalitati),
      grandTotal: round2(totals.grandTotal),
      paid: round2(totals.paid),
    },
    summary: statementSummary(rows),
  };
}
