import { DEFAULT_TZ, todayKey, addDaysToKey, zonedToUtc } from "./date";
import type { AppointmentListItem } from "./queries/appointments";
import type { ClientListItem } from "./queries/clients";
import type { CategoryLite } from "./queries/categories";
import type { Settings } from "./queries/settings";
import type { CurrentUser } from "./dal";
import type { AppointmentStatus } from "@prisma/client";

/**
 * MOD DEMO: când lipsește baza de date (sau secretul), aplicația rulează cu date
 * de exemplu, fără autentificare și fără scrieri. Adăugând DATABASE_URL +
 * SESSION_SECRET, totul devine automat real.
 */
export const DEMO = !process.env.DATABASE_URL || !process.env.SESSION_SECRET;

export function demoBlock(): { error: string } {
  return { error: "Mod demo: conectează o bază de date pentru a salva modificări." };
}

export const demoUser: CurrentUser = {
  id: "demo-user",
  name: "Cont Demo",
  email: "demo@local",
  role: "ADMIN",
  permissions: [],
  isActive: true,
  isSuperAdmin: true,
  teamIds: [],
};

export const demoSettings: Settings = {
  id: "demo",
  timezone: DEFAULT_TZ,
  locale: "ro",
  theme: "system",
  workdayStart: "09:00",
  workdayEnd: "18:00",
  slotMinutes: 30,
  defaultReminderEmail: false,
  defaultReminderTelegram: true,
  reminderOffsets: ["DAY_BEFORE_8AM", "H3"],
  emailFromName: null,
  emailFromAddr: null,
};

export const demoCategories: CategoryLite[] = [
  { id: "cat-1", name: "Consultație", color: "#6366f1", defaultDurationMinutes: 30 },
  { id: "cat-2", name: "Tuns", color: "#10b981", defaultDurationMinutes: 45 },
  { id: "cat-3", name: "Vopsit", color: "#f59e0b", defaultDurationMinutes: 90 },
];

export const demoClients: ClientListItem[] = [
  { id: "cl-1", name: "Ion Popescu", phone: "0721 111 111", email: "ion@example.com", telegramChatId: null, notes: "Client fidel.", noShowCount: 0, lastAppointmentAt: new Date() },
  { id: "cl-2", name: "Maria Ionescu", phone: "0722 222 222", email: "maria@example.com", telegramChatId: null, notes: null, noShowCount: 1, lastAppointmentAt: new Date() },
  { id: "cl-3", name: "Andrei Vasile", phone: "0733 333 333", email: null, telegramChatId: null, notes: null, noShowCount: 0, lastAppointmentAt: null },
  { id: "cl-4", name: "Elena Dumitru", phone: "0744 444 444", email: "elena@example.com", telegramChatId: null, notes: null, noShowCount: 0, lastAppointmentAt: new Date() },
  { id: "cl-5", name: "George Marin", phone: null, email: null, telegramChatId: null, notes: null, noShowCount: 2, lastAppointmentAt: null },
];

type Seed = {
  offset: number; // zile față de azi
  time: string;
  dur: number;
  client: string;
  cat: 0 | 1 | 2 | null;
  status: AppointmentStatus;
};

const SEEDS: Seed[] = [
  { offset: 0, time: "09:30", dur: 30, client: "Ion Popescu", cat: 0, status: "CONFIRMED" },
  { offset: 0, time: "11:00", dur: 45, client: "Maria Ionescu", cat: 1, status: "NEW" },
  { offset: 0, time: "13:00", dur: 90, client: "Elena Dumitru", cat: 2, status: "IN_PROGRESS" },
  { offset: 0, time: "16:00", dur: 30, client: "Andrei Vasile", cat: 0, status: "DONE" },
  { offset: 1, time: "10:00", dur: 45, client: "George Marin", cat: 1, status: "NEW" },
  { offset: 1, time: "12:30", dur: 30, client: "Ion Popescu", cat: 0, status: "CONFIRMED" },
  { offset: 2, time: "09:00", dur: 90, client: "Maria Ionescu", cat: 2, status: "NEW" },
  { offset: 3, time: "15:00", dur: 30, client: "Elena Dumitru", cat: 0, status: "CANCELLED" },
  { offset: 4, time: "11:30", dur: 45, client: "George Marin", cat: 1, status: "NO_SHOW" },
  { offset: 5, time: "14:00", dur: 30, client: "Andrei Vasile", cat: 0, status: "NEW" },
];

/** Programări demo, recalculate față de ziua curentă. */
export function demoAppointments(): AppointmentListItem[] {
  const today = todayKey(DEFAULT_TZ);
  return SEEDS.map((s, i) => {
    const dateKey = addDaysToKey(today, s.offset, DEFAULT_TZ);
    const startAt = zonedToUtc(dateKey, s.time, DEFAULT_TZ);
    const endAt = new Date(startAt.getTime() + s.dur * 60_000);
    const cat = s.cat === null ? null : demoCategories[s.cat];
    return {
      id: `appt-${i + 1}`,
      title: cat?.name ?? "Programare",
      status: s.status,
      startAt,
      endAt,
      dateKey,
      clientId: "cl-1",
      clientNameSnapshot: s.client,
      categoryNameSnapshot: cat?.name ?? null,
      categoryColorSnapshot: cat?.color ?? null,
      reminderEmailEnabled: false,
      reminderTelegramEnabled: true,
    };
  });
}
