"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, type CurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { clientSchema } from "@/lib/validation";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";

export type PayerState = { ok?: boolean; error?: string } | undefined;

const actor = (u: CurrentUser) => ({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin });

export async function updatePayer(
  _prev: PayerState,
  formData: FormData,
): Promise<PayerState> {
  const user = await requireUser();
  if (!can(user, "clients.edit")) return { error: "Fără permisiune." };
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };

  const id = String(formData.get("id") ?? "");
  const existing = await prisma.client.findFirst({ where: { id, OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] }, select: { id: true, name: true } });
  if (!existing) return { error: "Plătitor inexistent." };

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
    data: { name: d.name, phone: d.phone || null, email: d.email || null, notes: d.notes || null },
  });
  // consumerName e o copie denormalizată, înghețată pe fiecare factură la creare — corectarea
  // numelui aici NU se vedea pe facturile deja emise ale clientului (inclusiv pe cea publică,
  // pe care o vede clientul) dacă nu o propagăm și acolo.
  if (d.name !== existing.name) {
    await prisma.invoice.updateMany({ where: { clientId: id }, data: { consumerName: d.name } });
  }
  await logAudit(actor(user), { action: "client.update", module: "Payers", objectId: id, objectName: d.name });
  revalidatePath(`/platitori/${id}`);
  revalidatePath("/platitori");
  return { ok: true };
}

export async function deletePayer(id: string): Promise<void> {
  const user = await requireUser();
  if (!can(user, "clients.delete")) return;
  if (DEMO) return;
  const c = await prisma.client.findFirst({ where: { id, OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] }, select: { name: true } });
  if (!c) return;
  // Cascade (schema): șterge și facturile/sesiunile/codurile legate de acest client.
  await prisma.payerNote.deleteMany({ where: { clientId: id } });
  await prisma.client.delete({ where: { id } });
  await logAudit(actor(user), { action: "client.delete", module: "Payers", objectId: id, objectName: c.name });
  revalidatePath("/platitori");
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
}
