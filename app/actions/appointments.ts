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
  updateAppointment,
} from "@/lib/services/appointments";
import { parseReminderSchedule, type ReminderSchedule } from "@/lib/reminder-schedule";
import { MAX_MAP_URL_LEN, isMapUrl, parseCoordinates } from "@/lib/map-links";
import { DEMO } from "@/lib/demo";
import { sanitizeReminderPresets } from "@/lib/reminder-presets";
import {
  listByDateKey,
  listByDateKeys,
  type AppointmentListItem,
  type ApptFilter,
} from "@/lib/queries/appointments";
import { getSettings } from "@/lib/queries/settings";
import { mineWhere } from "@/lib/queries/appointments";
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
  const rem = readReminders(formData);

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
      // formularul nou trimite reminderele ca la sarcini; „fără” = fără remindere (nu se cade pe standardul din setări)
      reminderOffsets: rem.engine ? [] : sanitizeReminderPresets(d.reminderOffsets),
      reminderSchedule: rem.schedule,
      reminderIntervalMinutes: rem.interval,
      status: d.status,
      assigneeId: String(formData.get("assigneeId") ?? "") || undefined,
      place: readPlace(formData),
    },
    "WEB",
  );

  if (!result.ok) return { error: result.error };
  revalidateAll();
  return { ok: true, id: result.id };
}

/** Locația din formular (adresă, lat, lng, link); validarea finală se face în serviciu. */
function readPlace(fd: FormData): { address: string; lat: number | null; lng: number | null; mapUrl: string } {
  const n = (k: string) => {
    const v = String(fd.get(k) ?? "").trim();
    return v === "" ? null : Number(v);
  };
  return { address: String(fd.get("address") ?? ""), lat: n("lat"), lng: n("lng"), mapUrl: String(fd.get("mapUrl") ?? "") };
}

/**
 * Coordonatele dintr-un link de hartă lipit de utilizator (inclusiv linkuri scurte: maps.app.goo.gl). Întâi se încearcă direct din text; altfel, doar pentru
 * servere de hărți cunoscute, se urmărește redirectarea (fără alte adrese: nu se deschid linkuri arbitrare de pe server).
 */
export async function resolveMapLinkAction(input: string): Promise<{ ok: true; lat: number; lng: number; mapUrl: string | null } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "appointments.manage")) return { ok: false, error: "Fără permisiune." };
  const text = String(input ?? "").trim().slice(0, MAX_MAP_URL_LEN);
  if (!text) return { ok: false, error: "Lipește un link de hartă sau coordonate." };
  const direct = parseCoordinates(text);
  const isUrl = /^https?:\/\//i.test(text);
  if (direct) return { ok: true, ...direct, mapUrl: isUrl && isMapUrl(text) ? text : null };
  if (!isUrl || !isMapUrl(text)) return { ok: false, error: "Linkul trebuie să fie de la Google Maps, Apple Maps sau Waze (sau scrie coordonatele: 47.0245, 28.8322)." };
  try {
    const res = await fetch(text, { redirect: "follow", signal: AbortSignal.timeout(7000), headers: { "user-agent": "Mozilla/5.0 (compatible; CRM)", "accept-language": "en" } });
    const finalUrl = res.url || text;
    if (!isMapUrl(finalUrl) && !/consent\.google\./.test(finalUrl)) return { ok: false, error: "Linkul nu duce la o hartă cunoscută." };
    let found = parseCoordinates(finalUrl);
    if (!found) {
      // pagina conține adesea coordonatele în conținut: primii ~300 KB
      const body = (await res.text()).slice(0, 300_000);
      found = parseCoordinates(body.match(/@-?\d{1,3}\.\d+,-?\d{1,3}\.\d+/)?.[0] ?? "") ?? parseCoordinates(body.match(/!3d-?\d{1,3}\.\d+!4d-?\d{1,3}\.\d+/)?.[0] ?? "") ?? parseCoordinates(body.match(/center=-?\d{1,3}\.\d+(?:%2C|,)-?\d{1,3}\.\d+/)?.[0]?.replace("center=", "?center=") ?? "");
    }
    if (!found) return { ok: false, error: "Nu am găsit coordonatele în link. Deschide locul în Google Maps și copiază coordonatele sau linkul lung." };
    return { ok: true, ...found, mapUrl: isMapUrl(finalUrl) ? finalUrl : text };
  } catch {
    return { ok: false, error: "Nu am putut deschide linkul. Încearcă din nou sau scrie coordonatele." };
  }
}

/** Reminderele din formular (ReminderPicker în mod programare): `remindersNew` marchează formularul nou; programarea e validată pe server. */
function readReminders(fd: FormData): { engine: boolean; schedule: ReminderSchedule | null; interval: number | null } {
  const engine = fd.get("remindersNew") === "1";
  let schedule: ReminderSchedule | null = null;
  const raw = String(fd.get("reminderSchedule") ?? "");
  if (engine && raw) {
    try {
      schedule = parseReminderSchedule(JSON.parse(raw), new Date(), undefined, { allowBefore: true });
    } catch {}
  }
  const n = Math.round(Number(fd.get("reminderIntervalMinutes") ?? 0));
  const interval = engine && !schedule && Number.isFinite(n) && n >= 1 && n <= 366 * 1440 ? n : null;
  return { engine, schedule, interval };
}

