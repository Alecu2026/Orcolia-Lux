"use server";

import { after } from "next/server";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { NOTIFY_MAX_RECIPIENTS } from "@/lib/payer-notify";
import {
  createSchedule,
  deleteSchedule,
  listClientTargets,
  listSchedules,
  runSchedule,
  sanitizeClientCriteria,
  setScheduleActive,
  type Audience,
  type ScheduleDto,
} from "@/lib/services/notify-schedules";

/**
 * Notificări către clienți și notificări programate (plătitori sau clienți). Toate cer „Notificări plătitori — trimitere” (payers.notify); lista și căutarea clienților, doar vizualizarea
 * plătitorilor. Trimiterea propriu-zisă (acum) rămâne în payer-notifications.ts; programările rulează singure (vezi lib/services/notify-schedules.ts).
 */

async function requireNotifier() {
  const user = await requireUser();
  if (!can(user, "payers.notify")) return { ok: false as const, error: "Fără permisiune de a trimite notificări." };
  if (DEMO) return { ok: false as const, error: "Mod demo: conectează o bază de date." };
  return { ok: true as const, user };
}

export type ClientTargetRow = { id: string; name: string; phone: string | null; email: string | null; flags: number };
export type ClientTargets = { ok: true; rows: ClientTargetRow[]; total: number; truncated: boolean } | { ok: false; error: string };

/** Clienții obișnuiți (fără plătitori) după căutare și contact: o pagină pentru tabel (`pageSize` > 0) sau toți (`pageSize` = 0, cu steagurile de contact), pentru „Selectează toți din filtru”. */
export async function listClientTargetsAction(rawCriteria: unknown, page = 1, pageSize = 50): Promise<ClientTargets> {
  const user = await requireUser();
  if (!can(user, "payers.view") && !can(user, "payers.notify") && !can(user, "clients.view")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: true, rows: [], total: 0, truncated: false };
  const all = await listClientTargets(sanitizeClientCriteria(rawCriteria), NOTIFY_MAX_RECIPIENTS + 1);
  const truncated = all.length > NOTIFY_MAX_RECIPIENTS;
  const list = truncated ? all.slice(0, NOTIFY_MAX_RECIPIENTS) : all;
  if (pageSize <= 0) return { ok: true, rows: list, total: list.length, truncated };
  const size = Math.min(200, Math.max(10, Math.floor(pageSize)));
  const p = Math.max(1, Math.floor(page) || 1);
  return { ok: true, rows: list.slice((p - 1) * size, p * size), total: list.length, truncated };
}

export type CreateScheduleInput = { name: string; audience: Audience; filters: unknown; ids: string[]; message: unknown; schedule: unknown };

export async function createNotifyScheduleAction(input: CreateScheduleInput): Promise<{ ok: true; id: string; nextRunAt: string | null } | { ok: false; error: string }> {
  const auth = await requireNotifier();
  if (!auth.ok) return auth;
  const u = auth.user;
  return createSchedule({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin }, input);
}

export async function listNotifySchedulesAction(): Promise<ScheduleDto[]> {
  const user = await requireUser();
  if (!can(user, "payers.view")) return [];
  if (DEMO) return [];
  return listSchedules();
}

export async function setNotifyScheduleActiveAction(id: string, active: boolean): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireNotifier();
  if (!auth.ok) return auth;
  if (!/^[0-9a-f]{24}$/i.test(id ?? "")) return { ok: false, error: "Programare invalidă." };
  return setScheduleActive(id, active === true);
}

export async function deleteNotifyScheduleAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireNotifier();
  if (!auth.ok) return auth;
  if (!/^[0-9a-f]{24}$/i.test(id ?? "")) return { ok: false, error: "Programare invalidă." };
  await deleteSchedule(id);
  return { ok: true };
}

/** „Rulează acum”: trimite imediat, în fundal (răspunsul pleacă îndată; rezultatul apare în „Ultima rulare” și în Jurnalul de notificări). Nu schimbă următoarea rulare programată. */
export async function runNotifyScheduleNowAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireNotifier();
  if (!auth.ok) return auth;
  if (!/^[0-9a-f]{24}$/i.test(id ?? "")) return { ok: false, error: "Programare invalidă." };
  after(() => runSchedule(id, { manual: true }).then(() => undefined));
  return { ok: true };
}
