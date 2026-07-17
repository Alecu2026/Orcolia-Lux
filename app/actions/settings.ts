"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { settingsSchema, categorySchema } from "@/lib/validation";
import { DEMO } from "@/lib/demo";
import { sanitizeReminderPresets } from "@/lib/reminder-presets";
import type { StatusConfig } from "@/lib/ticket-status-config";
import { DEFAULT_STATUS_CONFIGS, parseStatusConfigs } from "@/lib/ticket-status-config";
import type { TaskStatus } from "@prisma/client";

export type SettingsState = { ok?: boolean; error?: string } | undefined;

const DEMO_MSG = "Mod demo: conectează o bază de date pentru a salva.";

export async function createCategory(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  if (DEMO) return { error: DEMO_MSG };
  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color") || "#6366f1",
    defaultDurationMinutes: formData.get("defaultDurationMinutes") || 30,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Date invalide." };
  }
  await prisma.category.create({
    data: { userId: user.id, ...parsed.data },
  });
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateCategory(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  if (user.role !== "ADMIN") return { error: "Doar administratorii pot edita categorii." };
  if (DEMO) return { error: DEMO_MSG };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "ID lipsă." };
  const parsed = categorySchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color") || "#6366f1",
    defaultDurationMinutes: formData.get("defaultDurationMinutes") || 30,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Date invalide." };
  await prisma.category.updateMany({ where: { id }, data: parsed.data });
  revalidatePath("/settings");
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<void> {
  const user = await requireUser();
  if (user.role !== "ADMIN") return;
  if (DEMO) return;
  await prisma.category.deleteMany({ where: { id } });
  revalidatePath("/settings");
}

export async function updateQuietHours(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  if (!user.isSuperAdmin) return { error: "Doar super-administratorii pot modifica orele de somn." };
  if (DEMO) return { error: DEMO_MSG };

  const enabled = formData.get("quietHoursEnabled") === "on";
  const start = String(formData.get("quietHoursStart") ?? "22:00").trim();
  const end = String(formData.get("quietHoursEnd") ?? "07:00").trim();
  const tz = String(formData.get("quietHoursTz") ?? "Europe/Bucharest").trim();

  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    return { error: "Format orar invalid (HH:MM)." };
  }

  await prisma.companySettings.upsert({
    where: { singleton: "main" },
    create: {
      quietHoursEnabled: enabled,
      quietHoursStart: start,
      quietHoursEnd: end,
      quietHoursTz: tz || "Europe/Bucharest",
    },
    update: {
      quietHoursEnabled: enabled,
      quietHoursStart: start,
      quietHoursEnd: end,
      quietHoursTz: tz || "Europe/Bucharest",
    },
  });
  revalidatePath("/settings");
  return { ok: true };
}

export async function updateSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  if (DEMO) return { error: DEMO_MSG };

  const offsets = sanitizeReminderPresets(formData.getAll("reminderOffsets").map(String));

  const parsed = settingsSchema.safeParse({
    timezone: formData.get("timezone") ?? "Europe/Bucharest",
    locale: formData.get("locale") ?? "ro",
    theme: formData.get("theme") ?? "system",
    workdayStart: formData.get("workdayStart") ?? "09:00",
    workdayEnd: formData.get("workdayEnd") ?? "18:00",
    slotMinutes: formData.get("slotMinutes") ?? 30,
    defaultReminderEmail: formData.get("defaultReminderEmail") === "on",
    defaultReminderTelegram: formData.get("defaultReminderTelegram") === "on",
    reminderOffsets: offsets.length ? offsets : ["DAY_BEFORE_8AM", "H3"],
    emailFromName: formData.get("emailFromName") ?? "",
    emailFromAddr: formData.get("emailFromAddr") ?? "",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Setări invalide." };
  }
  const d = parsed.data;

  await prisma.appSettings.upsert({
    where: { userId: user.id },
    create: {
      userId: user.id,
      timezone: d.timezone,
      locale: d.locale,
      theme: d.theme,
      workdayStart: d.workdayStart,
      workdayEnd: d.workdayEnd,
      slotMinutes: d.slotMinutes,
      defaultReminderEmail: d.defaultReminderEmail,
      defaultReminderTelegram: d.defaultReminderTelegram,
      reminderOffsets: d.reminderOffsets,
      emailFromName: d.emailFromName || null,
      emailFromAddr: d.emailFromAddr || null,
    },
    update: {
      timezone: d.timezone,
      locale: d.locale,
      theme: d.theme,
      workdayStart: d.workdayStart,
      workdayEnd: d.workdayEnd,
      slotMinutes: d.slotMinutes,
      defaultReminderEmail: d.defaultReminderEmail,
      defaultReminderTelegram: d.defaultReminderTelegram,
      reminderOffsets: d.reminderOffsets,
      emailFromName: d.emailFromName || null,
      emailFromAddr: d.emailFromAddr || null,
    },
  });

  revalidatePath("/settings");
  return { ok: true };
}

