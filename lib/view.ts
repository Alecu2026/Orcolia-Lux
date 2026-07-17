import "server-only";
import { formatTime } from "./date";
import type { AppointmentListItem } from "./queries/appointments";
import type { ApptVM } from "@/app/components/types";

/** Mapează o programare din DB în view-model cu orele formatate în fusul userului. */
export function toVM(a: AppointmentListItem, tz: string): ApptVM {
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
    remEmail: a.reminderEmailEnabled,
    remTelegram: a.reminderTelegramEnabled,
  };
}
