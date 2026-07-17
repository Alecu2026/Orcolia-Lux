import "server-only";
import { cache } from "react";
import { prisma } from "../prisma";
import { DEMO, demoSettings } from "../demo";
import { DEFAULT_REMINDER_PRESETS } from "../reminder-presets";

const SETTINGS_SELECT = {
  id: true,
  timezone: true,
  locale: true,
  theme: true,
  workdayStart: true,
  workdayEnd: true,
  slotMinutes: true,
  defaultReminderEmail: true,
  defaultReminderTelegram: true,
  reminderOffsets: true,
  emailFromName: true,
  emailFromAddr: true,
} as const;

export type Settings = {
  id: string;
  timezone: string;
  locale: string;
  theme: string;
  workdayStart: string;
  workdayEnd: string;
  slotMinutes: number;
  defaultReminderEmail: boolean;
  defaultReminderTelegram: boolean;
  reminderOffsets: string[];
  emailFromName: string | null;
  emailFromAddr: string | null;
};

/** Setările userului; le creează cu valori default la prima accesare. Cache per-request. */
export const getSettings = cache(async (userId: string): Promise<Settings> => {
  if (DEMO) return demoSettings;
  const existing = await prisma.appSettings.findUnique({
    where: { userId },
    select: SETTINGS_SELECT,
  });
  // Documente create înainte de câmpul reminderOffsets: Mongo/Prisma nu aplică
  // @default retroactiv pe citire ⇒ vine [] în loc de standardul configurat.
  if (existing) {
    return {
      ...existing,
      reminderOffsets: existing.reminderOffsets.length
        ? existing.reminderOffsets
        : DEFAULT_REMINDER_PRESETS,
    };
  }

  return prisma.appSettings.create({
    data: { userId },
    select: SETTINGS_SELECT,
  });
});

/** Doar fusul orar — folosit des în calcule de dateKey. */
export const getUserTimezone = cache(async (userId: string): Promise<string> => {
  if (DEMO) return demoSettings.timezone;
  const s = await prisma.appSettings.findUnique({
    where: { userId },
    select: { timezone: true },
  });
  return s?.timezone ?? "Europe/Bucharest";
});
