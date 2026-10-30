import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { InvoiceStatus, Prisma } from "@prisma/client";
import { PER_PAGE_ALL, type MonthTuple, type SnapTuple } from "../payer-notify";
import { cachedAsync } from "../ttl-cache";
import { contractDate, contractFilterBounds, contractKey, type ContractExpFilter } from "../contract-expiry";

const PAGE_SIZE = 50;
/** Câți plătitori pe pagină alege utilizatorul (?perPage=) — plafonat ca să nu încărcăm mii de rânduri odată. */
export const PER_PAGE_OPTIONS = [20, 50, 100, 200, 500, 1000, PER_PAGE_ALL] as const;
export function normalizePerPage(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return PAGE_SIZE;
  return Math.min(n, PER_PAGE_ALL);
}

export type PayerRow = {
  id: string;
  name: string;
  meterSeries: string | null;
  /** Nr. contract 1C — la firmele fără cont personal (identitatea lor). */
  contract: string | null;
  email: string | null;
  phone: string | null;
  activated: boolean;
  invoiceCount: number;
  latestInvoice: { number: string; status: InvoiceStatus; grandTotal: number; currency: string; dueDate: string | null } | null;
  consumAddress: string | null;
  /** ISO — ultima notificare trimisă din /notificari-platitori (null = niciodată). */
  lastNotifiedAt: string | null;
  /** "YYYY-MM-DD" instalării contorului activ (din 1C) — completat doar când sortarea/filtrarea
   * cerută îl folosește (vezi installDateMap); altfel rămâne null, fără cost suplimentar. */
  installedAt: string | null;
  /** „YYYY-MM-DD” — data expirării contractului, introdusă manual (null = necompletată). */
  contractExpiresAt: string | null;
};

export type PayerSector = "privat" | "comunal";
export type PayerDebtFilter = "has" | "none";
export type PayerSort = "name" | "debtDesc" | "debtAsc" | "installDesc" | "installAsc";

const SECTOR_VALUE: Record<PayerSector, string> = {
  privat: "Sector privat",
  comunal: "Sector comunal",
};

export type ListPayersOpts = {
  search?: string;
  status?: "activated" | "pending";
  sector?: PayerSector;
  invoiceStatus?: InvoiceStatus;
  debt?: PayerDebtFilter;
  street?: string;
  sort?: PayerSort;
  /** Nume cu "?" literal — caracter pe care Windows-1251 (codificarea exportului 1C importat)
   * nu îl poate reprezenta deloc (cazul real: Ș/Ț românesc, absente din acea pagină de coduri —
   * pierdere ireversibilă, produsă în sistemul sursă înainte să ajungă fișierul la noi). */
  needsNameFix?: boolean;
  /**
   * "YYYY-MM": doar plătitorii cu factură în luna aceea, afișați cu factura acelei luni; filtrele de sold și
   * status se aplică tot pe factura lunii (nu pe ultima). Fără lună = ultima factură, ca până acum.
   */
  month?: string;
  /** "YYYY-MM-DD": doar plătitorii cu contorul activ instalat la sau după data asta (din 1C). */
  installedFrom?: string;
  /** Interval de sold ("de achitat") — pe ultima factură sau, cu `month`, pe factura lunii alese. */
  minDebt?: number;
  maxDebt?: number;
  /** Ce date de contact are plătitorul (vezi /notificari-platitori). */
  contact?: "email" | "phone" | "both" | "any" | "none" | "noemail" | "nophone";
  /** "person" = cu cont personal (meterSeries); "company" = firmă/instituție (doar nr. de contract). */
  kind?: "person" | "company";
  /** Filtru după Client.lastNotifiedAt: niciodată / în / nu în ultimele 7 sau 30 de zile. */
  notified?: "never" | "7d" | "30d" | "not7d" | "not30d";
  /** Doar plătitorii fără nicio factură (snapshot-ul ultimei facturi e gol). */
  noInvoices?: boolean;
  /** "yes" = ultima citire a contorului e calculată (estimată); "no" = citită. */
  estimated?: "yes" | "no";
  /** Contractul: fără dată / expirat / expiră în 10 sau 30 de zile. */
  contractExp?: ContractExpFilter;
  /** Restricții pe id-uri (ex. „notificați prin SMS în perioada…", calculate din jurnalul de trimiteri). */
  idsIn?: string[];
  idsNotIn?: string[];
  page?: number;
  perPage?: number;
};

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parsePayerMonth(v: unknown): string | undefined {
  return typeof v === "string" && MONTH_RE.test(v) ? v : undefined;
}

export function parseInstalledFrom(v: unknown): string | undefined {
  return typeof v === "string" && DATE_RE.test(v) ? v : undefined;
}

