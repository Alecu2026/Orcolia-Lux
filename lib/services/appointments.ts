import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { getSettings } from "../queries/settings";
import { findOrCreateClient } from "../queries/clients";
import { findOverlapping } from "../queries/appointments";
import { zonedToUtc, addDaysToKey, formatTime } from "../date";
import { sanitizeReminderPresets, type ReminderPresetKey } from "../reminder-presets";
import type { AppointmentStatus, CreatedFrom } from "@prisma/client";

export type CreateApptInput = {
  clientId?: string;
  clientName?: string;
  clientPhone?: string;
  clientEmail?: string;
  clientTelegramChatId?: string;
  categoryId?: string;
  dateKey: string;
  time: string;
  durationMinutes?: number;
  title?: string;
  message?: string;
  reminderEmail: boolean;
  reminderTelegram: boolean;
  /** Praguri de remindere (vezi lib/reminder-presets.ts). Omis ⇒ se folosește standardul din Settings. */
  reminderOffsets?: string[];
  status?: "NEW" | "CONFIRMED";
};

export type CreateApptResult =
  | { ok: true; id: string; startAt: Date; clientName: string }
  | { ok: false; error: string };

/** Calculează momentul de trimitere pentru un preset dat (vezi lib/reminder-presets.ts). */
const PRESET_OFFSET: Record<ReminderPresetKey, (startAt: Date, dateKey: string, tz: string) => Date> = {
  DAY_BEFORE_8AM: (_startAt, dateKey, tz) => zonedToUtc(addDaysToKey(dateKey, -1, tz), "08:00", tz),
  H3: (startAt) => new Date(startAt.getTime() - 3 * 60 * 60_000),
  M30: (startAt) => new Date(startAt.getTime() - 30 * 60_000),
  M10: (startAt) => new Date(startAt.getTime() - 10 * 60_000),
};

/** Construiește momentele de trimitere a reminderelor (doar cele în viitor). */
function presetSendTimes(
  dateKey: string,
  startAt: Date,
  tz: string,
  presets: ReminderPresetKey[],
): Date[] {
  const now = Date.now();
  return presets
    .map((p) => PRESET_OFFSET[p](startAt, dateKey, tz))
    .filter((t) => t.getTime() > now);
}

async function createRemindersFor(args: {
  userId: string;
  appointmentId: string;
  dateKey: string;
  startAt: Date;
  tz: string;
  email: boolean;
  telegram: boolean;
  hasClientTelegram: boolean;
  offsets: ReminderPresetKey[];
}) {
  const times = presetSendTimes(args.dateKey, args.startAt, args.tz, args.offsets);
  if (times.length === 0) return;

  const data: {
    userId: string;
    appointmentId: string;
    type: "EMAIL" | "TELEGRAM";
    sendAt: Date;
  }[] = [];

  for (const sendAt of times) {
    if (args.email) {
      data.push({ userId: args.userId, appointmentId: args.appointmentId, type: "EMAIL", sendAt });
    }
    if (args.telegram && args.hasClientTelegram) {
      data.push({ userId: args.userId, appointmentId: args.appointmentId, type: "TELEGRAM", sendAt });
    }
  }
  if (data.length) await prisma.reminder.createMany({ data });
}

/**
 * Creează o programare. Refolosit de web (server action), Telegram și voce.
 * - rezolvă/creează clientul
 * - completează durata din categorie dacă lipsește
 * - verifică suprapunerea de interval
 * - salvează snapshot-urile (nume client, nume+culoare categorie)
 * - generează reminderele conform setărilor
 */
