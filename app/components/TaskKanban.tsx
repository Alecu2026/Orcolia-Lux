"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { setTaskStatus } from "@/app/actions/tasks";
import { useToast } from "./toast";
import { useMessages } from "@/lib/i18n/context";

type Opt = { id: string; name: string };
type Status = "NEW" | "ASSIGNED" | "READ" | "IN_PROGRESS" | "ON_HOLD" | "REVIEW" | "DONE" | "CANCELLED";
type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";
type TaskType = "TASK" | "TICKET" | "WORK_ORDER";

type Task = {
  id: string;
  seq: number | null;
  type: TaskType;
  title: string;
  status: Status;
  priority: Priority;
  progress: number;
  dueAt: Date | null;
  assigneeId: string | null;
  assigneeName: string | null;
  teamId: string | null;
  teamName: string | null;
  projectId: string | null;
  projectName: string | null;
  clientId: string | null;
  clientName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
};

const COLUMNS: { status: Status; dot: string }[] = [
  { status: "NEW", dot: "bg-st-new" },
  { status: "ASSIGNED", dot: "bg-st-new" },
  { status: "READ", dot: "bg-st-confirmed" },
  { status: "IN_PROGRESS", dot: "bg-st-progress" },
  { status: "ON_HOLD", dot: "bg-st-noshow" },
  { status: "REVIEW", dot: "bg-st-confirmed" },
  { status: "DONE", dot: "bg-st-done" },
  { status: "CANCELLED", dot: "bg-st-cancelled" },
];
const PRIO_CLR: Record<Priority, string> = {
  LOW: "text-ink-soft",
  MEDIUM: "text-ink-soft",
  HIGH: "text-st-noshow",
  URGENT: "text-st-cancelled",
};

const QUICK_KEYS = ["today", "tomorrow", "week", "month"] as const;