export function monthRange(month: string): { gte: Date; lt: Date } {
  const [y, m] = month.split("-").map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

/** Lunile în care există facturi Apă-Canal, cu numărul de facturi — pentru lista "Luna facturii". */
// Scanează toate facturile Apă-Canal doar ca să afle ce luni există, iar lista se schimbă rar (la importul din 1C): o ținem 10 minute.
export async function loadPayerMonths(): Promise<{ month: string; count: number }[]> {
  if (DEMO) return [];
  const res = (await prisma.invoice.aggregateRaw({
    pipeline: [
      { $match: { kind: "APA_CANAL" } },
      { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$issueDate" } }, n: { $sum: 1 } } },
      { $sort: { _id: -1 } },
    ],
    options: { allowDiskUse: true },
  })) as unknown as { _id: string; n: number }[];
  return res.filter((r) => r._id).map((r) => ({ month: r._id, count: r.n }));
}
const monthsCached = cachedAsync(10 * 60_000, loadPayerMonths);
export async function listPayerMonths(): Promise<{ month: string; count: number }[]> {
  if (DEMO) return [];
  return monthsCached();
}

/** Filtrele de sold/status aplicate pe factura unei luni (în memorie). */
export function matchesMonthInvoice(
  inv: { status: InvoiceStatus; grandTotal: number },
  opts: Pick<ListPayersOpts, "debt" | "invoiceStatus" | "minDebt" | "maxDebt">,
): boolean {
  if (opts.invoiceStatus && inv.status !== opts.invoiceStatus) return false;
  if (opts.debt === "has" && !(inv.grandTotal > 0)) return false;
  if (opts.debt === "none" && inv.grandTotal > 0) return false;
  if (opts.minDebt != null && inv.grandTotal < opts.minDebt) return false;
  if (opts.maxDebt != null && inv.grandTotal > opts.maxDebt) return false;
  return true;
}

/**
 * Id-urile clienților al căror nume conține "?" literal — nu putem folosi `contains: "?"` direct
 * (Prisma/MongoDB tratează "?" ca metacaracter de regex acolo, ceea ce ajunge să se potrivească
 * practic cu ORICE nume) — scanăm în memorie (proiecție ușoară, id+nume, ~19k rânduri, rapid).
 */
// Scanează toți plătitorii (id + nume) la fiecare încărcare a paginii: o ținem 60 s.
const nameFixCountCached = cachedAsync(60_000, async () => (await findClientIdsNeedingNameFix()).length);
export async function countPayersNeedingNameFix(): Promise<number> {
  if (DEMO) return 0;
  return nameFixCountCached();
}

async function findClientIdsNeedingNameFix(): Promise<string[]> {
  const all = await prisma.client.findMany({
    where: { meterSeries: { not: null } },
    select: { id: true, name: true },
  });
  return all.filter((c) => c.name.includes("?")).map((c) => c.id);
}

/**
 * Plătitori — clienți portal Apă-Canal (au `meterSeries`), separați de clienții obișnuiți
 * (programări) din /clients. Listă paginată + căutare, cu numărul de facturi și starea celei
 * mai recente.
 *
 * Filtrele de sold/status/sector/sortare citesc direct câmpurile Client.lastInvoice* (instantaneu
 * al ultimei facturi, reîmprospătat la fiecare creare/editare — vezi refreshClientInvoiceSnapshot
 * în lib/services/invoices.ts) — MongoDB/Prisma nu poate filtra sau sorta clienți după un câmp
 * dintr-o relație (Invoice) direct, iar la 19k+ plătitori un query per client ar fi mult prea lent.
 */
/**
 * Aceleași filtre ca listPayers — extras separat ca export/route.ts să poată exporta exact
 * ce vede staff-ul pe ecran (aceleași filtre active), nu întreaga listă de plătitori.
 */
/** Filtrul „Contract” ca interogare (datele sunt stocate la 00:00 UTC); „fără dată” prinde și documentele la care câmpul lipsește. */
function contractWhere(f: ContractExpFilter | undefined): Prisma.ClientWhereInput[] {
  if (!f) return [];
  if (f === "none") return [{ OR: [{ contractExpiresAt: null }, { contractExpiresAt: { isSet: false } }] }];
  const b = contractFilterBounds(f);
  if (!b) return [];
  // `not: null`: pe MongoDB filtrul `lt` / `lte` al lui Prisma potrivește și documentele cu câmpul null (data ștearsă din fișă)
  return [{ contractExpiresAt: { not: null, ...(b.gte ? { gte: contractDate(b.gte) } : {}), ...(b.lte ? { lte: contractDate(b.lte) } : {}), ...(b.lt ? { lt: contractDate(b.lt) } : {}) } }];
}

export async function buildPayerWhere(opts: ListPayersOpts = {}): Promise<Prisma.ClientWhereInput> {
  const search = opts.search?.trim();
  const street = opts.street?.trim();
  const nameFixIds = opts.needsNameFix ? await findClientIdsNeedingNameFix() : null;

  // Câmpurile opționale (email/phone) sunt "goale" fie null, fie "" (importurile vechi au salvat șiruri goale).
  const hasEmail: Prisma.ClientWhereInput[] = [{ email: { not: null } }, { email: { not: "" } }];
  const hasPhone: Prisma.ClientWhereInput[] = [{ phone: { not: null } }, { phone: { not: "" } }];
  const noEmail: Prisma.ClientWhereInput = { OR: [{ email: null }, { email: "" }] };
  const noPhone: Prisma.ClientWhereInput = { OR: [{ phone: null }, { phone: "" }] };
  const contact: Prisma.ClientWhereInput[] =
    opts.contact === "email" ? hasEmail
    : opts.contact === "phone" ? hasPhone
    : opts.contact === "both" ? [...hasEmail, ...hasPhone]
    : opts.contact === "any" ? [{ OR: [{ AND: hasEmail }, { AND: hasPhone }] }]
    : opts.contact === "noemail" ? [noEmail]
    : opts.contact === "nophone" ? [noPhone]
    : opts.contact === "none" ? [noEmail, noPhone]
    : [];

  let notified: Prisma.ClientWhereInput[] = [];
  if (opts.notified) {
    const days = opts.notified.endsWith("30d") ? 30 : 7;
    const since = new Date(Date.now() - days * 86_400_000);
    notified =
      opts.notified === "never" ? [{ lastNotifiedAt: null }]
      : opts.notified === "7d" || opts.notified === "30d" ? [{ lastNotifiedAt: { gte: since } }]
      : [{ OR: [{ lastNotifiedAt: null }, { lastNotifiedAt: { lt: since } }] }];
  }

  // Sold: "cu/fără datorie" și intervalul min–max se aplică pe același câmp, deci le combinăm într-un singur filtru.
  const total: Prisma.FloatNullableFilter = {};
  if (opts.debt === "has") total.gt = 0;
  if (opts.debt === "none") total.lte = 0;
  if (opts.minDebt != null) total.gte = opts.minDebt;
  if (opts.maxDebt != null) total.lte = opts.debt === "none" ? Math.min(0, opts.maxDebt) : opts.maxDebt;

  return {
    // Plătitori = abonații Apă-Canal: persoanele (cont personal) și firmele/instituțiile (nr. contract 1C).
    AND: [
      { OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] },
      ...(search
        ? [
            {
              OR: [
                { name: { contains: search, mode: "insensitive" as const } },
                { meterSeries: { contains: search, mode: "insensitive" as const } },
                { apaCanalContract: { contains: search, mode: "insensitive" as const } },
                { email: { contains: search, mode: "insensitive" as const } },
                { phone: { contains: search, mode: "insensitive" as const } },
              ],
            },
          ]
        : []),
      ...(opts.kind === "person" ? [{ meterSeries: { not: null } }] : []),
      ...(opts.kind === "company" ? [{ meterSeries: null }] : []),
      ...contact,
      ...notified,
      ...(opts.noInvoices ? [{ lastInvoiceStatus: null }, { lastInvoiceGrandTotal: null }] : []),
      // „not: true” prinde și plătitorii la care câmpul lipsește (creați înainte de el)
      ...contractWhere(opts.contractExp),
      ...(opts.estimated === "yes" ? [{ meterReadingEstimated: true }] : opts.estimated === "no" ? [{ meterReadingEstimated: { not: true } }] : []),
      ...(opts.idsIn ? [{ id: { in: opts.idsIn } }] : []),
      ...(opts.idsNotIn?.length ? [{ id: { notIn: opts.idsNotIn } }] : []),
    ],
    ...(nameFixIds ? { id: { in: nameFixIds } } : {}),
    ...(opts.status === "activated" ? { portalPasswordHash: { not: null } } : {}),
    // „null” nu prinde plătitorii la care câmpul lipsește complet din document (creați înainte de câmp)
    ...(opts.status === "pending" ? { OR: [{ portalPasswordHash: null }, { portalPasswordHash: { isSet: false } }] } : {}),
    ...(opts.sector ? { lastInvoiceSectorNr: SECTOR_VALUE[opts.sector] } : {}),
    ...(opts.invoiceStatus ? { lastInvoiceStatus: opts.invoiceStatus } : {}),
    // Orice filtru de sold cere o factură: plătitorul fără factură nu e nici „fără datorie”, nici într-un interval (ca pe ecran)
    ...(Object.keys(total).length ? { lastInvoiceGrandTotal: { ...total, not: null } } : {}),
    ...(street ? { consumAddress: { contains: street, mode: "insensitive" as const } } : {}),
  };
}

/** Data instalării contorului activ, per client — din OneCRecord (1C); Client n-o are (ar cere
 * resincronizare la fiecare import). Citită doar când sortarea/filtrarea cerută o folosește —
 * proiecție mică (id+dată) chiar și pe toți cei ~19k plătitori, deci ieftină la cerere. */
async function installDateMap(): Promise<Map<string, string | null>> {
  const rows = await prisma.oneCRecord.findMany({
    where: { clientId: { not: null } },
    select: { clientId: true, dataInstalare: true },
  });
  const m = new Map<string, string | null>();
  for (const r of rows) if (r.clientId) m.set(r.clientId, r.dataInstalare);
  return m;
}

let sectorMemo: { at: number; map: Map<string, string> } | null = null;
/**
 * Sectorul din 1C („Участок”) al fiecărui plătitor, din ultima lui înregistrare 1C (OneCRecord). Doar plătitorii cu sector completat.
 * Citit ca instalarea (proiecție mică); ținut 5 minute în memorie pentru căile care filtrează direct în baza de date (trimitere, export).
 */
export async function payerSectorMap(fresh = false): Promise<Map<string, string>> {
  if (DEMO) return new Map();
  if (!fresh && sectorMemo && Date.now() - sectorMemo.at < 5 * 60_000) return sectorMemo.map;
  const rows = await prisma.oneCRecord.findMany({ where: { clientId: { not: null } }, select: { clientId: true, sectorUchastok: true, dataDoc: true } });
  const best = new Map<string, { d: string; s: string }>();
  for (const r of rows) {
    const s = r.sectorUchastok?.trim();
    if (!r.clientId || !s) continue;
    const d = r.dataDoc ?? "";
    const cur = best.get(r.clientId);
    if (!cur || d >= cur.d) best.set(r.clientId, { d, s });
  }
  const map = new Map<string, string>();
  for (const [id, v] of best) map.set(id, v.s);
  sectorMemo = { at: Date.now(), map };
  return map;
}

/** Sortare după data instalării (string "YYYY-MM-DD", comparabil lexicografic) — fără dată cunoscută
 * trece mereu la final, indiferent de direcție (altfel "cele mai vechi" ar scoate în față exact
 * clienții fără informație, care nu sunt "vechi", sunt necunoscuți). */
function sortByInstall<T extends { id: string; name: string }>(
  items: T[],
  installBy: Map<string, string | null>,
  dir: 1 | -1,
): T[] {
  return [...items].sort((a, b) => {
    const da = installBy.get(a.id) ?? "";
    const db = installBy.get(b.id) ?? "";
    if (!da && !db) return collator.compare(a.name, b.name);
    if (!da) return 1;
    if (!db) return -1;
    return (da < db ? -1 : da > db ? 1 : 0) * dir || collator.compare(a.name, b.name);
  });
}

const PAYER_SELECT = {
  id: true, name: true, meterSeries: true, apaCanalContract: true, email: true, phone: true,
  portalPasswordHash: true, consumAddress: true, lastNotifiedAt: true, contractExpiresAt: true,
} as const;
const INVOICE_SELECT = { clientId: true, number: true, status: true, grandTotal: true, currency: true, dueDate: true, issueDate: true } as const;

// MongoDB sortează în memorie cel mult 32 MB (eroarea 292 QueryExceededMemoryLimitNoDiskUseAllowed) — cu zeci de mii de
// facturi `orderBy: issueDate` pe tot setul cade. La citirile în bloc NU sortăm în bază, ci aici, în JS.
const byIssueDesc = <T extends { issueDate: Date }>(rows: T[]): T[] => rows.sort((a, b) => b.issueDate.getTime() - a.issueDate.getTime());
type PayerClient = Prisma.ClientGetPayload<{ select: typeof PAYER_SELECT }>;
type PayerInvoice = { number: string; status: InvoiceStatus; grandTotal: number; currency: string; dueDate: Date | null };

function toPayerRow(c: PayerClient, latest: PayerInvoice | undefined, invoiceCount: number, installedAt: string | null): PayerRow {
  return {
    id: c.id,
    name: c.name,
    meterSeries: c.meterSeries,
    contract: c.apaCanalContract,
    email: c.email,
    phone: c.phone,
    activated: !!c.portalPasswordHash,
    invoiceCount,
    latestInvoice: latest
      ? {
          number: latest.number,
          status: latest.status,
          grandTotal: latest.grandTotal,
          currency: latest.currency,
          dueDate: latest.dueDate ? latest.dueDate.toISOString() : null,
        }
      : null,
    consumAddress: c.consumAddress,
    lastNotifiedAt: c.lastNotifiedAt ? c.lastNotifiedAt.toISOString() : null,
    installedAt,
    contractExpiresAt: contractKey(c.contractExpiresAt),
  };
}

// Un filtru `id: { in: [mii de id-uri] }` e extrem de lent în MongoDB (~80 s la 19.000) — peste prag citim totul
// (proiecții mici) și potrivim în memorie, ca la „Toate" / pagini foarte mari.
const BIG = 1000;
const PAYER_BASE: Prisma.ClientWhereInput = { OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] };

