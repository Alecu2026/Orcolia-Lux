import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { getCompanySettings } from "../queries/company";
import type { InvoiceStatus } from "@prisma/client";

export type InvoiceItemInput = {
  description: string;
  quantity: number;
  unitPrice: number;
  taxRate: number;
};

export type InvoiceInput = {
  status?: InvoiceStatus;
  issueDate?: Date;
  dueDate?: Date | null;
  clientId?: string | null;
  projectId?: string | null;
  taskId?: string | null;
  taskIds?: string[];
  notes?: string;
  terms?: string;
  items: InvoiceItemInput[];
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Calcule live: per linie + totaluri. */
export function computeTotals(items: InvoiceItemInput[]) {
  let subtotal = 0;
  let taxTotal = 0;
  const lines = items
    .filter((it) => (it.description ?? "").trim() !== "" || it.quantity || it.unitPrice)
    .map((it, i) => {
      const quantity = Number(it.quantity) || 0;
      const unitPrice = Number(it.unitPrice) || 0;
      const taxRate = Number(it.taxRate) || 0;
      const lineSubtotal = round2(quantity * unitPrice);
      const lineTax = round2((lineSubtotal * taxRate) / 100);
      const lineTotal = round2(lineSubtotal + lineTax);
      subtotal += lineSubtotal;
      taxTotal += lineTax;
      return {
        description: (it.description ?? "").trim(),
        quantity,
        unitPrice,
        taxRate,
        lineSubtotal,
        lineTotal,
        position: i,
      };
    });
  subtotal = round2(subtotal);
  taxTotal = round2(taxTotal);
  return { lines, subtotal, taxTotal, grandTotal: round2(subtotal + taxTotal) };
}

function genToken(): string {
  return randomBytes(18).toString("base64url");
}

async function genNumber(prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const count = await prisma.invoice.count({
    where: { createdAt: { gte: start, lt: end } },
  });
  let n = count + 1;
  let number = `${prefix}-${year}-${String(n).padStart(4, "0")}`;
  // Garantează unicitatea în caz de curse
  while (await prisma.invoice.findUnique({ where: { number }, select: { id: true } })) {
    n++;
    number = `${prefix}-${year}-${String(n).padStart(4, "0")}`;
  }
  return number;
}

export async function createInvoice(userId: string, input: InvoiceInput) {
  if (DEMO) return { ok: false as const, error: "Mod demo: conectează o bază de date." };
  const company = await getCompanySettings();
  const { lines, subtotal, taxTotal, grandTotal } = computeTotals(input.items);
  const number = await genNumber(company.invoicePrefix || "INV");

  const inv = await prisma.invoice.create({
    data: {
      number,
      status: input.status ?? "DRAFT",
      issueDate: input.issueDate ?? new Date(),
      dueDate: input.dueDate ?? null,
      clientId: input.clientId || null,
      projectId: input.projectId || null,
      taskIds: input.taskIds ?? [],
      taskId: (input.taskIds ?? [])[0] ?? input.taskId ?? null,
      notes: input.notes?.trim() || null,
      terms: input.terms?.trim() || null,
      currency: company.currency || "MDL",
      subtotal,
      taxTotal,
      grandTotal,
      publicToken: genToken(),
      userId,
      items: { create: lines },
    },
    select: { id: true },
  });
  return { ok: true as const, id: inv.id };
}

export async function updateInvoice(id: string, input: InvoiceInput) {
  if (DEMO) return { ok: false as const, error: "Mod demo." };
  const { lines, subtotal, taxTotal, grandTotal } = computeTotals(input.items);
  await prisma.invoiceItem.deleteMany({ where: { invoiceId: id } });
  await prisma.invoice.update({
    where: { id },
    data: {
      status: input.status,
      issueDate: input.issueDate,
      dueDate: input.dueDate ?? null,
      clientId: input.clientId || null,
      projectId: input.projectId || null,
      taskIds: input.taskIds ?? [],
      taskId: (input.taskIds ?? [])[0] ?? input.taskId ?? null,
      notes: input.notes?.trim() || null,
      terms: input.terms?.trim() || null,
      subtotal,
      taxTotal,
      grandTotal,
      items: { create: lines },
    },
  });
  return { ok: true as const, id };
}
