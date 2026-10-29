import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { getSettings } from "../queries/settings";
import { findOrCreateClient } from "../queries/clients";
import { findOverlapping, mineWhere } from "../queries/appointments";
import { notifyUsers } from "./notifications";
import { can } from "../permissions";
import { MAX_ADDRESS_LEN, MAX_MAP_URL_LEN, isMapUrl, normalizeLatLng } from "../map-links";
import { zonedToUtc, addDaysToKey, formatDate, formatTime, isValidDateKey, isValidTimeOfDay } from "../date";
import { sanitizeReminderPresets, type ReminderPresetKey } from "../reminder-presets";
import { APPT_REMINDER_STATUSES, nextApptReminderAt, parseReminderSchedule, type ReminderSchedule } from "../reminder-schedule";
import type { AppointmentStatus, CreatedFrom, Prisma } from "@prisma/client";

const OID = /^[0-9a-f]{24}$/i;

/** Utilizatorul „pentru care” e programarea (director): activ, cu acces la Programări, diferit de cel care o creează; altfel null. */
async function resolveAssignee(creatorId: string, assigneeId?: string | null): Promise<{ id: string; name: string } | null> {
  if (!assigneeId || !OID.test(assigneeId) || assigneeId === creatorId) return null;
  const u = await prisma.user.findFirst({ where: { id: assigneeId, isActive: true }, select: { id: true, name: true, role: true, permissions: true } });
  return u && can(u, "appointments.view") ? { id: u.id, name: u.name } : null;
}

/**
 * Notifică părțile unei programări cu asignat (cine a creat-o + cel pentru care e): în aplicație, push și Telegram.
 *  - "created": ambii (cel asignat află de programare, cel care a creat primește confirmarea);
 *  - "assigned": noul asignat + cel care a creat (dacă altcineva a făcut schimbarea);
 *  - "changed": doar cealaltă parte decât cel care a modificat.
 * Best-effort: o eroare de notificare nu strică salvarea.
 */
async function notifyParties(a: {
  kind: "created" | "assigned" | "changed";
  id: string;
  clientName: string;
  startAt: Date;
  tz: string;
  creatorId: string;
  assignee: { id: string; name: string };
  actorId: string;
}) {
  try {
    const creator = await prisma.user.findUnique({ where: { id: a.creatorId }, select: { name: true } });
    const when = `${formatDate(a.startAt, a.tz)} la ${formatTime(a.startAt, a.tz)}`;
    const url = `/appointments?id=${a.id}`;
    const toAssignee = a.assignee.id !== a.actorId;
    const toCreator = a.kind === "created" ? true : a.creatorId !== a.actorId;
    if (toAssignee) {
      await notifyUsers(
        [a.assignee.id],
        a.kind === "changed"
          ? { title: `🔄 Programare modificată: ${a.clientName}`, body: when, url }
          : { title: `📅 Ai o programare: ${a.clientName}`, body: `${when} · programată de ${creator?.name ?? "—"}`, url },
        { telegram: true },
      );
    }
    if (toCreator) {
      await notifyUsers(
        [a.creatorId],
        a.kind === "changed"
          ? { title: `🔄 Programare modificată: ${a.clientName}`, body: `${when} · ${a.assignee.name}`, url }
          : { title: `✅ Programare pentru ${a.assignee.name}: ${a.clientName}`, body: when, url },
        { telegram: true },
      );
    }
  } catch (e) {
    console.error("[appointments] notificarea părților:", e);
  }
}

/** Locația din formular, curățată: adresă (text, max 300), coordonate valide (ambele sau niciuna), link de hartă doar de la serverele acceptate. */
export type PlaceInput = { address?: string | null; lat?: number | null; lng?: number | null; mapUrl?: string | null };
function cleanPlace(p: PlaceInput): { address: string | null; lat: number | null; lng: number | null; mapUrl: string | null } {
  const ll = normalizeLatLng(p.lat ?? null, p.lng ?? null);
  const url = (p.mapUrl ?? "").trim();
  return {
    address: (p.address ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_ADDRESS_LEN) || null,
    lat: ll?.lat ?? null,
    lng: ll?.lng ?? null,
    mapUrl: url.length <= MAX_MAP_URL_LEN && isMapUrl(url) ? url : null,
  };
}