async function clientsByIds(ids: string[]) {
  if (ids.length <= BIG) return prisma.client.findMany({ where: { id: { in: ids } }, select: PAYER_SELECT });
  const set = new Set(ids);
  return (await prisma.client.findMany({ where: PAYER_BASE, select: PAYER_SELECT })).filter((c) => set.has(c.id));
}

async function invoicesByClientIds(ids: string[]) {
  if (ids.length <= BIG) {
    return prisma.invoice.findMany({ where: { clientId: { in: ids } }, orderBy: { issueDate: "desc" }, select: INVOICE_SELECT });
  }
  const set = new Set(ids);
  const all = await prisma.invoice.findMany({ where: { clientId: { not: null } }, select: INVOICE_SELECT });
  return byIssueDesc(all.filter((i) => i.clientId && set.has(i.clientId)));
}

async function invoiceCountsByClientIds(ids: string[]) {
  const rows = await prisma.invoice.groupBy({
    by: ["clientId"],
    where: ids.length <= BIG ? { clientId: { in: ids } } : { clientId: { not: null } },
    _count: { _all: true },
  });
  if (ids.length <= BIG) return rows;
  const set = new Set(ids);
  return rows.filter((r) => r.clientId && set.has(r.clientId));
}

export async function listPayers(opts: ListPayersOpts = {}) {
  if (DEMO) return { items: [] as PayerRow[], total: 0, page: 1, hasMore: false };

  const page = Math.max(1, opts.page ?? 1);
  const perPage = normalizePerPage(opts.perPage);
  const month = parsePayerMonth(opts.month);
  const installedFrom = parseInstalledFrom(opts.installedFrom);
  const installSort = opts.sort === "installDesc" || opts.sort === "installAsc";
  if (month) return listPayersForMonth(month, { ...opts, installedFrom }, page, perPage);
  if (installSort || installedFrom) return listPayersByInstall(opts, installedFrom, page, perPage);
  const where = await buildPayerWhere(opts);

  const orderBy: Prisma.ClientOrderByWithRelationInput =
    opts.sort === "debtDesc"
      ? { lastInvoiceGrandTotal: "desc" }
      : opts.sort === "debtAsc"
        ? { lastInvoiceGrandTotal: "asc" }
        : { name: "asc" };

  const [items, total] = await Promise.all([
    prisma.client.findMany({
      where,
      orderBy,
      skip: (page - 1) * perPage,
      take: perPage,
      select: PAYER_SELECT,
    }),
    prisma.client.count({ where }),
  ]);

  const ids = items.map((c) => c.id);
  const invoices = ids.length ? await invoicesByClientIds(ids) : [];

  const byClient = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const list = byClient.get(inv.clientId!) ?? [];
    list.push(inv);
    byClient.set(inv.clientId!, list);
  }

  const rows: PayerRow[] = items.map((c) => {
    const clientInvoices = byClient.get(c.id) ?? [];
    return toPayerRow(c, clientInvoices[0], clientInvoices.length, null);
  });

  return { items: rows, total, page, perPage, hasMore: page * perPage < total };
}