export async function createAppointment(
  userId: string,
  input: CreateApptInput,
  source: CreatedFrom = "WEB",
): Promise<CreateApptResult> {
  if (DEMO) {
    return { ok: false, error: "Mod demo: conectează o bază de date pentru a salva." };
  }
  // Pornește în paralel — nu depinde de client/categorie, doar e nevoie de ea mai jos.
  const settingsPromise = getSettings(userId);

  // 1. Client
  let client: { id: string; name: string; telegramChatId: string | null };
  if (input.clientId) {
    const found = await prisma.client.findFirst({
      where: { id: input.clientId, userId },
      select: { id: true, name: true, telegramChatId: true },
    });
    if (!found) return { ok: false, error: "Clientul nu există." };
    client = found;
  } else if (input.clientName?.trim()) {
    client = await findOrCreateClient(userId, {
      name: input.clientName,
      phone: input.clientPhone,
      email: input.clientEmail,
      telegramChatId: input.clientTelegramChatId,
    });
  } else {
    return { ok: false, error: "Lipsește clientul." };
  }

  // 2. Categorie + durată
  let category: { id: string; name: string; color: string; defaultDurationMinutes: number } | null =
    null;
  if (input.categoryId) {
    category = await prisma.category.findFirst({
      where: { id: input.categoryId, userId },
      select: { id: true, name: true, color: true, defaultDurationMinutes: true },
    });
  }
  const settings = await settingsPromise;
  const tz = settings.timezone;
  const duration =
    input.durationMinutes ?? category?.defaultDurationMinutes ?? settings.slotMinutes;

  // 3. Interval
  const startAt = zonedToUtc(input.dateKey, input.time, tz);
  const endAt = new Date(startAt.getTime() + duration * 60_000);

  // 4. Conflict
  const overlap = await findOverlapping(userId, startAt, endAt);
  if (overlap) {
    return {
      ok: false,
      error: `Interval ocupat: ${overlap.clientNameSnapshot} la ${formatTime(overlap.startAt, tz)}.`,
    };
  }

  // 5. Creare cu snapshot-uri
  const title = input.title?.trim() || category?.name || "Programare";
  const offsets = sanitizeReminderPresets(
    input.reminderOffsets ?? (settings.reminderOffsets as string[]),
  );
  const appt = await prisma.appointment.create({
    data: {
      userId,
      clientId: client.id,
      categoryId: category?.id ?? null,
      title,
      message: input.message?.trim() || null,
      status: (input.status ?? "NEW") as AppointmentStatus,
      startAt,
      endAt,
      dateKey: input.dateKey,
      clientNameSnapshot: client.name,
      categoryNameSnapshot: category?.name ?? null,
      categoryColorSnapshot: category?.color ?? null,
      reminderEmailEnabled: input.reminderEmail,
      reminderTelegramEnabled: input.reminderTelegram,
      reminderOffsets: offsets,
      createdFrom: source,
    },
    select: { id: true, startAt: true },
  });

  // 6. Reminders
  await createRemindersFor({
    userId,
    appointmentId: appt.id,
    dateKey: input.dateKey,
    startAt,
    tz,
    email: input.reminderEmail,
    telegram: input.reminderTelegram,
    hasClientTelegram: Boolean(client.telegramChatId),
    offsets,
  });

  // 7. Actualizează ultima programare a clientului
  await prisma.client
    .update({
      where: { id: client.id },
      data: { lastAppointmentAt: startAt },
    })
    .catch(() => {});

  return { ok: true, id: appt.id, startAt, clientName: client.name };
}

/** Schimbă statusul; ține evidența no-show pe client. */
export async function changeStatus(
  userId: string,
  id: string,
  status: AppointmentStatus,
) {
  if (DEMO) return { ok: false as const, error: "Mod demo: modificările nu se salvează." };
  const appt = await prisma.appointment.findFirst({
    where: { id, userId },
    select: { id: true, clientId: true, status: true },
  });
  if (!appt) return { ok: false as const, error: "Programare inexistentă." };

  await prisma.appointment.update({ where: { id }, data: { status } });

  if (status === "NO_SHOW" && appt.status !== "NO_SHOW") {
    await prisma.client
      .update({ where: { id: appt.clientId }, data: { noShowCount: { increment: 1 } } })
      .catch(() => {});
  }
  if (status === "CANCELLED" || status === "NO_SHOW") {
    await prisma.reminder.updateMany({
      where: { appointmentId: id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  }
  return { ok: true as const };
}

/** Reprogramează: recalculează interval, verifică conflict, regenerează reminderele. */
export async function reschedule(
  userId: string,
  id: string,
  dateKey: string,
  time: string,
  durationMinutes?: number,
) {
  if (DEMO) return { ok: false as const, error: "Mod demo: reprogramarea nu se salvează." };
  const [settings, appt] = await Promise.all([
    getSettings(userId),
    prisma.appointment.findFirst({
      where: { id, userId },
      select: {
        id: true,
        startAt: true,
        endAt: true,
        reminderEmailEnabled: true,
        reminderTelegramEnabled: true,
        reminderOffsets: true,
        client: { select: { telegramChatId: true } },
      },
    }),
  ]);
  const tz = settings.timezone;
  if (!appt) return { ok: false as const, error: "Programare inexistentă." };

  const duration =
    durationMinutes ??
    Math.round((appt.endAt.getTime() - appt.startAt.getTime()) / 60_000);
  const startAt = zonedToUtc(dateKey, time, tz);
  const endAt = new Date(startAt.getTime() + duration * 60_000);

  const overlap = await findOverlapping(userId, startAt, endAt, id);
  if (overlap) {
    return {
      ok: false as const,
      error: `Interval ocupat: ${overlap.clientNameSnapshot} la ${formatTime(overlap.startAt, tz)}.`,
    };
  }

  await prisma.appointment.update({
    where: { id },
    data: { startAt, endAt, dateKey },
  });

  // Regenerează reminderele
  await prisma.reminder.updateMany({
    where: { appointmentId: id, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  await createRemindersFor({
    userId,
    appointmentId: id,
    dateKey,
    startAt,
    tz,
    email: appt.reminderEmailEnabled,
    telegram: appt.reminderTelegramEnabled,
    hasClientTelegram: Boolean(appt.client.telegramChatId),
    offsets: sanitizeReminderPresets(appt.reminderOffsets as string[]),
  });

  return { ok: true as const, startAt };
}