const isReminderStatus = (s: string) => (APPT_REMINDER_STATUSES as readonly string[]).includes(s);

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
  /**
   * Remindere ca la sarcini (vezi lib/reminder-schedule.ts): programare („înainte de începere”, zilnic, …) sau interval fix în minute. Dacă e dat unul dintre ele,
   * `reminderOffsets` și reminderele vechi pentru client nu se mai folosesc: reamintirile pleacă din `checkAppointmentReminders` către proprietar
   * (și către client, pe canalele bifate).
   */
  reminderSchedule?: ReminderSchedule | null;
  reminderIntervalMinutes?: number | null;
  status?: "NEW" | "CONFIRMED";
  /** Pentru cine e programarea (ex. directorul): o vede și el, iar el și cel care o creează sunt notificați. */
  assigneeId?: string | null;
  /** Locația programării (opțional). */
  place?: PlaceInput;
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
  const assignee = await resolveAssignee(userId, input.assigneeId);
  const overlap = await findOverlapping(userId, startAt, endAt, undefined, assignee?.id);
  if (overlap) {
    return {
      ok: false,
      error: `Interval ocupat: ${overlap.clientNameSnapshot} la ${formatTime(overlap.startAt, tz)}.`,
    };
  }

  // 5. Creare cu snapshot-uri
  const title = input.title?.trim() || category?.name || "Programare";
  const schedule = input.reminderSchedule ?? null;
  const intervalMin = input.reminderIntervalMinutes && input.reminderIntervalMinutes > 0 ? Math.round(input.reminderIntervalMinutes) : null;
  const engine = Boolean(schedule || intervalMin); // remindere noi (ca la sarcini) în loc de pragurile fixe vechi
  const offsets = engine ? [] : sanitizeReminderPresets(input.reminderOffsets ?? (settings.reminderOffsets as string[]));
  const nextReminderAt = engine && isReminderStatus(input.status ?? "NEW") ? nextApptReminderAt(schedule, intervalMin, startAt, new Date(), tz) : null;
  const appt = await prisma.appointment.create({
    data: {
      userId,
      ...(assignee ? { assigneeId: assignee.id } : {}),
      ...cleanPlace(input.place ?? {}),
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
      ...(schedule ? { reminderSchedule: schedule as unknown as Prisma.InputJsonValue } : {}),
      reminderIntervalMinutes: intervalMin,
      nextReminderAt,
      createdFrom: source,
    },
    select: { id: true, startAt: true },
  });

  // 5b. Verificare după inserare: două cereri simultane pe același interval pot trece ambele de verificarea de mai sus.
  // Pierde cea creată ulterior (id mai mare), deci rămâne exact una.
  const clash = await prisma.appointment.findFirst({
    where: {
      OR: [...(mineWhere(userId).OR ?? []), ...(assignee ? (mineWhere(assignee.id).OR ?? []) : [])],
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

  // 6. Reminders (vechile, către client — doar fără programare / interval nou)
  if (!engine) await createRemindersFor({
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

  if (assignee) await notifyParties({ kind: "created", id: appt.id, clientName: client.name, startAt, tz, creatorId: userId, assignee, actorId: userId });

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
    where: { id, ...mineWhere(userId) },
    select: {
      id: true, clientId: true, assigneeId: true, status: true, startAt: true, endAt: true, dateKey: true,
      reminderEmailEnabled: true, reminderTelegramEnabled: true, reminderOffsets: true,
      reminderSchedule: true, reminderIntervalMinutes: true,
      client: { select: { email: true, telegramChatId: true } },
    },
  });
  if (!appt) return { ok: false as const, error: "Programare inexistentă." };
  const schedule = parseReminderSchedule(appt.reminderSchedule, new Date(), undefined, { allowBefore: true });
  const engine = Boolean(schedule || appt.reminderIntervalMinutes);

  // O programare anulată / absentă care redevine activă ocupă din nou intervalul: dacă între timp a fost luat de alta, refuzăm.
  if ((appt.status === "CANCELLED" || appt.status === "NO_SHOW") && status !== "CANCELLED" && status !== "NO_SHOW") {
    const overlap = await findOverlapping(userId, appt.startAt, appt.endAt, id, appt.assigneeId);
    if (overlap) {
      const settingsForTz = await getSettings(userId);
      return { ok: false as const, error: `Interval ocupat: ${overlap.clientNameSnapshot} la ${formatTime(overlap.startAt, settingsForTz.timezone)}.` };
    }
  }

  // Remindere noi: o programare activă amintește mai departe; încheiată / anulată / absentă — se oprește; reactivată — reia de la momentul curent
  const settingsForTz = engine ? await getSettings(userId) : null;
  await prisma.appointment.update({
    where: { id },
    data: {
      status,
      ...(engine ? { nextReminderAt: isReminderStatus(status) ? nextApptReminderAt(schedule, appt.reminderIntervalMinutes, appt.startAt, new Date(), settingsForTz!.timezone) : null } : {}),
    },
  });

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
  } else if (!engine && (appt.status === "CANCELLED" || appt.status === "NO_SHOW") && appt.startAt.getTime() > Date.now()) {
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
      where: { id, ...mineWhere(userId) },
      select: {
        id: true,
        userId: true,
        assigneeId: true,
        clientNameSnapshot: true,
        status: true,
        startAt: true,
        endAt: true,
        reminderEmailEnabled: true,
        reminderTelegramEnabled: true,
        reminderOffsets: true,
        reminderSchedule: true,
        reminderIntervalMinutes: true,
        client: { select: { email: true, telegramChatId: true } },
      },
    }),
  ]);
  const tz = settings.timezone;
  if (!appt) return { ok: false as const, error: "Programare inexistentă." };
  const schedule = parseReminderSchedule(appt.reminderSchedule, new Date(), tz, { allowBefore: true });
  const engine = Boolean(schedule || appt.reminderIntervalMinutes);

  const duration =
    durationMinutes ??
    Math.round((appt.endAt.getTime() - appt.startAt.getTime()) / 60_000);
  const startAt = zonedToUtc(dateKey, time, tz);
  const endAt = new Date(startAt.getTime() + duration * 60_000);

  const overlap = await findOverlapping(userId, startAt, endAt, id, appt.assigneeId);
  if (overlap) {
    return {
      ok: false as const,
      error: `Interval ocupat: ${overlap.clientNameSnapshot} la ${formatTime(overlap.startAt, tz)}.`,
    };
  }

  await prisma.appointment.update({
    where: { id },
    // remindere noi: pragurile „înainte de începere” se recalculează față de noua oră (cele trecute se sar)
    data: { startAt, endAt, dateKey, ...(engine ? { nextReminderAt: isReminderStatus(appt.status) ? nextApptReminderAt(schedule, appt.reminderIntervalMinutes, startAt, new Date(), tz) : null } : {}) },
  });

  // Regenerează reminderele (doar pentru programări active: una anulată / absentă / încheiată nu mai primește remindere)
  await prisma.reminder.updateMany({
    where: { appointmentId: id, status: "PENDING" },
    data: { status: "CANCELLED" },
  });
  if (!engine && isReminderStatus(appt.status)) await createRemindersFor({
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

  if (appt.assigneeId) {
    const as = await prisma.user.findUnique({ where: { id: appt.assigneeId }, select: { id: true, name: true } });
    if (as) await notifyParties({ kind: "changed", id, clientName: appt.clientNameSnapshot, startAt, tz, creatorId: appt.userId, assignee: as, actorId: userId });
  }
  return { ok: true as const, startAt };
}

export type UpdateApptInput = {
  clientId?: string;
  clientName?: string;
  categoryId?: string;
  dateKey: string;
  time: string;
  durationMinutes: number;
  title?: string;
  message?: string;
  reminderEmail: boolean;
  reminderTelegram: boolean;
  /** Remindere ca la sarcini; fără niciuna, programarea rămâne fără remindere. */
  reminderSchedule?: ReminderSchedule | null;
  reminderIntervalMinutes?: number | null;
  /** Doar pentru o programare „Nouă” / „Confirmată” (celelalte statusuri se schimbă separat). */
  status?: "NEW" | "CONFIRMED";
  /** Pentru cine e programarea; gol / lipsă = fără asignat. */
  assigneeId?: string | null;
  /** Locația programării; lipsă / goală = fără locație. */
  place?: PlaceInput;
};

/**
 * Editare completă a unei programări: client, categorie, dată / oră / durată, descriere, mesaj, canale către client și reminderele.
 * Verifică suprapunerea (cu excepția ei însăși) și recalculează următoarea reamintire; reminderele vechi (praguri fixe) se anulează —
 * după editare programarea folosește doar noul sistem de remindere.
 */
export async function updateAppointment(userId: string, id: string, input: UpdateApptInput) {
  if (DEMO) return { ok: false as const, error: "Mod demo: modificările nu se salvează." };
  if (!OID.test(id ?? "")) return { ok: false as const, error: "Programare inexistentă." };
  if (!isValidDateKey(input.dateKey) || !isValidTimeOfDay(input.time)) return { ok: false as const, error: "Dată sau oră invalidă." };
  const [settings, appt] = await Promise.all([
    getSettings(userId),
    prisma.appointment.findFirst({ where: { id, ...mineWhere(userId) }, select: { id: true, userId: true, assigneeId: true, status: true, clientId: true, startAt: true } }),
  ]);
  if (!appt) return { ok: false as const, error: "Programare inexistentă." };
  const tz = settings.timezone;

  // client: cel ales; fără alegere nouă rămâne cel de până acum
  let client: { id: string; name: string };
  if (input.clientId || !input.clientName?.trim()) {
    const cid = input.clientId || appt.clientId;
    if (!OID.test(cid)) return { ok: false as const, error: "Clientul nu există." };
    const found = await prisma.client.findFirst({ where: { id: cid }, select: { id: true, name: true } });
    if (!found) return { ok: false as const, error: "Clientul nu există." };
    client = found;
  } else {
    client = await findOrCreateClient(userId, { name: input.clientName });
  }

  let category: { id: string; name: string; color: string } | null = null;
  if (input.categoryId && OID.test(input.categoryId)) {
    category = await prisma.category.findFirst({ where: { id: input.categoryId }, select: { id: true, name: true, color: true } });
  }

  const duration = Math.min(1440, Math.max(1, Math.round(input.durationMinutes) || settings.slotMinutes));
  const startAt = zonedToUtc(input.dateKey, input.time, tz);
  const endAt = new Date(startAt.getTime() + duration * 60_000);
  const status: AppointmentStatus = (appt.status === "NEW" || appt.status === "CONFIRMED") && input.status ? input.status : appt.status;

  const assignee = await resolveAssignee(appt.userId, input.assigneeId); // gol / lipsă = fără asignat

  // o programare anulată / absentă nu ocupă intervalul
  if (status !== "CANCELLED" && status !== "NO_SHOW") {
    const overlap = await findOverlapping(appt.userId, startAt, endAt, id, assignee?.id);
    if (overlap) return { ok: false as const, error: `Interval ocupat: ${overlap.clientNameSnapshot} la ${formatTime(overlap.startAt, tz)}.` };
  }

  const schedule = input.reminderSchedule ?? null;
  const intervalMin = input.reminderIntervalMinutes && input.reminderIntervalMinutes > 0 ? Math.round(input.reminderIntervalMinutes) : null;
  const nextReminderAt = isReminderStatus(status) ? nextApptReminderAt(schedule, intervalMin, startAt, new Date(), tz) : null;

  await prisma.appointment.update({
    where: { id },
    data: {
      clientId: client.id,
      clientNameSnapshot: client.name,
      assigneeId: assignee?.id ?? null,
      ...cleanPlace(input.place ?? {}),
      categoryId: category?.id ?? null,
      categoryNameSnapshot: category?.name ?? null,
      categoryColorSnapshot: category?.color ?? null,
      title: input.title?.trim() || category?.name || "Programare",
      message: input.message?.trim() || null,
      status,
      startAt,
      endAt,
      dateKey: input.dateKey,
      reminderEmailEnabled: input.reminderEmail,
      reminderTelegramEnabled: input.reminderTelegram,
      reminderOffsets: [],
      reminderSchedule: schedule ? (schedule as unknown as Prisma.InputJsonValue) : (null as unknown as Prisma.InputJsonValue),
      reminderIntervalMinutes: intervalMin,
      nextReminderAt,
    },
  });
  await prisma.reminder.updateMany({ where: { appointmentId: id, status: "PENDING" }, data: { status: "CANCELLED" } });

  // „Ultima programare” a clientului (best-effort, ca la creare)
  await prisma.client
    .updateMany({
      where: { id: client.id, OR: [{ lastAppointmentAt: { isSet: false } }, { lastAppointmentAt: null }, { lastAppointmentAt: { lt: startAt } }] },
      data: { lastAppointmentAt: startAt },
    })
    .catch(() => {});

  if (assignee) {
    const startChanged = startAt.getTime() !== appt.startAt.getTime();
    const kind = assignee.id !== appt.assigneeId ? "assigned" : startChanged ? "changed" : null;
    if (kind) await notifyParties({ kind, id, clientName: client.name, startAt, tz, creatorId: appt.userId, assignee, actorId: userId });
  }

  return { ok: true as const, startAt };
}