/** Contact minim al unui plătitor din lista filtrată — pentru "selectează toți cei din filtru". */
export type PayerContact = { id: string; name: string; email: string | null; phone: string | null };

/**
 * TOȚI plătitorii care respectă filtrele (fără paginare), doar id+nume+contact — ca să putem selecta
 * "toți cei 1 234 din filtru" și trimite notificări fără să ținem pe client mii de rânduri complete.
 * Aceeași logică de potrivire ca listPayers (inclusiv luna facturii și data instalării).
 */
export async function listMatchingPayerContacts(opts: ListPayersOpts = {}): Promise<PayerContact[]> {
  if (DEMO) return [];
  const month = parsePayerMonth(opts.month);
  const installedFrom = parseInstalledFrom(opts.installedFrom);
  if (month) return (await matchPayersForMonth(month, { ...opts, installedFrom })).matched;
  if (installedFrom || opts.sort === "installDesc" || opts.sort === "installAsc") {
    return (await matchPayersByInstall(opts, installedFrom)).matched;
  }
  return prisma.client.findMany({
    where: await buildPayerWhere(opts),
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, phone: true },
  });
}

/**
 * Sortare "Instalare: recente/vechi" sau filtrul "instalați de la" — necesită alăturare cu
 * OneCRecord (1C), care nu poate fi exprimată într-un `where` Prisma pe Client (colecții diferite
 * în MongoDB). La fel ca listPayersForMonth: aducem id-urile filtrate + mapa de date, sortăm/
 * paginăm în memorie, apoi hidratăm doar pagina cerută (nu toți ~19k dintr-o dată).
 */
