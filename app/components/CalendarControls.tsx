"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { addDaysToKey, todayKey } from "@/lib/date";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { useUrlFilters } from "@/app/hooks/useUrlFilters";
import { useMessages } from "@/lib/i18n/context";

type Opt = { id: string; name: string };

function getWeekBounds(anchor: string, tz: string): { monday: string; sunday: string } {
  const [y, m, d] = anchor.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 6) % 7;
  const monday = addDaysToKey(anchor, -dow, tz);
  const sunday = addDaysToKey(monday, 6, tz);
  return { monday, sunday };
}

function getNavDates(view: string, anchor: string, tz: string): { prev: string; next: string; label: string } {
  const [y, m, d] = anchor.split("-").map(Number);

  if (view === "month") {
    const firstKey = `${y}-${String(m).padStart(2, "0")}-01`;
    const prev = addDaysToKey(firstKey, -1, tz).slice(0, 7) + "-01";
    const next = addDaysToKey(`${y}-${String(m).padStart(2, "0")}-28`, 7, tz).slice(0, 7) + "-01";
    const label = new Intl.DateTimeFormat("ro-RO", { timeZone: tz, month: "long", year: "numeric" })
      .format(new Date(Date.UTC(y, m - 1, 15)));
    return { prev, next, label };
  }

  if (view === "week") {
    const { monday, sunday } = getWeekBounds(anchor, tz);
    const prev = addDaysToKey(monday, -7, tz);
    const next = addDaysToKey(monday, 7, tz);
    const fmt = (k: string) => {
      const [ky, km, kd] = k.split("-").map(Number);
      return new Intl.DateTimeFormat("ro-RO", { timeZone: tz, day: "numeric", month: "short" })
        .format(new Date(Date.UTC(ky, km - 1, kd, 12)));
    };
    const [sy] = sunday.split("-").map(Number);
    const label = `${fmt(monday)} – ${fmt(sunday)} ${sy}`;
    return { prev, next, label };
  }

  // day
  const prev = addDaysToKey(anchor, -1, tz);
  const next = addDaysToKey(anchor, 1, tz);
  const label = new Intl.DateTimeFormat("ro-RO", {
    timeZone: tz, weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
  return { prev, next, label };
}

export default function CalendarControls({
  anchor,
  view,
  tz,
  users,
  teams,
  projects,
  clients,
  categories = [],
}: {
  anchor: string;
  view: string;
  tz: string;
  users: Opt[];
  teams: Opt[];
  projects: Opt[];
  clients: Opt[];
  categories?: Opt[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  const { clearFilters } = useUrlFilters("filters:calendar");
  const m = useMessages();

  function patch(updates: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v); else params.delete(k);
    }
    start(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  const { prev, next, label } = getNavDates(view, anchor, tz);
  const today = todayKey(tz);

  const scope = sp.get("scope") ?? "all";
  const showTasks = (sp.get("showTasks") ?? "1") !== "0";
  const showTickets = (sp.get("showTickets") ?? "1") !== "0";
  const showAppts = (sp.get("showAppts") ?? "1") !== "0";
  const assigneeId = sp.get("assigneeId") ?? "";
  const teamId = sp.get("teamId") ?? "";
  const projectId = sp.get("projectId") ?? "";
  const clientId = sp.get("clientId") ?? "";
  const categoryId = sp.get("categoryId") ?? "";

  const chip = (active: boolean) =>
    `tap rounded-full px-3.5 py-1.5 text-sm font-medium ${active ? "bg-brand text-white" : "card text-ink-soft"}`;
  const fldCls = (val: string) =>
    `h-9 appearance-none sel-arrow rounded-lg border pl-2 pr-7 text-xs outline-none focus:border-brand ${
      val
        ? "border-brand bg-brand/10 font-semibold text-brand"
        : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
    }`;
  const viewTab = (v: string) =>
    `rounded-full px-3.5 py-1.5 text-sm font-medium ${view === v ? "bg-brand text-white" : "text-ink-soft"}`;

  return (
    <div className="mb-3 flex flex-col gap-2">
      {/* Views + Today */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full bg-[var(--color-surface-2)] p-1">
          {(["month", "week", "day"] as const).map((v) => (
            <button key={v} onClick={() => patch({ view: v })} className={viewTab(v)}>
              {v === "month" ? m.calendar.viewMonth : v === "week" ? m.calendar.viewWeek : m.calendar.viewDay}
            </button>
          ))}
        </div>
        <button onClick={() => patch({ date: today })} className="tap card ml-auto rounded-full px-3.5 py-1.5 text-sm">
          {m.calendar.today}
        </button>
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between">
        <button onClick={() => patch({ date: prev })} className="tap card grid size-9 place-items-center rounded-lg" aria-label={m.common.prev}>
          <IconChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-semibold capitalize">{label}</span>
        <button onClick={() => patch({ date: next })} className="tap card grid size-9 place-items-center rounded-lg" aria-label={m.common.next}>
          <IconChevronRight className="size-4" />
        </button>
      </div>

      {/* Scope */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", m.calendar.scopeAll],
            ["mine", m.calendar.scopeMine],
            ["created", m.calendar.scopeCreated],
          ] as [string, string][]
        ).map(([k, lbl]) => (
          <button key={k} onClick={() => patch({ scope: k === "all" ? "" : k })} className={chip(scope === k)}>
            {lbl}
          </button>
        ))}
      </div>
      {/* Type toggles */}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => patch({ showTasks: showTasks ? "0" : "1" })} className={chip(showTasks)}>{m.calendar.typeTask}</button>
        <button onClick={() => patch({ showTickets: showTickets ? "0" : "1" })} className={chip(showTickets)}>{m.calendar.typeTicket}</button>
        <button onClick={() => patch({ showAppts: showAppts ? "0" : "1" })} className={chip(showAppts)}>{m.calendar.typeAppointment}</button>
      </div>

      {/* Dimension filters */}
      <div className="flex flex-wrap gap-2">
        <select value={assigneeId} onChange={(e) => patch({ assigneeId: e.target.value })} className={fldCls(assigneeId)}>
          <option value="">{m.calendar.filterPerson}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={teamId} onChange={(e) => patch({ teamId: e.target.value })} className={fldCls(teamId)}>
          <option value="">{m.calendar.filterTeam}</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select value={projectId} onChange={(e) => patch({ projectId: e.target.value })} className={fldCls(projectId)}>
          <option value="">{m.calendar.filterProject}</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {clients.length > 0 && (
          <select value={clientId} onChange={(e) => patch({ clientId: e.target.value })} className={fldCls(clientId)}>
            <option value="">{m.calendar.filterClient}</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {categories.length > 0 && (
          <select value={categoryId} onChange={(e) => patch({ categoryId: e.target.value })} className={fldCls(categoryId)}>
            <option value="">{m.calendar.filterCategory}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {(assigneeId || teamId || projectId || clientId || categoryId) && (
          <button
            onClick={clearFilters}
            className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
            title={m.calendar.clearAll}
          >
            {m.calendar.clearFilters}
          </button>
        )}
      </div>
    </div>
  );
}