const fldCls = (val: string) =>
  `h-9 appearance-none sel-arrow rounded-lg border pl-2 pr-7 text-xs outline-none focus:border-brand ${
    val
      ? "border-brand bg-brand/10 font-semibold text-brand"
      : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;

function matchesDue(dueAt: Date | null, filter: string): boolean {
  if (!filter) return true;
  if (filter === "none") return dueAt === null;
  if (!dueAt) return false;
  const d = new Date(dueAt);
  const now = new Date();
  if (filter === "overdue") return d < now;

  const s0 = new Date(); s0.setHours(0, 0, 0, 0);
  const e0 = new Date(s0); e0.setDate(e0.getDate() + 1);
  if (filter === "today") return d >= s0 && d < e0;

  const s1 = new Date(s0); s1.setDate(s1.getDate() + 1);
  const e1 = new Date(s1); e1.setDate(e1.getDate() + 1);
  if (filter === "tomorrow") return d >= s1 && d < e1;

  if (filter === "week") {
    const ws = new Date(s0);
    const day = ws.getDay();
    ws.setDate(ws.getDate() - (day === 0 ? 6 : day - 1)); // Monday
    const we = new Date(ws); we.setDate(we.getDate() + 7);
    return d >= ws && d < we;
  }
  if (filter === "month") {
    const ms = new Date(s0); ms.setDate(1);
    const me = new Date(ms); me.setMonth(me.getMonth() + 1);
    return d >= ms && d < me;
  }
  return true;
}

export default function TaskKanban({
  items,
  users,
  teams,
  projects,
  categories = [],
}: {
  items: Task[];
  users: Opt[];
  teams: Opt[];
  projects: Opt[];
  categories?: Opt[];
}) {
  const toast = useToast();
  const m = useMessages();
  const [tasks, setTasks] = useState(items);
  useEffect(() => setTasks(items), [items]);

  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Status | null>(null);

  // Lazy init din localStorage
  const initKanban = () => {
    if (typeof window === "undefined") return {} as Record<string, string>;
    try { return JSON.parse(localStorage.getItem("filters:kanban") ?? "{}") as Record<string, string>; }
    catch { return {}; }
  };
  const [fSearch, setFSearch] = useState(() => initKanban().fSearch ?? "");
  const [fStatus, setFStatus] = useState(() => initKanban().fStatus ?? "");
  const [fType, setFType] = useState(() => initKanban().fType ?? "");
  const [fPriority, setFPriority] = useState(() => initKanban().fPriority ?? "");
  const [fAssignee, setFAssignee] = useState(() => initKanban().fAssignee ?? "");
  const [fTeam, setFTeam] = useState(() => initKanban().fTeam ?? "");
  const [fProject, setFProject] = useState(() => initKanban().fProject ?? "");
  const [fClient, setFClient] = useState(() => initKanban().fClient ?? "");
  const [fDeadline, setFDeadline] = useState(() => initKanban().fDeadline ?? "");
  const [fCategory, setFCategory] = useState(() => initKanban().fCategory ?? "");

  const hasFilters = !!(fSearch || fStatus || fType || fPriority || fAssignee || fTeam || fProject || fClient || fDeadline || fCategory);

  // Salvează în localStorage când se schimbă filtrele
  useEffect(() => {
    try {
      const data = { fSearch, fStatus, fType, fPriority, fAssignee, fTeam, fProject, fClient, fDeadline, fCategory };
      const hasAny = Object.values(data).some(Boolean);
      if (hasAny) localStorage.setItem("filters:kanban", JSON.stringify(data));
      else localStorage.removeItem("filters:kanban");
    } catch {}
  }, [fSearch, fStatus, fType, fPriority, fAssignee, fTeam, fProject, fClient, fDeadline, fCategory]);

  function resetAll() {
    setFSearch(""); setFStatus(""); setFType(""); setFPriority("");
    setFAssignee(""); setFTeam(""); setFProject(""); setFClient(""); setFDeadline(""); setFCategory("");
    try { localStorage.removeItem("filters:kanban"); } catch {}
  }

  const clients = useMemo(() => {
    const seen = new Map<string, string>();
    for (const t of tasks) {
      if (t.clientId && t.clientName && !seen.has(t.clientId)) seen.set(t.clientId, t.clientName);
    }
    return Array.from(seen.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "ro"));
  }, [tasks]);

  const filtered = useMemo(() => {
    const term = fSearch.trim().toLowerCase();
    return tasks.filter((t) => {
      if (fStatus && t.status !== fStatus) return false;
      if (fType && t.type !== fType) return false;
      if (fPriority && t.priority !== fPriority) return false;
      if (fAssignee && t.assigneeId !== fAssignee) return false;
      if (fTeam && t.teamId !== fTeam) return false;
      if (fProject && t.projectId !== fProject) return false;
      if (fClient && t.clientId !== fClient) return false;
      if (fCategory && t.categoryId !== fCategory) return false;
      if (!matchesDue(t.dueAt, fDeadline)) return false;
      if (term && !t.title.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [tasks, fSearch, fStatus, fType, fPriority, fAssignee, fTeam, fProject, fClient, fDeadline, fCategory]);

  const byStatus = useMemo(() => {
    const m = new Map<Status, Task[]>();
    for (const c of COLUMNS) m.set(c.status, []);
    for (const t of filtered) m.get(t.status)?.push(t);
    return m;
  }, [filtered]);

  function move(id: string, status: Status) {
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    const prev = tasks;
    setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, status } : t)));
    setTaskStatus(id, status).then((res) => {
      if (res?.error) { setTasks(prev); toast.error(res.error); }
      else toast.success(`${m.kanban.moved} „${m.status[status]}"`);
    });
  }

  return (
    <>
      {/* Quick filters */}
      <div className="mb-2 flex flex-wrap gap-2">
        {QUICK_KEYS.map((key) => (
          <button
            key={key}
            onClick={() => setFDeadline((v) => (v === key ? "" : key))}
            className={`tap rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              fDeadline === key ? "bg-brand text-white" : "card text-ink-soft"
            }`}
          >
            {m.kanban[key === "today" ? "dueToday" : key === "tomorrow" ? "dueTomorrow" : key === "week" ? "dueThisWeek" : "dueThisMonth"]}
          </button>
        ))}
        {hasFilters && (
          <button
            onClick={resetAll}
            className="tap ml-auto rounded-full border border-[var(--color-line)] px-4 py-1.5 text-sm text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            {m.kanban.clearFilters}
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={fSearch}
          onChange={(e) => setFSearch(e.target.value)}
          placeholder={m.kanban.searchPlaceholder}
          className="h-9 min-w-36 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-brand"
        />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className={fldCls(fStatus)}>
          <option value="">{m.kanban.filterStatus}</option>
          {COLUMNS.map((c) => (
            <option key={c.status} value={c.status}>{m.status[c.status]}</option>
          ))}
        </select>
        <select value={fType} onChange={(e) => setFType(e.target.value)} className={fldCls(fType)}>
          <option value="">{m.kanban.filterType}</option>
          <option value="TASK">{m.tasks.typeTask}</option>
          <option value="TICKET">{m.tasks.typeTicket}</option>
        </select>
        <select value={fPriority} onChange={(e) => setFPriority(e.target.value)} className={fldCls(fPriority)}>
          <option value="">{m.kanban.filterPriority}</option>
          <option value="URGENT">{m.priority.URGENT}</option>
          <option value="HIGH">{m.priority.HIGH}</option>
          <option value="MEDIUM">{m.priority.MEDIUM}</option>
          <option value="LOW">{m.priority.LOW}</option>
        </select>
        <select value={fAssignee} onChange={(e) => setFAssignee(e.target.value)} className={fldCls(fAssignee)}>
          <option value="">{m.kanban.filterPerson}</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
        <select value={fTeam} onChange={(e) => setFTeam(e.target.value)} className={fldCls(fTeam)}>
          <option value="">{m.kanban.filterTeam}</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <select value={fProject} onChange={(e) => setFProject(e.target.value)} className={fldCls(fProject)}>
          <option value="">{m.kanban.filterProject}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {clients.length > 0 && (
          <select value={fClient} onChange={(e) => setFClient(e.target.value)} className={fldCls(fClient)}>
            <option value="">{m.kanban.filterClient}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        {categories.length > 0 && (
          <select value={fCategory} onChange={(e) => setFCategory(e.target.value)} className={fldCls(fCategory)}>
            <option value="">{m.kanban.filterCategory}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        <select value={fDeadline} onChange={(e) => setFDeadline(e.target.value)} className={fldCls(fDeadline)}>
          <option value="">{m.kanban.dueAny}</option>
          <option value="overdue">{m.kanban.dueOverdue}</option>
          <option value="today">{m.kanban.dueToday}</option>
          <option value="tomorrow">{m.kanban.dueTomorrow}</option>
          <option value="week">{m.kanban.dueThisWeek}</option>
          <option value="month">{m.kanban.dueThisMonth}</option>
          <option value="none">{m.kanban.dueNone}</option>
        </select>
      </div>

      {/* Board — overflow wrapper întors cu 180° pe X ca bara de scroll să apară sus */}
      <div className="overflow-x-auto pt-1 [transform:rotateX(180deg)]">
        <div className="flex gap-3 pb-2 [transform:rotateX(180deg)]">
        {COLUMNS.map((col) => {
          const colItems = byStatus.get(col.status) ?? [];
          const isOver = overCol === col.status;
          return (
            <div
              key={col.status}
              className="flex w-64 shrink-0 flex-col"
              onDragOver={(e) => {
                e.preventDefault();
                if (overCol !== col.status) setOverCol(col.status);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget === e.target) setOverCol(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain") || dragId;
                if (id) move(id, col.status);
                setOverCol(null);
                setDragId(null);
              }}
            >
              <div className="mb-2 flex items-center gap-2 px-1">
                <span className={`size-2.5 rounded-full ${col.dot}`} />
                <h3 className="text-sm font-semibold">{m.status[col.status]}</h3>
                <span className="ml-auto rounded-full bg-[var(--color-surface-2)] px-2 text-xs text-ink-soft">
                  {colItems.length}
                </span>
              </div>
              <div
                className={`flex min-h-24 flex-1 flex-col gap-2 rounded-2xl p-2 transition-colors ${
                  isOver ? "bg-brand-soft ring-2 ring-brand" : "bg-[var(--color-surface-2)]/60"
                }`}
              >
                {colItems.map((t) => (
                  <Link
                    key={t.id}
                    href={`/tasks/${t.id}`}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData("text/plain", t.id);
                      e.dataTransfer.effectAllowed = "move";
                      setDragId(t.id);
                    }}
                    onDragEnd={() => { setDragId(null); setOverCol(null); }}
                    className={`card block cursor-grab p-2.5 active:cursor-grabbing hover:opacity-90 ${dragId === t.id ? "opacity-50" : ""}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                      <span className="shrink-0 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-ink-soft">
                        {t.type === "TICKET" ? m.tasks.typeTicket : m.tasks.typeTask}
                      </span>
                    </div>
                    {t.seq != null && (
                      <span className="mt-1 inline-block rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-brand">
                        #{t.seq}
                      </span>
                    )}
                    <p className="mt-1 truncate text-[11px] text-ink-soft">
                      <span className={PRIO_CLR[t.priority]}>{m.priority[t.priority]}</span>
                      {t.projectName && ` · ${t.projectName}`}
                      {(t.assigneeName || t.teamName) && ` · ${t.assigneeName ?? t.teamName}`}
                      {t.progress > 0 && ` · ${t.progress}%`}
                    </p>
                  </Link>
                ))}
                {colItems.length === 0 && <p className="py-3 text-center text-xs text-ink-soft">—</p>}
              </div>
            </div>
          );
        })}
        </div>
      </div>
    </>
  );
}