async function matchPayersByInstall(opts: ListPayersOpts, installedFrom: string | undefined) {
  const where = await buildPayerWhere(opts);
  const [clients, installBy] = await Promise.all([
    prisma.client.findMany({ where, select: { id: true, name: true, email: true, phone: true } }),
    installDateMap(),
  ]);

  let matched = clients;
  if (installedFrom) {
    matched = matched.filter((c) => {
      const d = installBy.get(c.id);
      return !!d && d >= installedFrom;
    });
  }
  matched = sortByInstall(matched, installBy, opts.sort === "installAsc" ? 1 : -1);
  return { matched, installBy };
}

async function listPayersByInstall(opts: ListPayersOpts, installedFrom: string | undefined, page: number, perPage: number) {
  const { matched, installBy } = await matchPayersByInstall(opts, installedFrom);
  const total = matched.length;
  const ids = matched.slice((page - 1) * perPage, page * perPage).map((c) => c.id);
  const rows = await hydratePayerRows(ids, installBy);
  return { items: rows, total, page, perPage, hasMore: page * perPage < total };
}

/** Hidratează un set de id-uri (deja sortate/paginate) cu toate câmpurile unui PayerRow —
 * folosit de listPayersByInstall; păstrează ORDINEA din `ids` (Mongo nu garantează ordinea
 * rezultatelor pentru `id: { in: [...] }`). */
