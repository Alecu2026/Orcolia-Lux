import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { InvoiceStatus, InvoiceKind, Prisma } from "@prisma/client";

import { PER_PAGE_ALL } from "../payer-notify";

const DEFAULT_PAGE_SIZE = 50;

export type InvoiceListItem = {
  id: string;
  number: string;
  status: InvoiceStatus;
  kind: InvoiceKind;
  issueDate: Date;
  dueDate: Date | null;
  paidAt: Date | null;
  grandTotal: number;
  currency: string;
  clientName: string | null;
  publicToken: string;
};

export async function listInvoices(opts: {
  status?: InvoiceStatus;
  search?: string;
  page?: number;
  /** Câte pe pagină (implicit 50; PER_PAGE_ALL = toate). */
  perPage?: number;
}): Promise<{ items: InvoiceListItem[]; hasMore: boolean; page: number; total: number; totalPages: number }> {
  if (DEMO) return { items: [], hasMore: false, page: 1, total: 0, totalPages: 1 };
  const page = Math.max(1, opts.page ?? 1);
  const search = opts.search?.trim();
  const PAGE_SIZE = Math.min(Math.max(1, Math.floor(opts.perPage ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE), PER_PAGE_ALL);

  const where: Prisma.InvoiceWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    // Nu putem filtra după numele clientului (relație, Mongo) — dar facturile Apă-Canal au numele consumatorului și contul personal pe ele.
    ...(search
      ? {
          OR: [
            { number: { contains: search, mode: "insensitive" as const } },
            { consumerName: { contains: search, mode: "insensitive" as const } },
            { contPersonal: { contains: search, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  // La pagini mari (1000+ / „Toate") relația `client` ar însemna un `id: { in: [mii de id-uri] }` — foarte lent în MongoDB;
  // atunci citim numele clienților o singură dată (id + nume, câteva zeci de mii de rânduri mici) și le potrivim aici.
  const bigPage = PAGE_SIZE > 1000;
  const base = {
    id: true,
    number: true,
    status: true,
    kind: true,
    issueDate: true,
    dueDate: true,
    paidAt: true,
    grandTotal: true,
    currency: true,
    publicToken: true,
  } as const;
  const [rawRows, nameById, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      select: bigPage ? { ...base, clientId: true } : { ...base, client: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE + 1,
    }),
    bigPage
      ? prisma.client.findMany({ select: { id: true, name: true } }).then((cs) => new Map(cs.map((c) => [c.id, c.name])))
      : Promise.resolve(null),
    prisma.invoice.count({ where }),
  ]);
  const rows = rawRows as (Omit<(typeof rawRows)[number], "client"> & { client?: { name: string } | null; clientId?: string | null })[];

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasMore = rows.length > PAGE_SIZE;
  return {
    items: rows.slice(0, PAGE_SIZE).map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      kind: r.kind,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      paidAt: r.paidAt,
      grandTotal: r.grandTotal,
      currency: r.currency,
      clientName: nameById ? (r.clientId ? (nameById.get(r.clientId) ?? null) : null) : (r.client?.name ?? null),
      publicToken: r.publicToken,
    })),
    hasMore,
    page,
    total,
    totalPages,
  };
}

/** Câmpurile simple ale facturii (fără relații): formularul de editare nu are nevoie de client / proiect / task ca obiecte. */
const SCALAR_SELECT = {
  id: true,
  number: true,
  status: true,
  kind: true,
  issueDate: true,
  dueDate: true,
  notes: true,
  terms: true,
  currency: true,
  subtotal: true,
  taxTotal: true,
  grandTotal: true,
  publicToken: true,
  clientId: true,
  projectId: true,
  taskId: true,
  taskIds: true,
  contPersonal: true,
  sectorNr: true,
  consumAddress: true,
  consumerName: true,
  meterNumber: true,
  meterPrevReading: true,
  meterCurrReading: true,
  isEstimatedVolume: true,
  billingPeriodLabel: true,
  recalculari: true,
  penalitati: true,
  datoriiAvans: true,
  monthlyConsumption: true,
} as const;

const ITEM_SELECT = {
  id: true,
  description: true,
  quantity: true,
  unitPrice: true,
  taxRate: true,
  lineSubtotal: true,
  lineTotal: true,
} as const;

const FULL_SELECT = {
  ...SCALAR_SELECT,
  client: { select: { id: true, name: true, phone: true, email: true, notes: true } },
  project: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
  items: {
    select: {
      id: true,
      description: true,
      quantity: true,
      unitPrice: true,
      taxRate: true,
      lineSubtotal: true,
      lineTotal: true,
    },
    orderBy: { position: "asc" as const },
  },
} as const;

/**
 * Factura pentru formularul de editare: rândul facturii și liniile ei pornesc deodată (după id), fără relațiile client / proiect / task pe care formularul nu le folosește
 * (cu `FULL_SELECT`, Prisma făcea trei niveluri de interogări succesive).
 */
export async function getInvoiceForEdit(id: string) {
  if (DEMO) return null;
  const [inv, items] = await Promise.all([
    prisma.invoice.findUnique({ where: { id }, select: SCALAR_SELECT }),
    prisma.invoiceItem.findMany({ where: { invoiceId: id }, select: ITEM_SELECT, orderBy: { position: "asc" } }),
  ]);
  return inv ? { ...inv, items } : null;
}

export async function getInvoiceByToken(token: string) {
  if (DEMO) return null;
  // Codul facturii e base64url (litere, cifre, „_" și „-"). Dacă linkul a fost copiat/deschis cu punctuație la capăt
  // (ex. „…/cod." dintr-un mesaj cu „{link}."), o ignorăm, ca linkul să se deschidă oricum.
  const clean = token.replace(/[^A-Za-z0-9_-]+$/, "");
  if (!clean) return null;
  return prisma.invoice.findUnique({ where: { publicToken: clean }, select: FULL_SELECT });
}

export type ConsumptionPoint = { label: string; value: number };

/**
 * Istoricul de consum al unui client (ultimele `limit` facturi Apă-Canal, inclusiv cea curentă),
 * pentru graficul din factură — `invoice.monthlyConsumption` are un singur punct (doar luna lui),
 * deci fără asta graficul arăta mereu o bară solitară, niciodată un trend pe mai multe luni.
 * O lună apărută de mai multe ori (corecție ulterioară) se reține o singură dată — factura cea
 * mai recentă pentru luna aia.
 */
export async function getApaCanalConsumptionHistory(clientId: string, limit = 6, upTo?: Date): Promise<ConsumptionPoint[]> {
  if (DEMO) return [];
  const invoices = await prisma.invoice.findMany({
    // `upTo`: graficul unei facturi arată luni până la luna ei inclusiv — nu luni mai noi (factura din august nu arată septembrie).
    where: { clientId, kind: "APA_CANAL", ...(upTo ? { issueDate: { lte: upTo } } : {}) },
    orderBy: { issueDate: "desc" },
    take: limit,
    select: { issueDate: true, monthlyConsumption: true },
  });
  const byMonth = new Map<string, ConsumptionPoint>();
  for (const inv of invoices) {
    const monthKey = `${inv.issueDate.getUTCFullYear()}-${inv.issueDate.getUTCMonth()}`;
    if (byMonth.has(monthKey)) continue; // prima întâlnită = cea mai recentă (orderBy desc)
    const points = Array.isArray(inv.monthlyConsumption) ? (inv.monthlyConsumption as ConsumptionPoint[]) : [];
    if (points[0]) byMonth.set(monthKey, points[0]);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, p]) => p);
}

