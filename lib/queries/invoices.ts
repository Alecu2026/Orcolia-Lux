import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { InvoiceStatus, InvoiceKind, Prisma } from "@prisma/client";

const PAGE_SIZE = 25;

export type InvoiceListItem = {
  id: string;
  number: string;
  status: InvoiceStatus;
  kind: InvoiceKind;
  issueDate: Date;
  dueDate: Date | null;
  grandTotal: number;
  currency: string;
  clientName: string | null;
  publicToken: string;
};

export async function listInvoices(opts: {
  status?: InvoiceStatus;
  search?: string;
  page?: number;
}): Promise<{ items: InvoiceListItem[]; hasMore: boolean; page: number }> {
  if (DEMO) return { items: [], hasMore: false, page: 1 };
  const page = Math.max(1, opts.page ?? 1);
  const search = opts.search?.trim();

  const where: Prisma.InvoiceWhereInput = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(search ? { number: { contains: search, mode: "insensitive" } } : {}),
  };

  const rows = await prisma.invoice.findMany({
    where,
    select: {
      id: true,
      number: true,
      status: true,
      kind: true,
      issueDate: true,
      dueDate: true,
      grandTotal: true,
      currency: true,
      publicToken: true,
      client: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
  });

  const hasMore = rows.length > PAGE_SIZE;
  return {
    items: rows.slice(0, PAGE_SIZE).map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      kind: r.kind,
      issueDate: r.issueDate,
      dueDate: r.dueDate,
      grandTotal: r.grandTotal,
      currency: r.currency,
      clientName: r.client?.name ?? null,
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

// --- Date reactive pentru formularul de creare ---

export const invoiceClientOptions = unstable_cache(
  async (): Promise<{ id: string; name: string }[]> => {
    if (DEMO) return [];
    return prisma.client.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  },
  ["client-options"],
  { tags: ["clients"], revalidate: 300 },
);

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