async function hydratePayerRows(ids: string[], installBy?: Map<string, string | null>): Promise<PayerRow[]> {
  if (!ids.length) return [];
  const [clients, invoices] = await Promise.all([
    clientsByIds(ids),
    invoicesByClientIds(ids),
  ]);
  const byId = new Map(clients.map((c) => [c.id, c]));
  const invByClient = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const list = invByClient.get(inv.clientId!) ?? [];
    list.push(inv);
    invByClient.set(inv.clientId!, list);
  }
  return ids
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => {
      const clientInvoices = invByClient.get(c.id) ?? [];
      return toPayerRow(c, clientInvoices[0], clientInvoices.length, installBy?.get(c.id) ?? null);
    });
}

const collator = new Intl.Collator("ro");

/**
 * Lista pentru o lună anume. Potrivirea plătitor ↔ factura lunii se face în memorie: un filtru
 * `id: { in: [~19.000 de id-uri] }` durează ~80 s în MongoDB (măsurat), deci aducem proiecții mici
 * (clienți filtrați + facturile lunii), le potrivim aici și citim din bază doar rândurile paginii.
 */
async function matchPayersForMonth(month: string, opts: ListPayersOpts) {
  const installedFrom = parseInstalledFrom(opts.installedFrom);
  const needsInstall = !!installedFrom || opts.sort === "installDesc" || opts.sort === "installAsc";
  // Sold/status (inclusiv intervalul min–max) se aplică pe factura lunii, în memorie — nu pe snapshot-ul ultimei facturi.
  const where = await buildPayerWhere({ ...opts, debt: undefined, invoiceStatus: undefined, minDebt: undefined, maxDebt: undefined });
  const [clients, monthInvoices, installBy] = await Promise.all([
    prisma.client.findMany({ where, select: { id: true, name: true, email: true, phone: true } }),
    prisma.invoice.findMany({
      where: { kind: "APA_CANAL", issueDate: monthRange(month), clientId: { not: null } },
      orderBy: { issueDate: "desc" },
      select: INVOICE_SELECT,
    }),
    needsInstall ? installDateMap() : Promise.resolve(new Map<string, string | null>()),
  ]);
  const invByClient = new Map<string, (typeof monthInvoices)[number]>();
  for (const inv of monthInvoices) if (inv.clientId && !invByClient.has(inv.clientId)) invByClient.set(inv.clientId, inv);

  let matched = clients.filter((c) => {
    const inv = invByClient.get(c.id);
    return inv && matchesMonthInvoice(inv, opts);
  });
  if (installedFrom) {
    matched = matched.filter((c) => {
      const d = installBy.get(c.id);
      return !!d && d >= installedFrom;
    });
  }
  if (opts.sort === "debtDesc" || opts.sort === "debtAsc") {
    const mul = opts.sort === "debtAsc" ? 1 : -1;
    matched.sort((a, b) => (invByClient.get(a.id)!.grandTotal - invByClient.get(b.id)!.grandTotal) * mul || collator.compare(a.name, b.name));
  } else if (opts.sort === "installDesc" || opts.sort === "installAsc") {
    matched = sortByInstall(matched, installBy, opts.sort === "installAsc" ? 1 : -1);
  } else {
    matched.sort((a, b) => collator.compare(a.name, b.name));
  }
  return { matched, invByClient, installBy, needsInstall };
}

