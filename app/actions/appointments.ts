"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import {
  quickAppointmentSchema,
  updateStatusSchema,
  rescheduleSchema,
} from "@/lib/validation";
import {
  createAppointment,
  changeStatus,
  reschedule,
} from "@/lib/services/appointments";
import { DEMO } from "@/lib/demo";
import { sanitizeReminderPresets } from "@/lib/reminder-presets";
import {
  listByDateKey,
  listByDateKeys,
  type AppointmentListItem,
  type ApptFilter,
} from "@/lib/queries/appointments";
import { getSettings } from "@/lib/queries/settings";
import { todayKey, tomorrowKey, weekKeys, addDaysToKey } from "@/lib/date";
import { toVM } from "@/lib/view";
import type { ApptVM } from "@/app/components/types";
import type { AppointmentStatus } from "@prisma/client";

export type ApptState =
  | { ok?: boolean; error?: string; id?: string }
  | undefined;

function revalidateAll() {
  for (const p of ["/dashboard", "/appointments", "/calendar", "/kanban"]) {
    revalidatePath(p);
  }
}

export async function createQuickAppointment(
  _prev: ApptState,
  formData: FormData,
): Promise<ApptState> {
  const user = await requireUser();
  if (!can(user, "appointments.manage")) return { error: "Fără permisiune." };
  const parsed = quickAppointmentSchema.safeParse({
    clientId: formData.get("clientId") ?? "",
    clientName: formData.get("clientName") ?? "",
    clientPhone: formData.get("clientPhone") ?? "",
    clientEmail: formData.get("clientEmail") ?? "",
    categoryId: formData.get("categoryId") ?? "",
    dateKey: formData.get("dateKey"),
    time: formData.get("time"),
    durationMinutes: formData.get("durationMinutes") ?? 30,
    title: formData.get("title") ?? "",
    message: formData.get("message") ?? "",
    reminderEmail: formData.get("reminderEmail") === "on" || formData.get("reminderEmail") === "true",
    reminderTelegram:
      formData.get("reminderTelegram") === "on" || formData.get("reminderTelegram") === "true",
    reminderOffsets: formData.getAll("reminderOffsets").map(String),
    status: (formData.get("status") as string) || "NEW",
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Date invalide." };
  }
  const d = parsed.data;

  const result = await createAppointment(
    user.id,
    {
      clientId: d.clientId || undefined,
      clientName: d.clientName || undefined,
      clientPhone: d.clientPhone || undefined,
      clientEmail: d.clientEmail || undefined,
      categoryId: d.categoryId || undefined,
      dateKey: d.dateKey,
      time: d.time,
      durationMinutes: d.durationMinutes,
      title: d.title || undefined,
      message: d.message || undefined,
      reminderEmail: d.reminderEmail,
      reminderTelegram: d.reminderTelegram,
      reminderOffsets: sanitizeReminderPresets(d.reminderOffsets),
      status: d.status,
    },
    "WEB",
  );

  if (!result.ok) return { error: result.error };
  revalidateAll();
  return { ok: true, id: result.id };
}

export async function setStatus(id: string, status: string): Promise<ApptState> {
  const user = await requireUser();
  if (!can(user, "appointments.manage")) return { error: "Fără permisiune." };
  const parsed = updateStatusSchema.safeParse({ id, status });
  if (!parsed.success) return { error: "Status invalid." };
  const res = await changeStatus(user.id, parsed.data.id, parsed.data.status);
  if (!res.ok) return { error: res.error };
  revalidateAll();
  return { ok: true };
}

export async function rescheduleAppointment(
  _prev: ApptState,
  formData: FormData,
): Promise<ApptState> {
  const user = await requireUser();
  if (!can(user, "appointments.manage")) return { error: "Fără permisiune." };
  const parsed = rescheduleSchema.safeParse({
    id: formData.get("id"),
    dateKey: formData.get("dateKey"),
    time: formData.get("time"),
    durationMinutes: formData.get("durationMinutes") || undefined,
  });
  if (!parsed.success) return { error: "Date reprogramare invalide." };
  const res = await reschedule(
    user.id,
    parsed.data.id,
    parsed.data.dateKey,
    parsed.data.time,
    parsed.data.durationMinutes,
  );
  if (!res.ok) return { error: res.error };
  revalidateAll();
  return { ok: true };
}

const VALID_APPT_STATUSES = new Set(["NEW", "CONFIRMED", "IN_PROGRESS", "DONE", "CANCELLED", "NO_SHOW"]);

export async function listAppointmentsAction(opts: {
  view: string;
  q?: string;
  status?: string;
  category?: string;
}): Promise<{ items: ApptVM[]; grouped: boolean }> {
  const user = await requireUser();
  const settings = await getSettings(user.id);
  const tz = settings.timezone;

  const filter: ApptFilter = {
    search: opts.q?.trim() || undefined,
    status: (opts.status && VALID_APPT_STATUSES.has(opts.status)
      ? opts.status
      : undefined) as AppointmentStatus | undefined,
    categoryId: opts.category || undefined,
  };

  const today = todayKey(tz);
  const tomorrow = tomorrowKey(tz);
  let raw: AppointmentListItem[];
  let grouped = false;

  if (opts.view === "maine") {
    raw = await listByDateKey(user.id, tomorrow, filter);
  } else if (opts.view === "saptamana") {
    raw = await listByDateKeys(user.id, weekKeys(today, tz), filter);
    grouped = true;
  } else if (opts.view === "lista") {
    const keys = Array.from({ length: 14 }, (_, i) => addDaysToKey(today, i, tz));
    raw = await listByDateKeys(user.id, keys, filter);
    grouped = true;
  } else {
    raw = await listByDateKey(user.id, today, filter);
  }

  return { items: raw.map((a) => toVM(a, tz)), grouped };
}

export async function deleteAppointment(id: string): Promise<void> {
  const user = await requireUser();
  if (!can(user, "appointments.manage")) return;
  if (DEMO) return;
  const owned = await prisma.appointment.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return;
  await prisma.reminder.deleteMany({ where: { appointmentId: id } });
  await prisma.appointment.delete({ where: { id } });
  revalidateAll();
}
