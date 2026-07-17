import { Suspense } from "react";
import Link from "next/link";
import { requirePermission } from "@/lib/dal";
import { getUserTimezone } from "@/lib/queries/settings";
import { tasksDueBetween } from "@/lib/queries/tasks";
import { apptsBetween } from "@/lib/queries/appointments";
import { userOptions } from "@/lib/queries/users";
import { teamOptions } from "@/lib/queries/teams";
import { projectOptions } from "@/lib/queries/projects";
import { clientOptions } from "@/lib/queries/clients";
import { listCategories } from "@/lib/queries/categories";
import { todayKey, addDaysToKey, dayBoundsUtc, dateKeyOf } from "@/lib/date";
import CalendarControls from "@/app/components/CalendarControls";
import type { TaskType } from "@prisma/client";

export const dynamic = "force-dynamic";

type View = "month" | "week" | "day";

type CalItem = {
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

const TASK_DOT: Record<string, string> = {
  NEW: "bg-st-new",
  ASSIGNED: "bg-st-new",
  READ: "bg-st-confirmed",
  IN_PROGRESS: "bg-st-progress",
  ON_HOLD: "bg-st-noshow",
  REVIEW: "bg-st-confirmed",
  DONE: "bg-st-done",
  CANCELLED: "bg-st-cancelled",
};
const TASK_ST_RO: Record<string, string> = {
  NEW: "Nou", ASSIGNED: "Asignat", READ: "Citit", IN_PROGRESS: "În lucru",
  ON_HOLD: "În așteptare", REVIEW: "În verificare", DONE: "Finalizat", CANCELLED: "Anulat",
};
const TYPE_BADGE: Record<string, string> = {
  TASK: "Task", TICKET: "Tichet", APPT: "Programare",
};

function dot(item: CalItem) {
  if (item.kind === "APPT") {
    return item.color
      ? <span className="mt-0.5 size-2 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
      : <span className="mt-0.5 size-2 shrink-0 rounded-full bg-[#8b5cf6]" />;
  }
  return <span className={`mt-0.5 size-2 shrink-0 rounded-full ${TASK_DOT[item.status] ?? "bg-ink-soft"}`} />;
}

function CalCard({ item }: { item: CalItem }) {
  const href = item.kind === "APPT" ? "/appointments" : `/tasks/${item.id}`;
  return (
    <Link href={href} prefetch={false} className="card flex items-start gap-1.5 p-1.5 text-[11px] hover:opacity-80">
      {dot(item)}
      <div className="min-w-0 flex-1 overflow-hidden">
        {item.seq != null && (
          <span className="mr-0.5 font-mono text-[10px] font-semibold text-brand">#{item.seq}</span>
        )}
        <span className="truncate">{item.title}</span>
        {item.clientName && <div className="truncate text-ink-soft">{item.clientName}</div>}
      </div>
    </Link>
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requirePermission("tasks.view");
  const tz = await getUserTimezone(user.id);
  const sp = await searchParams;

  const view = (["month", "week", "day"].includes(sp.view ?? "") ? sp.view : "month") as View;
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : todayKey(tz);

  // STAFF vede mereu doar propriile task-uri; ADMIN poate schimba scope din URL
  const scope = (
    user.role === "STAFF"
      ? "mine"
      : ["all", "mine", "created"].includes(sp.scope ?? "") ? sp.scope : "all"
  ) as "all" | "mine" | "created";
  const showTasks = sp.showTasks !== "0";
  const showTickets = sp.showTickets !== "0";
  const showAppts = sp.showAppts !== "0";
  const assigneeId = sp.assigneeId || undefined;
  const teamId = sp.teamId || undefined;
  const projectId = sp.projectId || undefined;
  const clientId = sp.clientId || undefined;
  const categoryId = sp.categoryId || undefined;

  // Date range for the current view
  let from: Date;
  let to: Date;
  let weekKeys: string[] = [];

  const [y, m, d] = anchor.split("-").map(Number);

  if (view === "month") {
    const firstKey = `${y}-${String(m).padStart(2, "0")}-01`;
    const firstDow = (new Date(Date.UTC(y, m - 1, 1, 12)).getUTCDay() + 6) % 7;
    const gridStart = addDaysToKey(firstKey, -firstDow, tz);
    const cells = Array.from({ length: 42 }, (_, i) => addDaysToKey(gridStart, i, tz));
    from = dayBoundsUtc(cells[0], tz).start;
    to = dayBoundsUtc(cells[cells.length - 1], tz).end;
  } else if (view === "week") {
    const dow = (new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 6) % 7;
    const monday = addDaysToKey(anchor, -dow, tz);
    weekKeys = Array.from({ length: 7 }, (_, i) => addDaysToKey(monday, i, tz));
    from = dayBoundsUtc(weekKeys[0], tz).start;
    to = dayBoundsUtc(weekKeys[6], tz).end;
  } else {
    const bounds = dayBoundsUtc(anchor, tz);
    from = bounds.start;
    to = bounds.end;
  }

  // Build task types filter
  const taskTypes: TaskType[] = [];
  if (showTasks) taskTypes.push("TASK");
  if (showTickets) taskTypes.push("TICKET");

  const needTasks = taskTypes.length > 0;

  // Appointment user filter
  const apptUserId = assigneeId ?? (scope === "mine" || scope === "created" ? user.id : undefined);

  const [tasks, appts, users, teams, projects, clients, categories] = await Promise.all([
    needTasks
      ? tasksDueBetween({
          scope,
          userId: user.id,
          teamIds: user.teamIds,
          from,
          to,
          assigneeId,
          teamId,
          projectId,
          clientId,
          categoryId,
          types: taskTypes,
        })
      : [],
    showAppts ? apptsBetween({ userId: apptUserId, clientId, from, to }) : [],
    userOptions(),
    teamOptions(),
    projectOptions(),
    clientOptions(user.id),
    listCategories(),
  ]);

  // Merge into CalItem[]
  const items: CalItem[] = [
    ...tasks.map((t) => ({
      id: t.id,
      kind: t.type as CalItem["kind"],
      title: t.title,
      dateAt: t.dueAt,
      status: t.status,
      seq: t.seq,
      assigneeName: t.assigneeName,
      clientName: null,
      color: null,
    })),
    ...appts.map((a) => ({
      id: a.id,
      kind: "APPT" as const,
      title: a.title,
      dateAt: a.startAt,
      status: a.status,
      seq: null,
      assigneeName: null,
      clientName: a.clientNameSnapshot,
      color: a.categoryColorSnapshot,
    })),
  ].sort((a, b) => a.dateAt.getTime() - b.dateAt.getTime());

  return (
    <div className="w-full">
      <Suspense fallback={<div className="mb-3 h-36 animate-pulse rounded-2xl bg-[var(--color-surface-2)]" />}>
        <CalendarControls
          anchor={anchor}
          view={view}
          tz={tz}
          users={users}
          teams={teams}
          projects={projects}
          clients={clients}
          categories={categories}
        />
      </Suspense>

      {view === "month" && (
        <MonthView anchor={anchor} tz={tz} items={items} />
      )}
      {view === "week" && (
        <WeekView weekKeys={weekKeys} tz={tz} items={items} />
      )}
      {view === "day" && (
        <DayView anchor={anchor} tz={tz} items={items} />
      )}
    </div>
  );
}

function MonthView({ anchor, tz, items }: { anchor: string; tz: string; items: CalItem[] }) {
  const [y, m] = anchor.split("-").map(Number);
  const firstKey = `${y}-${String(m).padStart(2, "0")}-01`;
  const firstDow = (new Date(Date.UTC(y, m - 1, 1, 12)).getUTCDay() + 6) % 7;
  const gridStart = addDaysToKey(firstKey, -firstDow, tz);
  const cells = Array.from({ length: 42 }, (_, i) => addDaysToKey(gridStart, i, tz));
  const today = todayKey(tz);
  const curMonth = `${y}-${String(m).padStart(2, "0")}`;

  const byDay = new Map<string, CalItem[]>();
  for (const item of items) {
    const key = dateKeyOf(item.dateAt, tz);
    const arr = byDay.get(key) ?? [];
    arr.push(item);
    byDay.set(key, arr);
  }

  return (
    <div>
      <div className="mb-1 grid grid-cols-7 text-center text-[11px] font-semibold text-ink-soft">
        {["L", "Ma", "Mi", "J", "V", "S", "D"].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day) => {
          const inMonth = day.slice(0, 7) === curMonth;
          const dayItems = byDay.get(day) ?? [];
          return (
            <Link
              key={day}
              href={`/calendar?view=day&date=${day}`}
              prefetch={false}
              className={`card flex min-h-16 flex-col gap-1 p-1.5 ${inMonth ? "" : "opacity-40"} ${
                day === today ? "ring-2 ring-brand" : ""
              }`}
            >
              <span className={`text-xs tabular-nums ${day === today ? "font-bold text-brand" : "text-ink-soft"}`}>
                {Number(day.slice(8))}
              </span>
              <div className="flex flex-wrap gap-0.5">
                {dayItems.slice(0, 6).map((item) =>
                  item.kind === "APPT" ? (
                    <span
                      key={item.id}
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: item.color ?? "#8b5cf6" }}
                      title={`${item.title} · Programare`}
                    />
                  ) : (
                    <span
                      key={item.id}
                      className={`size-1.5 rounded-full ${TASK_DOT[item.status] ?? "bg-ink-soft"}`}
                      title={`${item.title} · ${TASK_ST_RO[item.status]}`}
                    />
                  )
                )}
              </div>
              {dayItems.length > 0 && (
                <span className="mt-auto text-[10px] font-medium text-ink-soft">{dayItems.length}</span>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ weekKeys, tz, items }: { weekKeys: string[]; tz: string; items: CalItem[] }) {
  const today = todayKey(tz);
  const DAY_NAMES = ["L", "Ma", "Mi", "J", "V", "S", "D"];

  const byDay = new Map<string, CalItem[]>();
  for (const k of weekKeys) byDay.set(k, []);
  for (const item of items) {
    const key = dateKeyOf(item.dateAt, tz);
    byDay.get(key)?.push(item);
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[560px] grid-cols-7 gap-1">
        {weekKeys.map((dayKey, i) => {
          const dayNum = Number(dayKey.slice(8));
          const isToday = dayKey === today;
          const dayItems = byDay.get(dayKey) ?? [];
          return (
            <div
              key={dayKey}
              className={`flex min-h-32 flex-col rounded-xl border p-1.5 ${
                isToday ? "border-brand" : "border-[var(--color-line)]"
              }`}
            >
              <Link
                href={`/calendar?view=day&date=${dayKey}`}
                prefetch={false}
                className={`mb-1.5 flex items-center gap-1 text-xs font-semibold ${
                  isToday ? "text-brand" : "text-ink-soft"
                }`}
              >
                <span>{DAY_NAMES[i]}</span>
                <span
                  className={`ml-auto tabular-nums ${
                    isToday ? "size-5 rounded-full bg-brand text-center text-white leading-5" : ""
                  }`}
                >
                  {dayNum}
                </span>
              </Link>
              <div className="flex flex-col gap-1">
                {dayItems.map((item) => <CalCard key={item.id} item={item} />)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayView({ anchor, tz, items }: { anchor: string; tz: string; items: CalItem[] }) {
  if (items.length === 0) {
    return (
      <div className="card grid place-items-center p-10 text-center text-sm text-ink-soft">
        Nicio intrare în această zi.
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((item) => {
        const href = item.kind === "APPT" ? "/appointments" : `/tasks/${item.id}`;
        return (
          <Link key={item.id} href={href} prefetch={false} className="card flex items-center gap-2.5 px-3 py-2">
            {item.kind === "APPT" ? (
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: item.color ?? "#8b5cf6" }}
              />
            ) : (
              <span className={`size-2.5 shrink-0 rounded-full ${TASK_DOT[item.status] ?? "bg-ink-soft"}`} />
            )}
            <span className="min-w-0 flex-1 truncate text-sm font-medium">
              {item.seq != null && <span className="mr-1 font-mono text-xs text-brand">#{item.seq}</span>}
              {item.title}
            </span>
            <span className="shrink-0 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-ink-soft">
              {TYPE_BADGE[item.kind]}
            </span>
            {(item.assigneeName ?? item.clientName) && (
              <span className="hidden shrink-0 text-[11px] text-ink-soft sm:inline">
                {item.assigneeName ?? item.clientName}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
