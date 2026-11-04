import type { Company } from "./queries/company";
import { fmtDate } from "../app/components/invoice-meta";

/** Datele unei facturi Apă-Canal + variabilele pentru „Text personalizat”: folosite și de pagina publică (browser), și de PDF-ul generat pe server (lib/pdf/invoice-pdf.ts). */

export type ConsumPoint = { label: string; value: number };

/** Un contor de pe factură: serie, indici precedent / actual (text, ca pe factură) și dacă volumul e estimat. */
export type InvoiceMeter = { serial: string; prev: string; curr: string; estimated: boolean; /** Consumatorul / locul de consum subordonat căruia îi aparține contorul (la abonații cu mai mulți consumatori, ex. o primărie). */ label?: string };

/** Lista de contoare din JSON-ul salvat (validată; orice rând stricat se ignoră). */
export function parseMeters(raw: unknown): InvoiceMeter[] {
  if (!Array.isArray(raw)) return [];
  const out: InvoiceMeter[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const serial = typeof o.serial === "string" ? o.serial.trim() : "";
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 120) : "";
    if (!serial && !label) continue;
    out.push({ serial: (serial || "—").slice(0, 40), prev: typeof o.prev === "string" ? o.prev.slice(0, 20) : "", curr: typeof o.curr === "string" ? o.curr.slice(0, 20) : "", estimated: o.estimated === true, ...(label ? { label } : {}) });
  }
  return out;
}

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
  /** Contoarele din 1C când sunt mai multe (vezi invoiceMeters); gol = contorul de mai sus. */
  meters?: unknown;
  client: { name: string } | null;
  items: { id: string; description: string; quantity: number; unitPrice: number; lineTotal: number }[];
};

/**
 * Contoarele afișate pe factură: lista din 1C când are cel puțin 2 contoare, altfel contorul unic (serie / indici din câmpurile facturii).
 * Mereu cel puțin un rând (cu „—” dacă nu există nicio dată), ca tabelul să nu rămână gol.
 */
export function invoiceMeters(invoice: Pick<ApaCanalInvoiceData, "meters" | "meterNumber" | "meterPrevReading" | "meterCurrReading" | "isEstimatedVolume">): InvoiceMeter[] {
  const list = parseMeters(invoice.meters);
  if (list.length >= 2) return list;
  return [{ serial: invoice.meterNumber || "", prev: invoice.meterPrevReading || "", curr: invoice.meterCurrReading || "", estimated: !!invoice.isEstimatedVolume }];
}

/** Câte linii încap pe prima pagină a facturii (restul trece pe pagini de continuare) — valori implicite; se pot schimba din editorul de șablon. */
export const DEFAULT_FIRST_PAGE_LIMITS = { meters: 6, services: 6 } as const;
/** Câte rânduri încap pe o pagină de continuare (A4 pe lat). */
export const CONT_PAGE_ROWS = 22;

export type PageLimits = { meters: number; services: number };
export const pageLimits = (l?: { meters?: number; services?: number } | null): PageLimits => ({
  meters: l?.meters && l.meters >= 1 ? Math.floor(l.meters) : DEFAULT_FIRST_PAGE_LIMITS.meters,
  services: l?.services && l.services >= 1 ? Math.floor(l.services) : DEFAULT_FIRST_PAGE_LIMITS.services,
});

type ServiceItem = ApaCanalInvoiceData["items"][number];
/** Liniile de servicii în ordinea afișării: întâi apă, apoi canalizare. */
export function orderedServiceItems(invoice: Pick<ApaCanalInvoiceData, "items">): ServiceItem[] {
  const apa = invoice.items.filter((it) => isApa(it.description));
  const canal = invoice.items.filter((it) => !isApa(it.description) && /canalizare/i.test(it.description));
  return [...apa, ...canal];
}

/** Ce rămâne pe prima pagină și ce trece pe paginile de continuare (la depășirea limitelor); pe prima pagină rămân `limite` rânduri, restul sunt „rest”. */
export function splitForPages(invoice: ApaCanalInvoiceData, limits: PageLimits) {
  const meters = invoiceMeters(invoice);
  const services = orderedServiceItems(invoice);
  return {
    meters: meters.length > limits.meters ? meters.slice(0, limits.meters) : meters,
    metersRest: meters.length > limits.meters ? meters.slice(limits.meters) : [],
    metersTotal: meters.length,
    services: services.length > limits.services ? services.slice(0, limits.services) : services,
    servicesRest: services.length > limits.services ? services.slice(limits.services) : [],
    servicesTotal: services.length,
  };
}

/** Paginile de continuare: întâi contoarele rămase, apoi serviciile rămase, câte `CONT_PAGE_ROWS` rânduri pe pagină. */
export type ContPage = { kind: "meters"; rows: InvoiceMeter[]; from: number } | { kind: "services"; rows: ServiceItem[]; from: number };
export function continuationPages(sp: ReturnType<typeof splitForPages>, limits: PageLimits): ContPage[] {
  const pages: ContPage[] = [];
  for (let i = 0; i < sp.metersRest.length; i += CONT_PAGE_ROWS) pages.push({ kind: "meters", rows: sp.metersRest.slice(i, i + CONT_PAGE_ROWS), from: limits.meters + i + 1 });
  for (let i = 0; i < sp.servicesRest.length; i += CONT_PAGE_ROWS) pages.push({ kind: "services", rows: sp.servicesRest.slice(i, i + CONT_PAGE_ROWS), from: limits.services + i + 1 });
  return pages;
}

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
    contor: invoiceMeters(invoice).map((m) => m.serial).filter(Boolean).join(", ") || "—",
    indPrec: invoiceMeters(invoice).map((m) => m.prev).filter(Boolean).join(", ") || "—",
    indAct: invoiceMeters(invoice).map((m) => m.curr).filter(Boolean).join(", ") || "—",
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
