import "server-only";
import { formatTime } from "./date";
import { parseReminderSchedule } from "./reminder-schedule";
import type { AppointmentListItem } from "./queries/appointments";
import type { ApptVM } from "@/app/components/types";

/** Mapează o programare din DB în view-model cu orele formatate în fusul userului. */
export function toVM(a: AppointmentListItem, tz: string, names: Record<string, string> = {}): ApptVM {
  return {
    id: a.id,
    clientId: a.clientId,
    clientName: a.clientNameSnapshot,
    title: a.title,
    status: a.status,
    dateKey: a.dateKey,
    time: formatTime(a.startAt, tz),
    endTime: formatTime(a.endAt, tz),
    categoryName: a.categoryNameSnapshot,
    categoryColor: a.categoryColorSnapshot,
    color: a.color ?? null,
    remEmail: a.reminderEmailEnabled,
    remTelegram: a.reminderTelegramEnabled,
    creatorId: a.userId ?? "",
    creatorName: (a.userId && names[a.userId]) || "",
    assigneeId: a.assigneeId ?? null,
    assigneeName: (a.assigneeId && names[a.assigneeId]) || null,
    categoryId: a.categoryId ?? null,
    durationMinutes: Math.max(1, Math.round((a.endAt.getTime() - a.startAt.getTime()) / 60_000)),
    remSchedule: parseReminderSchedule(a.reminderSchedule, new Date(), tz, { allowBefore: true }) ? JSON.stringify(a.reminderSchedule) : "",
    remInterval: a.reminderIntervalMinutes ?? 0,
    remOffsets: a.reminderOffsets ?? [],
    message: a.message ?? "",
  };
}
