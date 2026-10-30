"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, type CurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { clientSchema } from "@/lib/validation";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";
import { CLIENT_SPEC, diffFields } from "@/lib/services/audit-diff";
import { invalidatePayers } from "@/lib/services/payer-cache";
import { invalidateInvoices } from "@/lib/services/invoice-cache";
import { cleanContractDate, contractDate, contractKey } from "@/lib/contract-expiry";

export type PayerState = { ok?: boolean; error?: string } | undefined;

const actor = (u: CurrentUser) => ({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin });

export async function updatePayer(
  _prev: PayerState,
  formData: FormData,
): Promise<PayerState> {
  const user = await requireUser();
  if (!can(user, "payers.edit")) return { error: "Fără permisiune." };
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };

  const id = String(formData.get("id") ?? "");
  const existing = await prisma.client.findFirst({ where: { id, OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] }, select: { id: true, name: true, phone: true, email: true, notes: true, contractExpiresAt: true } });
  if (!existing) return { error: "Plătitor inexistent." };

  // data expirării contractului: câmpul gol o șterge; o dată invalidă nu se salvează în tăcere
  let contractKeyNew: string | null | undefined; // undefined = formularul nu trimite câmpul (rămâne neatins)
  if (formData.has("contractExpiresAt")) {
    const raw = String(formData.get("contractExpiresAt") ?? "").trim();
    contractKeyNew = raw ? cleanContractDate(raw) : null;
    if (raw && !contractKeyNew) return { error: "Data expirării contractului e invalidă (ZZ.LL.AAAA)." };
  }
  const contractOld = contractKey(existing.contractExpiresAt);
  const contractChanged = contractKeyNew !== undefined && contractKeyNew !== contractOld;

  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    telegramChatId: "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Date invalide." };
  const d = parsed.data;

  await prisma.client.update({
    where: { id },
    data: {
      name: d.name,
      phone: d.phone || null,
      email: d.email || null,
      // formularul din popup nu trimite câmpul „notes" — atunci notița veche din fișă rămâne neatinsă
      ...(formData.has("notes") ? { notes: d.notes || null } : {}),
      // o dată nouă = notificările „expiră în 30 / 10 zile” pornesc de la capăt pentru ea
      ...(contractChanged ? { contractExpiresAt: contractKeyNew ? contractDate(contractKeyNew) : null, contractNotified: [] } : {}),
    },
  });
  // consumerName e o copie denormalizată, înghețată pe fiecare factură la creare — corectarea
  // numelui aici NU se vedea pe facturile deja emise ale clientului (inclusiv pe cea publică,
  // pe care o vede clientul) dacă nu o propagăm și acolo.
  if (d.name !== existing.name) {
    await prisma.invoice.updateMany({ where: { clientId: id }, data: { consumerName: d.name } });
  }
  await logAudit(actor(user), {
    action: "client.update",
    module: "Payers",
    objectId: id,
    objectName: d.name,
    details: {
      changes: diffFields(
        { ...existing, contractExpiresAt: contractOld },
        { name: d.name, phone: d.phone || null, email: d.email || null, ...(formData.has("notes") ? { notes: d.notes || null } : {}), ...(contractKeyNew !== undefined ? { contractExpiresAt: contractKeyNew } : {}) },
        CLIENT_SPEC,
      ),
    },
  });
  revalidatePath(`/platitori/${id}`);
  revalidatePath("/platitori");
  await invalidatePayers();
  await invalidateInvoices({ soft: true }); // numele clientului se vede în lista de facturi
  return { ok: true };
}

export async function deletePayer(id: string): Promise<void> {
  const user = await requireUser();
  if (!can(user, "payers.delete")) return;
  if (DEMO) return;
  const c = await prisma.client.findFirst({ where: { id, OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] }, select: { name: true } });
  if (!c) return;
  // Cascade (schema): șterge și facturile/sesiunile/codurile legate de acest client.
  await prisma.payerNote.deleteMany({ where: { clientId: id } });
  await prisma.client.delete({ where: { id } });
  await invalidatePayers();
  await invalidateInvoices({ soft: true });
  await logAudit(actor(user), { action: "client.delete", module: "Payers", objectId: id, objectName: c.name });
  revalidatePath("/platitori");
}

