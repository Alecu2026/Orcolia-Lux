"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, type CurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { clientSchema } from "@/lib/validation";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";

export type ClientState = { ok?: boolean; error?: string; id?: string } | undefined;

const actor = (u: CurrentUser) => ({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin });

const DEMO_MSG = "Mod demo: conectează o bază de date pentru a salva.";

function clean(v: FormDataEntryValue | null): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

export async function createClient(
  _prev: ClientState,
  formData: FormData,
): Promise<ClientState> {
  const user = await requireUser();
  if (!can(user, "clients.create")) return { error: "Fără permisiune." };
  if (DEMO) return { error: DEMO_MSG };
  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    telegramChatId: formData.get("telegramChatId") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Date invalide." };
  }
  const d = parsed.data;
  const client = await prisma.client.create({
    data: {
      userId: user.id,
      name: d.name,
      phone: d.phone || null,
      email: d.email || null,
      telegramChatId: d.telegramChatId || null,
      notes: d.notes || null,
    },
    select: { id: true },
  });
  await logAudit(actor(user), { action: "client.create", module: "Clients", objectId: client.id, objectName: d.name });
  revalidatePath("/clients");
  revalidateTag("clients", "max");
  return { ok: true, id: client.id };
}

export type QuickCreateResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: string };

/** Creare rapidă cu nume, telefon, email — pentru dialog vocal universal. */
export async function voiceCreateClient(
  name: string,
  phone?: string,
  email?: string,
): Promise<QuickCreateResult> {
  const user = await requireUser();
  if (!can(user, "clients.create")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: DEMO_MSG };
  const n = name.trim();
  if (!n) return { ok: false, error: "Numele e obligatoriu." };
  const client = await prisma.client.create({
    data: {
      userId: user.id,
      name: n,
      phone: phone?.trim() || null,
      email: email?.trim().toLowerCase() || null,
    },
    select: { id: true, name: true },
  });
  await logAudit(actor(user), { action: "client.create", module: "Clients", objectId: client.id, objectName: client.name });
  revalidatePath("/clients");
  revalidateTag("clients", "max");
  return { ok: true, id: client.id, name: client.name };
}

/** Creare rapidă (inline) doar cu numele — pentru dialoguri (task/factură). */
export async function quickCreateClient(name: string): Promise<QuickCreateResult> {
  const user = await requireUser();
  if (!can(user, "clients.create")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: DEMO_MSG };
  const n = name.trim();
  if (!n) return { ok: false, error: "Numele e obligatoriu." };
  const client = await prisma.client.create({
    data: { userId: user.id, name: n },
    select: { id: true, name: true },
  });
  await logAudit(actor(user), { action: "client.create", module: "Clients", objectId: client.id, objectName: client.name });
  revalidatePath("/clients");
  revalidateTag("clients", "max");
  return { ok: true, id: client.id, name: client.name };
}

export async function updateClient(
  _prev: ClientState,
  formData: FormData,
): Promise<ClientState> {
  const user = await requireUser();
  if (!can(user, "clients.edit")) return { error: "Fără permisiune." };
  if (DEMO) return { error: DEMO_MSG };
  const id = String(formData.get("id") ?? "");
  const owned = await prisma.client.findFirst({
    where: { id },
    select: { id: true, name: true, phone: true, email: true },
  });
  if (!owned) return { error: "Client inexistent." };

  const parsed = clientSchema.safeParse({
    name: formData.get("name"),
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    telegramChatId: formData.get("telegramChatId") ?? "",
    notes: formData.get("notes") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Date invalide." };
  }
  const d = parsed.data;
  await prisma.client.update({
    where: { id },
    data: {
      name: d.name,
      phone: d.phone || null,
      email: d.email || null,
      telegramChatId: d.telegramChatId || null,
      notes: d.notes || null,
    },
  });
  await logAudit(actor(user), {
    action: "client.update",
    module: "Clients",
    objectId: id,
    objectName: d.name,
    oldValue: JSON.stringify({ name: owned.name, phone: owned.phone, email: owned.email }),
    newValue: JSON.stringify({ name: d.name, phone: d.phone || null, email: d.email || null }),
  });
  revalidatePath("/clients");
  revalidateTag("clients", "max");
  return { ok: true, id };
}

export async function deleteClient(id: string): Promise<void> {
  const user = await requireUser();
  if (!can(user, "clients.delete")) return;
  if (DEMO) return;
  const c = await prisma.client.findFirst({ where: { id }, select: { name: true } });
  await prisma.client.deleteMany({ where: { id } });
  await logAudit(actor(user), { action: "client.delete", module: "Clients", objectId: id, objectName: c?.name ?? null });
  revalidatePath("/clients");
  revalidateTag("clients", "max");
}
