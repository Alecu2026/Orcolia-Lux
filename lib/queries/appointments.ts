import "server-only";
import { prisma } from "../prisma";
import { DEMO, demoAppointments } from "../demo";
import type { AppointmentStatus, Prisma } from "@prisma/client";

export type ApptFilter = {
  search?: string;
  status?: AppointmentStatus;
  categoryId?: string;
};

/** Câmpuri suficiente pentru listări (folosesc snapshot-urile, fără include). */
export const LIST_SELECT = {
  id: true,
  title: true,
  status: true,
  startAt: true,
  endAt: true,
  dateKey: true,
  clientId: true,
  categoryId: true,
  clientNameSnapshot: true,
  categoryNameSnapshot: true,
  categoryColorSnapshot: true,
  color: true,
  reminderEmailEnabled: true,
  reminderTelegramEnabled: true,
  userId: true,
  assigneeId: true,
  reminderOffsets: true,
  reminderSchedule: true,
  reminderIntervalMinutes: true,
  message: true,
} as const;

export type AppointmentListItem = {
  id: string;
  title: string;
  status: AppointmentStatus;
  startAt: Date;
  endAt: Date;
  dateKey: string;
  clientId: string;
  clientNameSnapshot: string;
  categoryNameSnapshot: string | null;
  categoryColorSnapshot: string | null;
  /** Culoarea rândului în liste (hex), aleasă de utilizator. */
  color?: string | null;
  reminderEmailEnabled: boolean;
  reminderTelegramEnabled: boolean;
  message?: string | null;
  categoryId?: string | null;
  /** Cine a creat programarea / pentru cine e (opțional). */
  userId?: string;
  assigneeId?: string | null;
  /** Pragurile fixe vechi (reminder-presets) — cât timp programarea nu are remindere noi. */
  reminderOffsets?: string[];
  /** Reminderele noi, ca la sarcini (JSON din reminder-schedule.ts) sau interval fix în minute. */
  reminderSchedule?: unknown;
  reminderIntervalMinutes?: number | null;
};

/** Programările unui utilizator: cele create de el SAU cele în care e „pentru” (asignat). */
export const mineWhere = (userId: string): Prisma.AppointmentWhereInput => ({ OR: [{ userId }, { assigneeId: userId }] });

const ACTIVE_STATUSES: AppointmentStatus[] = [
  "NEW",
  "CONFIRMED",
  "IN_PROGRESS",
  "DONE",
];

function applyFilter(base: Prisma.AppointmentWhereInput, f: ApptFilter): Prisma.AppointmentWhereInput {
  const w = { ...base };
  if (f.search) w.clientNameSnapshot = { contains: f.search, mode: "insensitive" };
  if (f.status) w.status = f.status;
  if (f.categoryId) w.categoryId = f.categoryId;
  return w;
}

/** Programările unei zile (Azi / Telegram). Query unic pe index userId+dateKey. */
export function listByDateKey(userId: string, dateKey: string, filter: ApptFilter = {}) {
  if (DEMO) {
    return Promise.resolve(demoAppointments().filter((a) => a.dateKey === dateKey));
  }
  return prisma.appointment.findMany({
    where: applyFilter({ ...mineWhere(userId), dateKey }, filter),
    select: LIST_SELECT,
    orderBy: { startAt: "asc" },
  });
}

/** Mai multe zile deodată (săptămână / calendar). */
export function listByDateKeys(userId: string, dateKeys: string[], filter: ApptFilter = {}) {
  if (DEMO) {
    const set = new Set(dateKeys);
    return Promise.resolve(demoAppointments().filter((a) => set.has(a.dateKey)));
  }
  return prisma.appointment.findMany({
    where: applyFilter({ ...mineWhere(userId), dateKey: { in: dateKeys } }, filter),
    select: LIST_SELECT,
    orderBy: { startAt: "asc" },
  });
}

/** TOATE programările unui utilizator (cele mai noi primele) — pentru tabelul din /appointments, filtrat în browser. */
export function listAllForUser(userId: string, limit = 20000) {
  if (DEMO) return Promise.resolve(demoAppointments());
  return prisma.appointment.findMany({
    where: mineWhere(userId),
    select: LIST_SELECT,
    orderBy: { startAt: "desc" },
    take: limit,
  });
}

/** Fereastră pentru Kanban (ex. ultimele zile + următoarele), grupare în UI. */
export function listForKanban(userId: string, dateKeys: string[]) {
  if (DEMO) {
    const set = new Set(dateKeys);
    return Promise.resolve(demoAppointments().filter((a) => set.has(a.dateKey)));
  }
  return prisma.appointment.findMany({
    where: { ...mineWhere(userId), dateKey: { in: dateKeys } },
    select: LIST_SELECT,
    orderBy: { startAt: "asc" },
  });
}