export type BulkDeleteResult =
  | {
      ok: true;
      deletedIds: string[];
      skipped: { withInvoices: number; withActivity: number; activated: number; missing: number };
    }
  | { ok: false; error: string };

/**
 * Ștergere în masă (curățarea datelor de test). Șterge DOAR plătitorii fără facturi, programări, proiecte,
 * task-uri și fără cont de portal activat — verificat aici, pe server, indiferent ce trimite clientul; restul
 * sunt omiși și numărați. Un lot are cel mult 100 de id-uri.
 */
export async function deletePayersBulkAction(ids: string[]): Promise<BulkDeleteResult> {
  const user = await requireUser();
  if (!can(user, "payers.delete")) return { ok: false, error: "Fără permisiune de ștergere." };
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };
  const unique = [...new Set(Array.isArray(ids) ? ids : [])];
  if (unique.length === 0) return { ok: true, deletedIds: [], skipped: { withInvoices: 0, withActivity: 0, activated: 0, missing: 0 } };
  if (unique.length > 100 || unique.some((id) => typeof id !== "string" || !/^[0-9a-f]{24}$/i.test(id))) {
    return { ok: false, error: "Lot invalid." };
  }

  const payers = await prisma.client.findMany({
    where: { id: { in: unique }, OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] },
    select: { id: true, name: true, portalPasswordHash: true },
  });
  const found = payers.map((p) => p.id);
  const [inv, appt, proj, task] = await Promise.all([
    prisma.invoice.groupBy({ by: ["clientId"], where: { clientId: { in: found } }, _count: { _all: true } }),
    prisma.appointment.groupBy({ by: ["clientId"], where: { clientId: { in: found } }, _count: { _all: true } }),
    prisma.project.groupBy({ by: ["clientId"], where: { clientId: { in: found } }, _count: { _all: true } }),
    prisma.task.groupBy({ by: ["clientId"], where: { clientId: { in: found } }, _count: { _all: true } }),
  ]);
  const withInv = new Set(inv.map((r) => r.clientId));
  const withAct = new Set([...appt, ...proj, ...task].map((r) => r.clientId));

  const skipped = { withInvoices: 0, withActivity: 0, activated: 0, missing: unique.length - payers.length };
  const deletable: typeof payers = [];
  for (const p of payers) {
    if (withInv.has(p.id)) skipped.withInvoices++;
    else if (withAct.has(p.id)) skipped.withActivity++;
    else if (p.portalPasswordHash) skipped.activated++;
    else deletable.push(p);
  }

  const delIds = deletable.map((p) => p.id);
  if (delIds.length) {
    await prisma.payerNote.deleteMany({ where: { clientId: { in: delIds } } });
    await prisma.client.deleteMany({ where: { id: { in: delIds } } });
    await logAudit(actor(user), {
      action: "client.bulk_delete",
      module: "Payers",
      objectName: `${delIds.length} plătitori fără facturi șterși`,
      oldValue: deletable.slice(0, 5).map((p) => p.name).join(", ") + (deletable.length > 5 ? "…" : ""),
    });
    revalidatePath("/platitori");
    await invalidatePayers();
  }
  return { ok: true, deletedIds: delIds, skipped };
}

/**
 * Revocă accesul curent la portal (parolă + sesiuni) — clientul se poate reactiva de la zero
 * (aceeași serie de contor, poate cu alt email) prin fluxul normal de înregistrare.
 */
export async function resetPayerPortalAccess(id: string): Promise<void> {
  const user = await requireUser();
  if (!can(user, "admin")) return;
  if (DEMO) return;
  const c = await prisma.client.findFirst({ where: { id, OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] }, select: { name: true } });
  if (!c) return;

  await prisma.client.update({
    where: { id },
    data: { portalPasswordHash: null, portalActivatedAt: null, portalLastLoginAt: null },
  });
  await prisma.clientSession.deleteMany({ where: { clientId: id } });
  await logAudit(actor(user), { action: "client.portal_reset", module: "Payers", objectId: id, objectName: c.name });
  revalidatePath(`/platitori/${id}`);
  await invalidatePayers();
}
