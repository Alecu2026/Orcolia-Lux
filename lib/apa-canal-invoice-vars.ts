import type { Company } from "./queries/company";
import { fmtDate } from "../app/components/invoice-meta";

/** Datele unei facturi Apă-Canal + variabilele pentru „Text personalizat”: folosite și de pagina publică (browser), și de PDF-ul generat pe server (lib/pdf/invoice-pdf.ts). */

export type ConsumPoint = { label: string; value: number };

export type ApaCanalInvoiceData = {
  number: string;
  issueDate: Date;
  dueDate: Date | null;
  currency: string;
  contPersonal: string | null;
  sectorNr: string | null;
  consumAddress: string | null;
  consumerName: string | null;
  meterNumber: string | null;
  meterPrevReading: string | null;
  meterCurrReading: string | null;
  isEstimatedVolume: boolean;
  billingPeriodLabel: string | null;
  recalculari: number;
  penalitati: number;
  datoriiAvans: number;
  subtotal: number;
  grandTotal: number;
  monthlyConsumption: unknown;
  client: { name: string } | null;
  items: { id: string; description: string; quantity: number; unitPrice: number; lineTotal: number }[];
};

export const num2 = (n: number) => n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "ap[aă]" — acceptă "apa" (fără diacritic, cum scriu formularele din aplicație) și "apă"
// (corect gramatical, din exportul 1C importat) — vezi explicația la locul de folosire.
export const isApa = (description: string) => /alimentare cu ap[aă]/i.test(description);

/**
 * Volum/tarif pentru o linie de serviciu — "—" în loc de "0,00" exact acolo unde afișarea unui
 * zero ar face suma arăta ca o eroare de calcul (0 × orice = sumă nenulă, contradictoriu vizual).
 * Cazul e real în datele importate: unele linii au sumă calculată reală dar volum și/sau tarif
 * nu s-au înregistrat separat în sursă — nu inventăm o valoare, doar nu mai afișăm un zero fals.
 * Un consum cu adevărat nul (volum 0, sumă 0) tot arată "0,00" — acolo zero e corect și clar.
 */
export function factorOrDash(value: number, lineTotal: number): string {
  return value === 0 && lineTotal !== 0 ? "—" : num2(value);
}

/** Valorile live ale unei facturi, pentru variabilele din „Text personalizat” ({cont}, {total}…) — vezi APA_CANAL_VARIABLES. */
export function buildApaCanalVars(invoice: ApaCanalInvoiceData, company: Company): Record<string, string> {
  const apa = invoice.items.filter((it) => isApa(it.description));
  const canal = invoice.items.filter((it) => !isApa(it.description) && /canalizare/i.test(it.description));
  const total = (arr: typeof apa, pick: (it: (typeof apa)[number]) => number) => arr.reduce((s, it) => s + pick(it), 0);
  const first = (arr: typeof apa, pick: (it: (typeof apa)[number]) => string) => (arr[0] ? pick(arr[0]) : "—");
  return {
    numar: invoice.number,
    emitere: fmtDate(invoice.issueDate),
    scadenta: fmtDate(invoice.dueDate),
    perioada: invoice.billingPeriodLabel ? invoice.billingPeriodLabel.toUpperCase() : "—",
    valuta: invoice.currency,
    cont: invoice.contPersonal || "—",
    sector: invoice.sectorNr || "—",
    consumator: invoice.consumerName || invoice.client?.name || "—",
    adresa: invoice.consumAddress || "—",
    contor: invoice.meterNumber || "—",
    indPrec: invoice.meterPrevReading || "—",
    indAct: invoice.meterCurrReading || "—",
    volumEst: invoice.isEstimatedVolume ? "DA" : "",
    apaVolum: apa.length ? num2(total(apa, (it) => it.quantity)) : "—",
    apaTarif: first(apa, (it) => factorOrDash(it.unitPrice, it.lineTotal)),
    apaSuma: apa.length ? num2(total(apa, (it) => it.lineTotal)) : "—",
    canalVolum: canal.length ? num2(total(canal, (it) => it.quantity)) : "—",
    canalTarif: first(canal, (it) => factorOrDash(it.unitPrice, it.lineTotal)),
    canalSuma: canal.length ? num2(total(canal, (it) => it.lineTotal)) : "—",
    recalculari: num2(invoice.recalculari),
    penalitati: num2(invoice.penalitati),
    suma: num2(invoice.subtotal),
    datorii: num2(invoice.datoriiAvans),
    total: num2(invoice.grandTotal),
    firma: company.apaCanalCompanyLine,
    firmaAdresa: company.apaCanalAddress,
    firmaEmail: company.apaCanalEmail,
    firmaCodFiscal: company.apaCanalCodFiscal,
    contactNume: company.apaCanalContactName,
    contacte: company.apaCanalContactsText,
    atentie: company.apaCanalAtentieText,
    anunt: company.apaCanalAnuntText,
  };
}

/** Rotunjește la un "număr frumos" (1/2/5 × 10^n) — ține numărul de linii de grilă mereu rezonabil. */
export function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / pow;
  const nice = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return nice * pow;
}