export async function saveTicketStatusConfig(
  configs: StatusConfig[],
): Promise<SettingsState> {
  const user = await requireUser();
  if (user.role !== "ADMIN") return { error: "Doar administratorii pot edita statusurile." };
  if (DEMO) return { error: DEMO_MSG };

  // Validare minimă
  if (!Array.isArray(configs) || configs.length === 0)
    return { error: "Configurare invalidă." };

  await prisma.companySettings.upsert({
    where: { singleton: "main" },
    create: { singleton: "main", ticketStatusConfig: configs as object[] },
    update: { ticketStatusConfig: configs as object[] },
  });

  revalidatePath("/settings");
  revalidatePath("/tickets");
  return { ok: true };
}

export async function deleteTicketStatus(
  key: string,
  newConfigs: StatusConfig[],
): Promise<SettingsState> {
  const user = await requireUser();
  if (user.role !== "ADMIN") return { error: "Doar administratorii pot edita statusurile." };
  if (DEMO) return { error: DEMO_MSG };
  if (newConfigs.length === 0) return { error: "Nu poți șterge ultimul status." };

  const firstKey = newConfigs[0].key as TaskStatus;

  await prisma.task.updateMany({
    where: { status: key as TaskStatus, type: "TICKET" },
    data: { status: firstKey },
  });

  await prisma.companySettings.upsert({
    where: { singleton: "main" },
    create: { singleton: "main", ticketStatusConfig: newConfigs as object[] },
    update: { ticketStatusConfig: newConfigs as object[] },
  });

  revalidatePath("/settings");
  revalidatePath("/tickets");
  return { ok: true };
}

export async function addTicketStatus(key: string): Promise<SettingsState> {
  const user = await requireUser();
  if (user.role !== "ADMIN") return { error: "Doar administratorii pot edita statusurile." };
  if (DEMO) return { error: DEMO_MSG };

  const settings = await prisma.companySettings.findUnique({ where: { singleton: "main" } });
  const configs = parseStatusConfigs(settings?.ticketStatusConfig);

  if (configs.find((c) => c.key === key)) return { error: "Statusul există deja." };

  const def = DEFAULT_STATUS_CONFIGS.find((c) => c.key === key);
  const newEntry: StatusConfig = def
    ? { ...def, order: configs.length }
    : { key, label: key, color: "#6b7280", notifyOnEnter: false, suppressAll: false, order: configs.length };

  const newConfigs = [...configs, newEntry];

  await prisma.companySettings.upsert({
    where: { singleton: "main" },
    create: { singleton: "main", ticketStatusConfig: newConfigs as object[] },
    update: { ticketStatusConfig: newConfigs as object[] },
  });

  revalidatePath("/settings");
  revalidatePath("/tickets");
  return { ok: true };
}