async function listPayersForMonth(month: string, opts: ListPayersOpts, page: number, perPage: number) {
  const { matched, invByClient, installBy, needsInstall } = await matchPayersForMonth(month, opts);
  const total = matched.length;
  const ids = matched.slice((page - 1) * perPage, page * perPage).map((c) => c.id);
  const [pageClients, counts] = ids.length
    ? await Promise.all([
        clientsByIds(ids),
        invoiceCountsByClientIds(ids),
      ])
    : [[], []];
  const byId = new Map(pageClients.map((c) => [c.id, c]));
  const countBy = new Map(counts.map((c) => [c.clientId, c._count._all]));

  const rows: PayerRow[] = ids
    .map((id) => byId.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => toPayerRow(c, invByClient.get(c.id)!, countBy.get(c.id) ?? 0, needsInstall ? (installBy.get(c.id) ?? null) : null));

  return { items: rows, total, page, perPage, hasMore: page * perPage < total };
}

export type PayerDetail = {
  id: string;
  name: string;
  meterSeries: string | null;
  /** Nr. contract 1C — la firmele fără cont personal. */
  contract: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  activated: boolean;
  portalActivatedAt: Date | null;
  portalLastLoginAt: Date | null;
  meterNumber: string | null;
  meterCurrReading: number | null;
  consumAddress: string | null;
  /** „YYYY-MM-DD” — data expirării contractului (introdusă manual). */
  contractExpiresAt: string | null;
};

export async function getPayer(id: string): Promise<PayerDetail | null> {
  if (DEMO) return null;
  const c = await prisma.client.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      meterSeries: true,
      apaCanalContract: true,
      email: true,
      phone: true,
      notes: true,
      portalPasswordHash: true,
      portalActivatedAt: true,
      portalLastLoginAt: true,
      meterNumber: true,
      meterCurrReading: true,
      consumAddress: true,
      contractExpiresAt: true,
    },
  });
  if (!c || (!c.meterSeries && !c.apaCanalContract)) return null;
  return {
    id: c.id,
    name: c.name,
    meterSeries: c.meterSeries,
    contract: c.apaCanalContract,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    activated: !!c.portalPasswordHash,
    portalActivatedAt: c.portalActivatedAt,
    portalLastLoginAt: c.portalLastLoginAt,
    meterNumber: c.meterNumber,
    meterCurrReading: c.meterCurrReading,
    consumAddress: c.consumAddress,
    contractExpiresAt: contractKey(c.contractExpiresAt),
  };
}

export async function getPayerInvoices(clientId: string) {
  return prisma.invoice.findMany({
    where: { clientId },
    orderBy: { issueDate: "desc" },
    select: {
      id: true,
      number: true,
      status: true,
      grandTotal: true,
      currency: true,
      issueDate: true,
      publicToken: true,
      meterCurrReading: true,
      meterPrevReading: true,
      billingPeriodLabel: true,
      dueDate: true,
      paidAt: true,
      subtotal: true,
      datoriiAvans: true,
      kind: true,
    },
  });
}

export async function getPayerTickets(clientId: string) {
  return prisma.task.findMany({
    where: { clientId, type: "TICKET" },
    orderBy: { createdAt: "desc" },
    select: { id: true, seq: true, title: true, status: true, createdAt: true },
  });
}

/**
 * Snapshot COMPLET al plătitorilor (tupluri compacte — vezi SnapTuple în lib/payer-notify.ts), pentru motorul
 * local din browser: încărcat o singură dată, apoi filtrat/sortat/paginat în JS, fără interogări la fiecare filtru.
 * Trei citiri în bloc (clienți, facturi, date de instalare) potrivite în memorie — aceeași tehnică ca exportul.
 */
type LatestInvoice = { number: string; status: InvoiceStatus; grandTotal: number; currency: string; dueDate: Date | null };

// MongoDB întoarce valorile în format EJSON ({ $oid }, { $date }, { $numberDouble }…) — le aducem la tipuri JS.
const ejId = (v: unknown): string | null => (typeof v === "string" ? v : v && typeof v === "object" && "$oid" in v ? String((v as { $oid: unknown }).$oid) : null);
const ejNum = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const n = Number(o.$numberDouble ?? o.$numberInt ?? o.$numberLong ?? o.$numberDecimal ?? NaN);
    if (Number.isFinite(n)) return n;
  }
  return 0;
};
const ejDate = (v: unknown): Date | null => {
  if (!v) return null;
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  const d = (v as { $date?: unknown }).$date;
  if (typeof d === "string" || typeof d === "number") return new Date(d);
  const n = (d as { $numberLong?: string } | undefined)?.$numberLong;
  return n ? new Date(Number(n)) : null;
};

/**
 * Ultima factură și numărul de facturi pe client, calculate ÎN baza de date (agregare): în Node ajung ~19.000 de rânduri, nu toate
 * facturile. Citirea tuturor facturilor ca obiecte blochează procesul Node secunde-minute (deserializare + memorie) și încetinește
 * toate celelalte cereri. Întoarce null dacă agregarea eșuează — apelantul revine la citirea veche.
 */