/** Editarea completă a unei programări (dialogul de editare). */
export async function updateAppointmentAction(_prev: ApptState, formData: FormData): Promise<ApptState> {
  const user = await requireUser();
  if (!can(user, "appointments.manage")) return { error: "Fără permisiune." };
  const parsed = quickAppointmentSchema.safeParse({
    clientId: formData.get("clientId") ?? "",
    clientName: formData.get("clientName") ?? "",
    categoryId: formData.get("categoryId") ?? "",
    dateKey: formData.get("dateKey"),
    time: formData.get("time"),
    durationMinutes: formData.get("durationMinutes") ?? 30,
    title: formData.get("title") ?? "",
    message: formData.get("message") ?? "",
    reminderEmail: formData.get("reminderEmail") === "true",
    reminderTelegram: formData.get("reminderTelegram") === "true",
    status: (formData.get("status") as string) || "NEW",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Date invalide." };
  const d = parsed.data;
  const rem = readReminders(formData);

  const res = await updateAppointment(user.id, String(formData.get("id") ?? ""), {
    clientId: d.clientId || undefined,
    clientName: d.clientName || undefined,
    categoryId: d.categoryId || undefined,
    dateKey: d.dateKey,
    time: d.time,
    durationMinutes: d.durationMinutes,
    title: d.title || undefined,
    message: d.message || undefined,
    reminderEmail: d.reminderEmail,
    reminderTelegram: d.reminderTelegram,
    reminderSchedule: rem.schedule,
    reminderIntervalMinutes: rem.interval,
    status: d.status,
    assigneeId: String(formData.get("assigneeId") ?? "") || null,
    place: readPlace(formData),
  });
  if (!res.ok) return { error: res.error };
  revalidateAll();
  return { ok: true };
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

const OID = /^[0-9a-f]{24}$/i;

export async function deleteAppointment(id: string): Promise<ApptState> {
  const user = await requireUser();
  if (!can(user, "appointments.manage")) return { error: "Fără permisiune." };
  if (DEMO) return { error: "Mod demo." };
  if (!OID.test(id ?? "")) return { error: "Programare inexistentă." };
  const owned = await prisma.appointment.findFirst({
    where: { id, userId: user.id },
    select: { id: true, status: true, clientId: true },
  });
  if (!owned) return { error: "Programare inexistentă." };
  await prisma.reminder.deleteMany({ where: { appointmentId: id } });
  await prisma.appointment.delete({ where: { id } });
  // O programare „Nu a venit” ștearsă nu mai trebuie să numere la clientul respectiv.
  if (owned.status === "NO_SHOW") {
    await prisma.client
      .updateMany({ where: { id: owned.clientId, noShowCount: { gt: 0 } }, data: { noShowCount: { decrement: 1 } } })
      .catch(() => {});
  }
  revalidateAll();
  return { ok: true };
}


/** Editare rapidă (celulele din tabelul de programări): descriere și categorie. Data/ora se schimbă prin rescheduleAppointment. */
export async function updateAppointmentFieldAction(
  id: string,
  patch: { title?: string; categoryId?: string | null; message?: string },
): Promise<ApptState> {
  const user = await requireUser();
  if (!can(user, "appointments.manage")) return { error: "Fără permisiune." };
  if (DEMO) return { error: "Mod demo." };
  const OID = /^[0-9a-f]{24}$/i;
  if (!OID.test(id ?? "")) return { error: "Programare invalidă." };
  const owned = await prisma.appointment.findFirst({ where: { id, ...mineWhere(user.id) }, select: { id: true } });
  if (!owned) return { error: "Programare inexistentă." };

  const data: Record<string, unknown> = {};
  if (patch.title !== undefined) data.title = String(patch.title).trim().slice(0, 500);
  if (patch.message !== undefined) data.message = String(patch.message).trim().slice(0, 2000) || null;
  if ("categoryId" in patch) {
    if (patch.categoryId && OID.test(patch.categoryId)) {
      const cat = await prisma.category.findFirst({ where: { id: patch.categoryId }, select: { id: true, name: true, color: true } });
      if (!cat) return { error: "Categorie inexistentă." };
      data.categoryId = cat.id;
      data.categoryNameSnapshot = cat.name;
      data.categoryColorSnapshot = cat.color;
    } else {
      data.categoryId = null;
      data.categoryNameSnapshot = null;
      data.categoryColorSnapshot = null;
    }
  }
  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.appointment.update({ where: { id }, data });
  revalidateAll();
  return { ok: true };
}