const CAL_SELECT = {
  id: true,
  userId: true,
  clientId: true,
  title: true,
  status: true,
  startAt: true,
  endAt: true,
  clientNameSnapshot: true,
  categoryColorSnapshot: true,
} as const;

export type CalendarAppt = {
  id: string;
  userId: string;
  clientId: string;
  title: string;
  status: AppointmentStatus;
  startAt: Date;
  endAt: Date;
  clientNameSnapshot: string;
  categoryColorSnapshot: string | null;
};

/** Programările dintr-un interval de timp (pentru calendar). userId opțional = toate dacă lipsă. */
export async function apptsBetween(opts: {
  userId?: string;
  clientId?: string;
  from: Date;
  to: Date;
}): Promise<CalendarAppt[]> {
  if (DEMO) return [];
  return prisma.appointment.findMany({
    where: {
      ...(opts.userId ? mineWhere(opts.userId) : {}),
      ...(opts.clientId ? { clientId: opts.clientId } : {}),
      startAt: { gte: opts.from, lt: opts.to },
    },
    select: CAL_SELECT,
    orderBy: { startAt: "asc" },
  });
}

export function getAppointment(userId: string, id: string) {
  if (DEMO) {
    const a = demoAppointments().find((x) => x.id === id) ?? null;
    return Promise.resolve(
      a
        ? { ...a, message: null, categoryId: null, createdFrom: "WEB" as const, createdAt: new Date() }
        : null,
    );
  }
  return prisma.appointment.findFirst({
    where: { id, ...mineWhere(userId) },
    select: {
      ...LIST_SELECT,
      message: true,
      categoryId: true,
      createdFrom: true,
      createdAt: true,
    },
  });
}

/** Următoarea programare activă de acum încolo. */
export async function nextAppointment(userId: string) {
  if (DEMO) {
    const now = Date.now();
    return (
      demoAppointments()
        .filter(
          (a) =>
            a.startAt.getTime() >= now &&
            ["NEW", "CONFIRMED", "IN_PROGRESS"].includes(a.status),
        )
        .sort((x, y) => x.startAt.getTime() - y.startAt.getTime())[0] ?? null
    );
  }
  return prisma.appointment.findFirst({
    where: {
      ...mineWhere(userId),
      startAt: { gte: new Date() },
      status: { in: ["NEW", "CONFIRMED", "IN_PROGRESS"] },
    },
    select: LIST_SELECT,
    orderBy: { startAt: "asc" },
  });
}

/** Numărători pentru dashboard, dintr-un singur groupBy pe zi. */
export async function dayStats(userId: string, dateKey: string) {
  if (DEMO) {
    const items = demoAppointments().filter((a) => a.dateKey === dateKey);
    const count = (s: AppointmentStatus) => items.filter((a) => a.status === s).length;
    return {
      total: items.length,
      confirmed: count("CONFIRMED"),
      inProgress: count("IN_PROGRESS"),
      done: count("DONE"),
      cancelled: count("CANCELLED"),
      noShow: count("NO_SHOW"),
      new: count("NEW"),
    };
  }
  const grouped = await prisma.appointment.groupBy({
    by: ["status"],
    where: { ...mineWhere(userId), dateKey },
    _count: { _all: true },
  });
  const byStatus = Object.fromEntries(
    grouped.map((g) => [g.status, g._count._all]),
  ) as Record<AppointmentStatus, number>;

  const total = grouped.reduce((s, g) => s + g._count._all, 0);
  return {
    total,
    confirmed: byStatus.CONFIRMED ?? 0,
    inProgress: byStatus.IN_PROGRESS ?? 0,
    done: byStatus.DONE ?? 0,
    cancelled: byStatus.CANCELLED ?? 0,
    noShow: byStatus.NO_SHOW ?? 0,
    new: byStatus.NEW ?? 0,
  };
}

/**
 * Verifică dacă intervalul [startAt, endAt) se suprapune cu altă programare activă.
 * Overlap: existent.startAt < newEnd ȘI existent.endAt > newStart.
 */
export async function findOverlapping(
  userId: string,
  startAt: Date,
  endAt: Date,
  excludeId?: string,
  assigneeId?: string | null,
) {
  if (DEMO) return null;
  return prisma.appointment.findFirst({
    where: {
      // ocupat = programare a celui care creează SAU a celui pentru care se face (directorul nu poate fi programat în două locuri)
      OR: [...(mineWhere(userId).OR ?? []), ...(assigneeId ? (mineWhere(assigneeId).OR ?? []) : [])],
      ...(excludeId ? { id: { not: excludeId } } : {}),
      status: { in: ACTIVE_STATUSES },
      startAt: { lt: endAt },
      endAt: { gt: startAt },
    },
    select: {
      id: true,
      startAt: true,
      endAt: true,
      clientNameSnapshot: true,
    },
  });
}