/**
 * Consumul (m³) pe lună, pentru cele 12 luni care se termină cu luna lui `issueDate` — ca să precompletăm grila „Consum lunar" din
 * formularul unei facturi cu valorile din celelalte facturi Apă-Canal ale aceluiași plătitor (altfel formularul arată doar luna
 * facturii curente, restul rămân goale). Valoarea unei luni = consumul din factura emisă în luna aceea (cea mai recentă, dacă sunt
 * mai multe), iar dacă factura nu are grafic salvat, cantitatea de la „alimentare cu apă". Eticheta = numărul lunii (1–12).
 */
export async function getApaCanalMonthlyForForm(clientId: string, issueDate: Date): Promise<ConsumptionPoint[]> {
  if (DEMO) return [];
  if (!/^[0-9a-f]{24}$/i.test(clientId)) return [];
  const start = new Date(Date.UTC(issueDate.getUTCFullYear(), issueDate.getUTCMonth() - 11, 1));
  const end = new Date(Date.UTC(issueDate.getUTCFullYear(), issueDate.getUTCMonth() + 1, 1)); // exclusiv
  // Facturile lunilor și, odată cu ele, cantitățile din liniile „alimentare cu apă” (pentru lunile fără valoare în grafic), într-un SINGUR drum către baza de date ($lookup) — nu două interogări la rând.
  const raw = (await prisma.invoice.aggregateRaw({
    pipeline: [
      { $match: { clientId: { $oid: clientId }, kind: "APA_CANAL", issueDate: { $gte: { $date: start.toISOString() }, $lt: { $date: end.toISOString() } } } },
      { $sort: { issueDate: -1 } },
      {
        $lookup: {
          from: "InvoiceItem",
          let: { id: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$invoiceId", "$$id"] }, description: { $regex: "alimentare cu ap[aă]", $options: "i" } } },
            { $sort: { position: 1 } },
            { $project: { _id: 0, quantity: 1 } },
          ],
          as: "apa",
        },
      },
      { $project: { issueDate: 1, monthlyConsumption: 1, apa: 1 } },
    ],
  })) as unknown as { _id: unknown; issueDate: unknown; monthlyConsumption?: unknown; apa?: { quantity?: unknown }[] }[];
  const num = (v: unknown): number | null => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const n = Number(o.$numberDouble ?? o.$numberInt ?? o.$numberLong ?? o.$numberDecimal ?? NaN);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };
  const dateOf = (v: unknown): Date => {
    const d = (v as { $date?: unknown } | null)?.$date ?? v;
    if (typeof d === "string" || typeof d === "number") return new Date(d);
    const n = (d as { $numberLong?: string } | undefined)?.$numberLong;
    return new Date(n ? Number(n) : NaN);
  };
  const invoices = raw.map((r) => ({ issueDate: dateOf(r.issueDate), monthlyConsumption: r.monthlyConsumption ?? null, apa: r.apa ?? [] }));
  const ownValue = (inv: (typeof invoices)[number]): number | null => {
    const month = inv.issueDate.getUTCMonth() + 1;
    const points = Array.isArray(inv.monthlyConsumption) ? (inv.monthlyConsumption as { label: unknown; value: unknown }[]) : [];
    const own = points.find((p) => String(p.label) === String(month)) ?? points[0];
    return own != null && Number.isFinite(Number(own.value)) ? Number(own.value) : null;
  };
  // prima linie „alimentare cu apă” (după poziție) cu cantitate numerică
  const apaQty = (inv: (typeof invoices)[number]): number | null => {
    for (const l of inv.apa) {
      const q = num(l.quantity);
      if (q != null) return q;
    }
    return null;
  };
  const byMonth = new Map<number, number>();
  for (const inv of invoices) {
    const month = inv.issueDate.getUTCMonth() + 1;
    if (byMonth.has(month)) continue; // prima întâlnită = cea mai recentă pentru luna aceea (orderBy desc)
    const value = ownValue(inv) ?? apaQty(inv);
    if (value != null) byMonth.set(month, value);
  }
  return [...byMonth.entries()].map(([m, v]) => ({ label: String(m), value: v }));
}

// --- Date reactive pentru formularul de creare ---

export const invoiceProjectOptions = unstable_cache(
  async (): Promise<{ id: string; name: string; clientId: string | null }[]> => {
    if (DEMO) return [];
    return prisma.project.findMany({
      select: { id: true, name: true, clientId: true },
      orderBy: { name: "asc" },
    });
  },
  ["invoice-project-options"],
  { tags: ["projects"], revalidate: 300 },
);

export async function tasksByProject(projectId: string): Promise<{ id: string; title: string }[]> {
  if (DEMO) return [];
  return prisma.task.findMany({
    where: { projectId },
    select: { id: true, title: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
}

export async function getInvoiceTaskTitles(taskIds: string[]): Promise<{ id: string; title: string }[]> {
  if (DEMO || !taskIds.length) return [];
  return prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true } });
}
