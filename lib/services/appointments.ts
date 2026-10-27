import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { getSettings } from "../queries/settings";
import { findOrCreateClient } from "../queries/clients";
import { findOverlapping } from "../queries/appointments";
import { zonedToUtc, addDaysToKey, formatTime, isValidDateKey, isValidTimeOfDay } from "../date";
import { sanitizeReminderPresets, type ReminderPresetKey } from "../reminder-presets";
import type { AppointmentStatus, CreatedFrom } from "@prisma/client";

const OID = /^[0-9a-f]{24}$/i;

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
  hasClientEmail: boolean;
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
    if (args.email && args.hasClientEmail) {
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
  if (!isValidDateKey(input.dateKey) || !isValidTimeOfDay(input.time)) {
    return { ok: false, error: "Dată sau oră invalidă." };
  }
  let client: { id: string; name: string; email: string | null; telegramChatId: string | null };
  if (input.clientId) {
    if (!OID.test(input.clientId)) return { ok: false, error: "Clientul nu există." };
    // Clienții sunt comuni pentru toată organizația (căutarea îi listează pe toți), nu doar cei creați de utilizatorul curent.
    const found = await prisma.client.findFirst({
      where: { id: input.clientId },
      select: { id: true, name: true, email: true, telegramChatId: true },
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
  if (input.categoryId && OID.test(input.categoryId)) {
    // Categoriile sunt comune (le vede oricine în dialog): nu se filtrează după utilizator.
    category = await prisma.category.findFirst({
      where: { id: input.categoryId },
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

  // 5b. Verificare după inserare: două cereri simultane pe același interval pot trece ambele de verificarea de mai sus.
  // Pierde cea creată ulterior (id mai mare), deci rămâne exact una.
  const clash = await prisma.appointment.findFirst({
    where: {
      userId,
      id: { not: appt.id },
      status: { in: ["NEW", "CONFIRMED", "IN_PROGRESS", "DONE"] },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: { id: true, clientNameSnapshot: true, startAt: true },
    orderBy: { id: "asc" },
  });
  if (clash && clash.id < appt.id) {
    await prisma.appointment.delete({ where: { id: appt.id } }).catch(() => {});
    return { ok: false, error: `Interval ocupat: ${clash.clientNameSnapshot} la ${formatTime(clash.startAt, tz)}.` };
  }

  // 6. Reminders
  await createRemindersFor({
    userId,
    appointmentId: appt.id,
    dateKey: input.dateKey,
    startAt,
    tz,
    email: input.reminderEmail,
    telegram: input.reminderTelegram,
    hasClientEmail: Boolean(client.email),
    hasClientTelegram: Boolean(client.telegramChatId),
    offsets,
  });

  // 7. „Ultima programare" a clientului = cea mai târzie (o programare adăugată pentru o dată mai veche NU o suprascrie)
  await prisma.client
    .updateMany({
      // în MongoDB un câmp lipsă nu e „null": `isSet: false` prinde clienții noi
      where: { id: client.id, OR: [{ lastAppointmentAt: { isSet: false } }, { lastAppointmentAt: null }, { lastAppointmentAt: { lt: startAt } }] },
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
  if (!OID.test(id ?? "")) return { ok: false as const, error: "Programare inexistentă." };
  const appt = await prisma.appointment.findFirst({
    where: { id, userId },
    select: {
      id: true, clientId: true, status: true, startAt: true, endAt: true, dateKey: true,
      reminderEmailEnabled: true, reminderTelegramEnabled: true, reminderOffsets: true,
      client: { select: { email: true, telegramChatId: true } },
    },
  });
  if (!appt) return { ok: false as const, error: "Programare inexistentă." };

  // O programare anulată / absentă care redevine activă ocupă din nou intervalul: dacă între timp a fost luat de alta, refuzăm.
  if ((appt.status === "CANCELLED" || appt.status === "NO_SHOW") && status !== "CANCELLED" && status !== "NO_SHOW") {
    const overlap = await findOverlapping(userId, appt.startAt, appt.endAt, id);
    if (overlap) {
      const settingsForTz = await getSettings(userId);
      return { ok: false as const, error: `Interval ocupat: ${overlap.clientNameSnapshot} la ${formatTime(overlap.startAt, settingsForTz.timezone)}.` };
    }
  }

  await prisma.appointment.update({ where: { id }, data: { status } });

  if (status === "NO_SHOW" && appt.status !== "NO_SHOW") {
    await prisma.client
      .update({ where: { id: appt.clientId }, data: { noShowCount: { increment: 1 } } })
      .catch(() => {});
  }
  // Ieșirea din „Nu a venit” (ex. marcat din greșeală) scade contorul înapoi.
  if (appt.status === "NO_SHOW" && status !== "NO_SHOW") {
    await prisma.client
      .updateMany({ where: { id: appt.clientId, noShowCount: { gt: 0 } }, data: { noShowCount: { decrement: 1 } } })
      .catch(() => {});
  }
  if (status === "CANCELLED" || status === "NO_SHOW") {
    await prisma.reminder.updateMany({
      where: { appointmentId: id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
  } else if ((appt.status === "CANCELLED" || appt.status === "NO_SHOW") && appt.startAt.getTime() > Date.now()) {
    // Reactivată (anulată / absent → activă): reminderele anulate la acel moment se recreează pentru pragurile încă viitoare.
    const settings = await getSettings(userId);
    await createRemindersFor({
      userId,
      appointmentId: id,
      dateKey: appt.dateKey,
      startAt: appt.startAt,
      tz: settings.timezone,
      email: appt.reminderEmailEnabled,
      telegram: appt.reminderTelegramEnabled,
      hasClientEmail: Boolean(appt.client.email),
      hasClientTelegram: Boolean(appt.client.telegramChatId),
      offsets: sanitizeReminderPresets(appt.reminderOffsets as string[]),
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
  if (!OID.test(id ?? "")) return { ok: false as const, error: "Programare inexistentă." };
  if (!isValidDateKey(dateKey) || !isValidTimeOfDay(time)) return { ok: false as const, error: "Dată sau oră invalidă." };
  const [settings, appt] = await Promise.all([
    getSettings(userId),
    prisma.appointment.findFirst({
      where: { id, userId },
      select: {
        id: true,
        status: true,
        startAt: true,
        endAt: true,
        reminderEmailEnabled: true,
        reminderTelegramEnabled: true,
        reminderOffsets: true,
        client: { select: { email: true, telegramChatId: true } },
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

  // Regenerează reminderele (doar pentru programări active: una anulată / absentă / încheiată nu mai primește remindere)
  await prisma.reminder.updateMany({
    where: { appointmentId: id, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if (appt.status === "NEW" || appt.status === "CONFIRMED" || appt.status === "IN_PROGRESS") await createRemindersFor({
    userId,
    appointmentId: id,
    dateKey,
    startAt,
    tz,
    email: appt.reminderEmailEnabled,
    telegram: appt.reminderTelegramEnabled,
    hasClientEmail: Boolean(appt.client.email),
    hasClientTelegram: Boolean(appt.client.telegramChatId),
    offsets: sanitizeReminderPresets(appt.reminderOffsets as string[]),
  });

  return { ok: true as const, startAt };
}
