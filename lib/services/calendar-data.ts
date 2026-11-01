import "server-only";
import type { TaskType } from "@prisma/client";
import { tasksDueBetween } from "../queries/tasks";
import { apptsBetween } from "../queries/appointments";
import { memoQuery } from "../log-count";
import { taskEpoch } from "../task-epoch";
import { apptEpoch, lookupEpoch } from "../lookup-memory";
import { dayBoundsUtc } from "../date";

/**
 * Intrările calendarului (sarcini / cereri cu termen + programări) pentru un interval, ca listă comună sortată după moment. Rezultatul se ține ~20 s în memorie, pe filtrele cerute
 * ȘI pe epocile modificărilor (sarcini, programări, nume): orice scriere pe Task / Appointment / User… îl face să se refacă imediat, iar navigarea înapoi / înainte între
 * aceleași luni nu mai atinge baza de date. Cererile identice simultane împart o singură interogare.
 */
export type CalItem = {
  id: string;
  kind: "TASK" | "TICKET" | "APPT";
  title: string;
  dateAt: Date;
  status: string;
  seq: number | null;
  assigneeName: string | null;
  clientName: string | null;
  color: string | null;
};

export type CalendarArgs = {
  scope: "all" | "mine" | "created";
  userId: string;
  teamIds?: string[];
  viewScope?: string;
  viewTeamIds?: string[];
  viewMemberIds?: string[];
  from: Date;
  to: Date;
  assigneeId?: string;
  teamId?: string;
  projectId?: string;
  clientId?: string;
  categoryId?: string;
  taskTypes: TaskType[];
  showAppts: boolean;
  apptUserId?: string;
  /** Vederea „Lună”: doar câmpurile din puncte / tooltip. */
  lean?: boolean;
};

const TTL_MS = 20_000;

export function getCalendarItems(a: CalendarArgs): Promise<CalItem[]> {
  const key = `calendar|${JSON.stringify(a)}|${taskEpoch()}|${apptEpoch()}|${lookupEpoch()}`;
  return memoQuery(key, TTL_MS, false, async () => {
    const [tasks, appts] = await Promise.all([
      a.taskTypes.length
        ? tasksDueBetween({
            scope: a.scope, userId: a.userId, teamIds: a.teamIds, viewScope: a.viewScope, viewTeamIds: a.viewTeamIds, viewMemberIds: a.viewMemberIds,
            from: a.from, to: a.to, assigneeId: a.assigneeId, teamId: a.teamId, projectId: a.projectId, clientId: a.clientId, categoryId: a.categoryId, types: a.taskTypes, lean: a.lean,
          })
        : [],
      a.showAppts ? apptsBetween({ userId: a.apptUserId, clientId: a.clientId, from: a.from, to: a.to }) : [],
    ]);
    return [
      ...tasks.map((t): CalItem => ({
        id: t.id, kind: t.type as CalItem["kind"], title: t.title, dateAt: t.dueAt, status: t.status, seq: t.seq, assigneeName: t.assigneeName, clientName: null, color: null,
      })),
      ...appts.map((p): CalItem => ({
        id: p.id, kind: "APPT", title: p.title, dateAt: p.startAt, status: p.status, seq: null, assigneeName: null, clientName: p.clientNameSnapshot, color: p.categoryColorSnapshot,
      })),
    ].sort((x, y) => x.dateAt.getTime() - y.dateAt.getTime());
  });
}

/**
 * Împarte intrările (sortate după moment) pe zile într-o singură trecere: limitele zilelor se calculează o dată per zi, nu un formatter de dată per intrare
 * (la mii de intrări, `dateKeyOf` pe fiecare era partea cea mai scumpă).
 */
export function bucketByDay(items: CalItem[], keys: string[], tz: string): Map<string, CalItem[]> {
  const map = new Map<string, CalItem[]>(keys.map((k) => [k, []]));
  const bounds = keys.map((k) => {
    const b = dayBoundsUtc(k, tz);
    return { start: b.start.getTime(), end: b.end.getTime() };
  });
  let d = 0;
  for (const it of items) {
    const t = it.dateAt.getTime();
    while (d < bounds.length && t >= bounds[d].end) d++;
    if (d >= bounds.length) break;
    if (t >= bounds[d].start) map.get(keys[d])!.push(it);
  }
  return map;
}
