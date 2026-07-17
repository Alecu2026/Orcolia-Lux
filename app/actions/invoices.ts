"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { after } from "next/server";
import { requireUser, type CurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { createInvoice, updateInvoice } from "@/lib/services/invoices";
import { logAudit } from "@/lib/services/audit";
import { notifyUsers, observerRecipients } from "@/lib/services/notifications";
import { sendInvoiceEmail } from "@/lib/email";
import { env } from "@/lib/env";
import type { InvoiceStatus } from "@prisma/client";

const actor = (u: CurrentUser) => ({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin });

/** Trimite email clientului dacă factura are status SENT și clientul are email. */
function notifyClientEmail(invoiceId: string) {
  after(async () => {
    try {
      const inv = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: {
          number: true,
          grandTotal: true,
          currency: true,
          dueDate: true,
          publicToken: true,
          status: true,
          client: { select: { name: true, email: true } },
        },
      });
      if (!inv || inv.status !== "SENT" || !inv.client?.email) return;
      const company = await prisma.companySettings.findFirst({
        where: { singleton: "main" },
        select: { companyName: true, emailFromName: true, emailFromAddr: true },
      });
      await sendInvoiceEmail({
        to: inv.client.email,
        clientName: inv.client.name,
        invoiceNumber: inv.number,
        grandTotal: inv.grandTotal,
        currency: inv.currency,
        dueDate: inv.dueDate,
        publicUrl: `${env.appUrl}/invoice/public/${inv.publicToken}`,
        companyName: company?.companyName || null,
        fromName: company?.emailFromName || null,
        fromAddr: company?.emailFromAddr || null,
      });
    } catch {
      /* best-effort */
    }
  });
}

/** Notifică observatorii (eveniment factură), în fundal, fără actor. */
function notifyInvoiceEvent(eventKey: string, title: string, actorId: string) {
  after(async () => {
    try {
      const ids = (await observerRecipients(eventKey)).filter((id) => id !== actorId);
      if (ids.length) await notifyUsers(ids, { title, url: "/invoices" }, { telegram: true });
    } catch {
      /* best-effort */
    }
  });
}

export type InvoicePayload = {
  id?: string;
  status: InvoiceStatus;
  issueDate: string; // YYYY-MM-DD
  dueDate: string | null;
  clientId: string | null;
  projectId: string | null;
  taskIds: string[];
  notes: string;
  terms: string;
  items: { description: string; quantity: number; unitPrice: number; taxRate: number }[];
};

export type InvoiceActionResult = { ok: boolean; id?: string; error?: string };

const STATUSES: InvoiceStatus[] = ["DRAFT", "SENT", "PAID", "CANCELLED", "OVERDUE"];

function toDate(s: string | null): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T12:00:00`);
}

export async function saveInvoice(payload: InvoicePayload): Promise<InvoiceActionResult> {
  const user = await requireUser();
  const needed = payload.id ? "invoices.edit" : "invoices.create";
  if (!can(user, needed)) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };

  if (!payload.items || payload.items.length === 0) {
    return { ok: false, error: "Adaugă cel puțin un rând în factură." };
  }
  const status = STATUSES.includes(payload.status) ? payload.status : "DRAFT";

  const input = {
    status,
    issueDate: toDate(payload.issueDate) ?? new Date(),
    dueDate: toDate(payload.dueDate),
    clientId: payload.clientId,
    projectId: payload.projectId,
    taskIds: payload.taskIds,
    notes: payload.notes,
    terms: payload.terms,
    items: payload.items,
  };

  const res = payload.id
    ? await updateInvoice(payload.id, input)
    : await createInvoice(user.id, input);

  if (!res.ok) return { ok: false, error: res.error };
  const inv = await prisma.invoice.findUnique({ where: { id: res.id }, select: { number: true } });
  await logAudit(actor(user), {
    action: payload.id ? "invoice.update" : "invoice.create",
    module: "Invoices",
    objectId: res.id,
    objectName: inv?.number ?? null,
    newValue: status,
  });
  if (!payload.id) {
    notifyInvoiceEvent("invoice.created", `Factură nouă: ${inv?.number ?? ""}`.trim(), user.id);
  }
  if (status === "SENT") notifyClientEmail(res.id!);
  revalidatePath("/invoices");
  return { ok: true, id: res.id };
}

export type QuickDraftResult = { ok: true; id: string } | { ok: false; error: string };

/** Crează o factură DRAFT minimă — pentru dialogul vocal (utilizatorul o editează după). */
export async function quickDraftInvoice(opts: {
  title?: string;
  clientId?: string;
  projectId?: string;
  dueDate?: string;
  notes?: string;
  items?: { description: string; qty?: number; unitPrice?: number }[];
}): Promise<QuickDraftResult> {
  const user = await requireUser();
  if (!can(user, "invoices.create")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };

  const lineItems = opts.items?.length
    ? opts.items.map((i) => ({
        description: i.description || "Serviciu",
        quantity: i.qty ?? 1,
        unitPrice: i.unitPrice ?? 0,
        taxRate: 0,
      }))
    : [{ description: opts.title || "Serviciu", quantity: 1, unitPrice: 0, taxRate: 0 }];

  const today = new Date().toISOString().slice(0, 10);
  const res = await saveInvoice({
    status: "DRAFT",
    issueDate: today,
    dueDate: opts.dueDate ?? null,
    clientId: opts.clientId ?? null,
    projectId: opts.projectId ?? null,
    taskIds: [],
    notes: opts.notes ?? opts.title ?? "",
    terms: "",
    items: lineItems,
  });

  return res.ok ? { ok: true, id: res.id! } : { ok: false, error: res.error ?? "Eroare" };
}

export async function setInvoiceStatus(
  id: string,
  status: string,
): Promise<InvoiceActionResult> {
  const user = await requireUser();
  if (!can(user, "invoices.edit")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo." };
  if (!STATUSES.includes(status as InvoiceStatus)) return { ok: false, error: "Status invalid." };
  const before = await prisma.invoice.findUnique({ where: { id }, select: { number: true, status: true } });
  await prisma.invoice.update({ where: { id }, data: { status: status as InvoiceStatus } });
  await logAudit(actor(user), {
    action: "invoice.status_change",
    module: "Invoices",
    objectId: id,
    objectName: before?.number ?? null,
    oldValue: before?.status ?? null,
    newValue: status,
  });
  notifyInvoiceEvent("invoice.status", `Factură ${before?.number ?? ""}: status ${status}`.trim(), user.id);
  if (status === "SENT") notifyClientEmail(id);
  revalidatePath("/invoices");
  return { ok: true };
}

export async function deleteInvoice(id: string): Promise<void> {
  const user = await requireUser();
  if (!can(user, "invoices.delete")) return;
  if (DEMO) return;
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { number: true } });
  await prisma.invoiceItem.deleteMany({ where: { invoiceId: id } });
  await prisma.invoice.delete({ where: { id } }).catch(() => {});
  await logAudit(actor(user), { action: "invoice.delete", module: "Invoices", objectId: id, objectName: inv?.number ?? null });
  revalidatePath("/invoices");
}
