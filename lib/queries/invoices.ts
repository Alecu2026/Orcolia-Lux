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
}): Promise<{ items: InvoiceListItem[]; hasMore: boolean; page: number }> {
  if (DEMO) return { items: [], hasMore: false, page: 1 };
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
  const [rawRows, nameById] = await Promise.all([
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
  ]);
  const rows = rawRows as (Omit<(typeof rawRows)[number], "client"> & { client?: { name: string } | null; clientId?: string | null })[];

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
  };
}

const FULL_SELECT = {
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

export async function getInvoice(id: string) {
  if (DEMO) return null;
  return prisma.invoice.findUnique({ where: { id }, select: FULL_SELECT });
}

export async function getInvoiceByToken(token: string) {
  if (DEMO) return null;
  return prisma.invoice.findUnique({ where: { publicToken: token }, select: FULL_SELECT });
}

export type ConsumptionPoint = { label: string; value: number };

/**
 * Istoricul de consum al unui client (ultimele `limit` facturi Apă-Canal, inclusiv cea curentă),
 * pentru graficul din factură — `invoice.monthlyConsumption` are un singur punct (doar luna lui),
 * deci fără asta graficul arăta mereu o bară solitară, niciodată un trend pe mai multe luni.
 * O lună apărută de mai multe ori (corecție ulterioară) se reține o singură dată — factura cea
 * mai recentă pentru luna aia.
 */
export async function getApaCanalConsumptionHistory(clientId: string, limit = 6): Promise<ConsumptionPoint[]> {
  if (DEMO) return [];
  const invoices = await prisma.invoice.findMany({
    where: { clientId, kind: "APA_CANAL" },
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
