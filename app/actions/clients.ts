"use server";

import { invalidatePayers } from "@/lib/services/payer-cache";
import { invalidateInvoices } from "@/lib/services/invoice-cache";
import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser, type CurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { clientSchema } from "@/lib/validation";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";
import { CLIENT_SPEC, diffFields } from "@/lib/services/audit-diff";
import { linkCallsToClient } from "@/lib/services/phone-lookup";

export type ClientState = { ok?: boolean; error?: string; id?: string; name?: string } | undefined;

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
  // adresa (opțională) se păstrează în „adresa de consum”, ca la plătitori: apare și în popup-ul apelului și pe fișă
  const address = clean(formData.get("address"))?.slice(0, 300) ?? null;
  const client = await prisma.client.create({
    data: {
      userId: user.id,
      name: d.name,
      phone: d.phone || null,
      email: d.email || null,
      telegramChatId: d.telegramChatId || null,
      notes: d.notes || null,
      consumAddress: address,
    },
    select: { id: true },
  });
  await logAudit(actor(user), { action: "client.create", module: "Clients", objectId: client.id, objectName: d.name });
  // creat dintr-un apel PBX: apelul (și celelalte de la același număr) se leagă de clientul nou, ca numele lui să apară în listă și în popup
  if (d.phone || clean(formData.get("callId"))) {
    await linkCallsToClient(client.id, d.name, d.phone || null, clean(formData.get("callId"))).catch((e) => console.error("[clients] legarea apelurilor PBX:", String((e as Error)?.message ?? e).slice(0, 160)));
  }
  revalidatePath("/clients");
  updateTag("clients");
  return { ok: true, id: client.id, name: d.name };
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
  updateTag("clients");
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
  updateTag("clients");
  return { ok: true, id: client.id, name: client.name };
}

/**
 * După o schimbare pe un client, reface DOAR ce depinde de el: lista de plătitori (dacă e plătitor — listele de ~19.000 de rânduri nu se mai reconstruiesc la editarea unui client obișnuit)
 * și lista de facturi (dacă are facturi — numele lui apare pe ele). `payer` / `hadInvoices` se citesc ÎNAINTE de ștergere.
 */
async function refreshAfterClientChange(id: string, known?: { payer: boolean; hadInvoices: boolean }) {
  const ctx =
    known ??
    (await (async () => {
      const [c, inv] = await Promise.all([
        prisma.client.findUnique({ where: { id }, select: { meterSeries: true, apaCanalContract: true, apaCanalImport: true } }),
        prisma.invoice.findFirst({ where: { clientId: id }, select: { id: true } }),
      ]);
      return { payer: !c || !!(c.meterSeries || c.apaCanalContract || c.apaCanalImport), hadInvoices: !!inv };
    })());
  if (ctx.payer) await invalidatePayers();
  if (ctx.hadInvoices) await invalidateInvoices({ soft: true });
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
    select: { id: true, name: true, phone: true, email: true, telegramChatId: true, notes: true },
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
  // ID-ul Telegram nu mai e în formularul clientului: dacă lipsește din cerere, valoarea existentă rămâne neatinsă
  const tgGiven = formData.has("telegramChatId");
  await prisma.client.update({
    where: { id },
    data: {
      name: d.name,
      phone: d.phone || null,
      email: d.email || null,
      ...(tgGiven ? { telegramChatId: d.telegramChatId || null } : {}),
      notes: d.notes || null,
    },
  });
  await refreshAfterClientChange(id);
  await logAudit(actor(user), {
    action: "client.update",
    module: "Clients",
    objectId: id,
    objectName: d.name,
    oldValue: JSON.stringify({ name: owned.name, phone: owned.phone, email: owned.email }),
    newValue: JSON.stringify({ name: d.name, phone: d.phone || null, email: d.email || null }),
    details: {
      changes: diffFields(owned, { name: d.name, phone: d.phone || null, email: d.email || null, telegramChatId: tgGiven ? d.telegramChatId || null : owned.telegramChatId, notes: d.notes || null }, CLIENT_SPEC),
    },
  });
  revalidatePath("/clients");
  updateTag("clients");
  return { ok: true, id };
}

export async function deleteClient(id: string): Promise<void> {
  const user = await requireUser();
  if (!can(user, "clients.delete")) return;
  if (DEMO) return;
  const [c, inv] = await Promise.all([
    prisma.client.findFirst({ where: { id }, select: { name: true, meterSeries: true, apaCanalContract: true, apaCanalImport: true } }),
    prisma.invoice.findFirst({ where: { clientId: id }, select: { id: true } }),
  ]);
  await prisma.client.deleteMany({ where: { id } });
  await refreshAfterClientChange(id, { payer: !c || !!(c.meterSeries || c.apaCanalContract || c.apaCanalImport), hadInvoices: !!inv });
  await logAudit(actor(user), { action: "client.delete", module: "Clients", objectId: id, objectName: c?.name ?? null });
  revalidatePath("/clients");
  updateTag("clients");
}


export type ClientFieldPatch = { name?: string; phone?: string | null; email?: string | null; notes?: string | null };

/** Editare rapidă dintr-un singur câmp (celulele editabile din tabelul de clienți). Validează cu aceeași schemă ca formularul. */
export async function updateClientFieldAction(id: string, patch: ClientFieldPatch): Promise<ClientState> {
  const user = await requireUser();
  if (!can(user, "clients.edit")) return { error: "Fără permisiune." };
  if (DEMO) return { error: DEMO_MSG };
  if (!/^[0-9a-f]{24}$/i.test(id ?? "")) return { error: "Client invalid." };
  const owned = await prisma.client.findFirst({
    where: { id },
    select: { id: true, name: true, phone: true, email: true, telegramChatId: true, notes: true },
  });
  if (!owned) return { error: "Client inexistent." };

  const merged = {
    name: "name" in patch ? String(patch.name ?? "") : owned.name,
    phone: "phone" in patch ? String(patch.phone ?? "") : (owned.phone ?? ""),
    email: "email" in patch ? String(patch.email ?? "") : (owned.email ?? ""),
    telegramChatId: owned.telegramChatId ?? "",
    notes: "notes" in patch ? String(patch.notes ?? "") : (owned.notes ?? ""),
  };
  const parsed = clientSchema.safeParse(merged);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Date invalide." };
  const d = parsed.data;

  const data: Record<string, unknown> = {};
  if ("name" in patch) data.name = d.name;
  if ("phone" in patch) data.phone = d.phone || null;
  if ("email" in patch) data.email = d.email || null;
  if ("notes" in patch) data.notes = d.notes || null;
  if (Object.keys(data).length === 0) return { ok: true, id };

  await prisma.client.update({ where: { id }, data });
  await refreshAfterClientChange(id);
  await logAudit(actor(user), {
    action: "client.update",
    module: "Clients",
    objectId: id,
    objectName: d.name,
    oldValue: JSON.stringify({ name: owned.name, phone: owned.phone, email: owned.email }),
    newValue: JSON.stringify(data),
    details: { changes: diffFields(owned, data, CLIENT_SPEC) },
  });
  revalidatePath("/clients");
  updateTag("clients");
  return { ok: true, id };
}