async function latestInvoiceStats(): Promise<{ latest: Map<string, LatestInvoice>; count: Map<string, number> } | null> {
  try {
    const raw = (await prisma.invoice.aggregateRaw({
      pipeline: [
        { $match: { clientId: { $ne: null } } },
        { $project: { clientId: 1, number: 1, status: 1, grandTotal: 1, currency: 1, dueDate: 1, issueDate: 1 } },
        { $sort: { clientId: 1, issueDate: -1 } },
        {
          $group: {
            _id: "$clientId",
            n: { $sum: 1 },
            number: { $first: "$number" },
            status: { $first: "$status" },
            grandTotal: { $first: "$grandTotal" },
            currency: { $first: "$currency" },
            dueDate: { $first: "$dueDate" },
          },
        },
      ],
      options: { allowDiskUse: true },
    })) as unknown as Record<string, unknown>[];
    const latest = new Map<string, LatestInvoice>();
    const count = new Map<string, number>();
    for (const r of raw) {
      const id = ejId(r._id);
      if (!id) continue;
      count.set(id, ejNum(r.n));
      latest.set(id, {
        number: String(r.number ?? ""),
        status: r.status as InvoiceStatus,
        grandTotal: ejNum(r.grandTotal),
        currency: String(r.currency ?? "MDL"),
        dueDate: ejDate(r.dueDate),
      });
    }
    return { latest, count };
  } catch (e) {
    console.error("[platitori-snapshot] agregarea facturilor a eșuat, folosesc citirea completă:", e);
    return null;
  }
}

/** Varianta veche (fallback): toate facturile în Node, sortate în JS. */
async function latestInvoiceStatsFromRows(): Promise<{ latest: Map<string, LatestInvoice>; count: Map<string, number> }> {
  const invoices = byIssueDesc(await prisma.invoice.findMany({ where: { clientId: { not: null } }, select: INVOICE_SELECT }));
  const latest = new Map<string, LatestInvoice>();
  const count = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.clientId) continue;
    if (!latest.has(inv.clientId)) latest.set(inv.clientId, inv); // sortat desc → prima = cea mai recentă
    count.set(inv.clientId, (count.get(inv.clientId) ?? 0) + 1);
  }
  return { latest, count };
}

/**
 * Snapshot COMPLET al plătitorilor (tupluri compacte — vezi SnapTuple în lib/payer-notify.ts), pentru motorul
 * local din browser: încărcat o singură dată, apoi filtrat/sortat/paginat în JS, fără interogări la fiecare filtru.
 * Citiri în bloc (clienți, ultima factură pe client, date de instalare) potrivite în memorie — aceeași tehnică ca exportul.
 */
export async function getPayerSnapshot(): Promise<SnapTuple[]> {
  if (DEMO) return [];
  const [clients, stats, installBy, sectorBy] = await Promise.all([
    prisma.client.findMany({ where: PAYER_BASE, select: { ...PAYER_SELECT, lastInvoiceSectorNr: true, meterReadingEstimated: true } }),
    latestInvoiceStats(),
    installDateMap(),
    payerSectorMap(true),
  ]);
  const { latest, count } = stats && stats.latest.size > 0 ? stats : await latestInvoiceStatsFromRows();
  return clients.map((c): SnapTuple => {
    const inv = latest.get(c.id);
    return [
      c.id, c.name, c.meterSeries, c.apaCanalContract, c.email || null, c.phone || null,
      c.portalPasswordHash ? 1 : 0, count.get(c.id) ?? 0,
      inv?.number ?? null, inv?.status ?? null, inv?.grandTotal ?? null, inv?.currency ?? null, inv?.dueDate ? inv.dueDate.getTime() : null,
      c.consumAddress, c.lastNotifiedAt ? c.lastNotifiedAt.getTime() : null, installBy.get(c.id) ?? null, c.lastInvoiceSectorNr,
      sectorBy.get(c.id) ?? null, c.meterReadingEstimated ? 1 : 0, contractKey(c.contractExpiresAt),
    ];
  });
}

/** Facturile Apă-Canal ale unei luni (prima per plătitor) — pentru filtrul „Luna facturii" din motorul local. */
export async function getPayerMonthSlice(month: string): Promise<MonthTuple[]> {
  if (DEMO) return [];
  const parsed = parsePayerMonth(month);
  if (!parsed) return [];
  const invoices = byIssueDesc(
    await prisma.invoice.findMany({
      where: { kind: "APA_CANAL", issueDate: monthRange(parsed), clientId: { not: null } },
      select: INVOICE_SELECT,
    }),
  );
  const seen = new Set<string>();
  const out: MonthTuple[] = [];
  for (const inv of invoices) {
    if (!inv.clientId || seen.has(inv.clientId)) continue;
    seen.add(inv.clientId);
    out.push([inv.clientId, inv.number, inv.status, inv.grandTotal, inv.currency, inv.dueDate ? inv.dueDate.getTime() : null]);
  }
  return out;
}
