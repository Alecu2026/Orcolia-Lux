"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useMessages } from "@/lib/i18n/context";
import Link from "next/link";
import {
  createTaskAction,
  updateTaskAction,
  setTaskStatus,
  setTaskProgress,
  deleteTask,
  getTaskHistory,
  getTaskComments,
  addTaskCommentAction,
  addAttachmentAction,
  listTasksAction,
  type TaskState,
} from "@/app/actions/tasks";
import { dateKeyOf, formatTime } from "@/lib/date";
import { optimizeImage } from "@/lib/image-optimize";
import { useToast } from "./toast";
import { IconTrash, IconX, IconChevronLeft, IconChevronRight, IconPencil } from "./icons";
import CardActionsMenu from "./CardActionsMenu";
import QuickSelect from "./QuickSelect";
import MultiAssignPicker from "./MultiAssignPicker";
import ExportButton from "./ExportButton";
import ImportButton from "./ImportButton";
import TaskAttachmentsPanel from "./TaskAttachmentsPanel";
import { quickCreateProject } from "@/app/actions/projects";
import type { CategoryLite } from "./types";
import type { AssignmentSetting } from "@/lib/services/tasks";

type HistoryRow = {
  id: string;
  fromStatus: Status | null;
  toStatus: Status | null;
  note: string | null;
  createdAt: string | Date;
  userName: string;
};

type CommentRow = {
  id: string;
  body: string;
  source: "WEB" | "TELEGRAM" | "VOICE";
  createdAt: string | Date;
  userName: string;
};

type Opt = { id: string; name: string };
type Status = "NEW" | "ASSIGNED" | "READ" | "IN_PROGRESS" | "ON_HOLD" | "REVIEW" | "DONE" | "CANCELLED";
type Task = {
  id: string;
  seq: number | null;
  type: "TASK" | "TICKET" | "WORK_ORDER";
  title: string;
  status: Status;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  progress: number;
  dueAt: string | Date | null;
  reminderIntervalMinutes: number | null;
  assigneeId: string | null;
  teamId: string | null;
  extraAssigneeIds: string[];
  extraTeamIds: string[];
  assignmentSettingsJson: string | null;
  bypassQuietHours: boolean;
  projectId: string | null;
  clientId: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categoryColor: string | null;
  assigneeName: string | null;
  teamName: string | null;
  projectName: string | null;
  projectLat: number | null;
  projectLng: number | null;
  clientName: string | null;
  creatorName: string;
  createdAt: string | Date;
  description: string | null;
};

const ST: Record<Status, { label: string; dot: string; badge: string }> = {
  NEW:         { label: "Nou",            dot: "bg-st-new",       badge: "bg-st-new/15 text-st-new" },
  ASSIGNED:    { label: "Asignat",        dot: "bg-st-new",       badge: "bg-st-new/15 text-st-new" },
  READ:        { label: "Citit",          dot: "bg-st-confirmed", badge: "bg-st-confirmed/15 text-st-confirmed" },
  IN_PROGRESS: { label: "În lucru",       dot: "bg-st-progress",  badge: "bg-st-progress/15 text-st-progress" },
  ON_HOLD:     { label: "În așteptare",   dot: "bg-st-noshow",    badge: "bg-st-noshow/15 text-st-noshow" },
  REVIEW:      { label: "În verificare",  dot: "bg-st-confirmed", badge: "bg-st-confirmed/15 text-st-confirmed" },
  DONE:        { label: "Finalizat",      dot: "bg-st-done",      badge: "bg-st-done/15 text-st-done" },
  CANCELLED:   { label: "Anulat",         dot: "bg-st-cancelled", badge: "bg-st-cancelled/15 text-st-cancelled" },
};

/** Grupează task-urile după status, păstrând ordinea în care apar primele. */
function groupByStatus(tasks: Task[]): [Status, Task[]][] {
  const order: Status[] = [];
  const map = new Map<Status, Task[]>();
  for (const t of tasks) {
    if (!map.has(t.status)) { map.set(t.status, []); order.push(t.status); }
    map.get(t.status)!.push(t);
  }
  return order.map((s) => [s, map.get(s)!]);
}
const TYPE_RO: Record<string, string> = { TASK: "Task", TICKET: "Tichet", WORK_ORDER: "Task" };
const PRIO_RO = { LOW: "Scăzută", MEDIUM: "Medie", HIGH: "Ridicată", URGENT: "Urgentă" };
const STATUSES: Status[] = ["NEW", "ASSIGNED", "READ", "IN_PROGRESS", "ON_HOLD", "REVIEW", "DONE", "CANCELLED"];
const PROGRESS = [0, 25, 50, 75, 100];
const TZ = "Europe/Bucharest";

/** Formatează dueAt cu ora dacă nu e miezul nopții (00:00) în fusul Romania. */
function fmtDue(dueAt: string | Date): string {
  const d = new Date(dueAt);
  const parts = new Intl.DateTimeFormat("ro-RO", {
    timeZone: TZ,
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const h = get("hour"), m = get("minute");
  const date = `${get("day")}.${get("month")}.${get("year")}`;
  return h === "00" && m === "00" ? date : `${date} ${h}:${m}`;
}

type TaskFilters = {
  q: string; status: string; type: string; assignee: string;
  team: string; proj: string; client: string; prio: string;
  due: string; sort: string; category: string; ps: string;
};

const fldCls = (val: string) =>
  `h-9 appearance-none sel-arrow rounded-lg border pl-2 pr-7 text-xs outline-none focus:border-brand ${
    val
      ? "border-brand bg-brand/10 font-semibold text-brand"
      : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;
const dlgInput =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

export default function TasksManager({
  items,
  hasMore,
  page,
  totalPages,
  scope,
  users,
  teams,
  projects,
  clients = [],
  categories = [],
  filters,
  canCreate,
  canDelete,
  canEdit = false,
  canCreateProject = false,
  quietHoursEnabled = false,
  blobEnabled = false,
  initialCreate,
  initialProjectId,
  initialOpenId,
  scopeOptions,
  basePath = "/tasks",
  createButtons,
}: {
  items: Task[];
  hasMore: boolean;
  page: number;
  totalPages: number;
  scope: string;
  users: Opt[];
  teams: Opt[];
  projects: Opt[];
  clients?: Opt[];
  categories?: CategoryLite[];
  filters: TaskFilters;
  canCreate: boolean;
  canDelete: boolean;
  canEdit?: boolean;
  canCreateProject?: boolean;
  quietHoursEnabled?: boolean;
  blobEnabled?: boolean;
  initialCreate?: "TASK" | "TICKET" | "WORK_ORDER";
  initialProjectId?: string;
  initialOpenId?: string;
  scopeOptions?: { key: string; label: string }[];
  basePath?: string;
  createButtons?: { label: string; type: "TASK" | "TICKET" | "WORK_ORDER" }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const m = useMessages();
  const [navPending, startNav] = useTransition();

  // ── Tipuri fixe per pagină (/tasks → TASK, /tickets → TICKET) ──
  const fixedTypes = basePath === "/tickets" ? ["TICKET"] : basePath === "/tasks" ? ["TASK"] : undefined;

  // ── Filtre client-side (instant, fără navigare) ──────────
  const [localFilters, setLocalFilters] = useState(filters);
  const [localScope, setLocalScope] = useState(scope);
  const [currentPage, setCurrentPage] = useState(page);
  const [totalPagesState, setTotalPagesState] = useState(totalPages);
  const [hasMoreState, setHasMoreState] = useState(hasMore);

  function buildQueryStr(f: TaskFilters, s: string, p: number) {
    const usp = new URLSearchParams();
    if (s !== "mine") usp.set("scope", s);
    for (const k of ["q","status","assignee","team","proj","client","prio","due","sort","category","ps"] as const) {
      if (f[k] && f[k] !== "20") usp.set(k, f[k]);
    }
    if (p > 1) usp.set("page", String(p));
    return usp.toString();
  }

  function applyFilter(patch: Partial<TaskFilters>, newScope?: string, newPage?: number) {
    const f = { ...localFilters, ...patch };
    const s = newScope ?? localScope;
    const p = newPage ?? 1;
    setLocalFilters(f);
    if (newScope !== undefined) setLocalScope(s);
    setCurrentPage(p);
    const qs = buildQueryStr(f, s, p);
    window.history.replaceState(null, "", `${basePath}${qs ? `?${qs}` : ""}`);
    // Persistă în localStorage
    try {
      if (qs) localStorage.setItem(`filters:${basePath}`, qs);
      else localStorage.removeItem(`filters:${basePath}`);
    } catch {}
    startNav(async () => {
      const result = await listTasksAction({ ...f, scope: s, page: p, types: fixedTypes });
      setTasks(result.items);
      setTotalPagesState(result.totalPages);
      setHasMoreState(result.hasMore);
      setCurrentPage(result.page);
    });
  }

  // ── Persistenţă filtre în localStorage ──────────────────
  const storageKey = `filters:${basePath}`;
  useEffect(() => {
    const filtersEmpty = !Object.values(filters).some(Boolean) && scope === "mine";
    if (!filtersEmpty) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const params = new URLSearchParams(saved);
      const f: TaskFilters = {
        q: params.get("q") ?? "", status: params.get("status") ?? "",
        type: params.get("type") ?? "", assignee: params.get("assignee") ?? "",
        team: params.get("team") ?? "", proj: params.get("proj") ?? "",
        client: params.get("client") ?? "", prio: params.get("prio") ?? "",
        due: params.get("due") ?? "", sort: params.get("sort") ?? "",
        category: params.get("category") ?? "", ps: params.get("ps") ?? "",
      };
      const s = (params.get("scope") as "mine"|"all"|"created") ?? "mine";
      setLocalFilters(f);
      setLocalScope(s);
      window.history.replaceState(null, "", `${basePath}?${saved}`);
      startNav(async () => {
        const result = await listTasksAction({ ...f, scope: s, page: 1, types: fixedTypes });
        setTasks(result.items);
        setTotalPagesState(result.totalPages);
        setHasMoreState(result.hasMore);
      });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [createType, setCreateType] = useState<"TASK" | "TICKET" | "WORK_ORDER" | null>(
    initialCreate ?? null,
  );
  const [tasks, setTasks] = useState(items);
  useEffect(() => setTasks(items), [items]);

  const [editTask, setEditTask] = useState<Task | null>(null);

  const [statusPending, setStatusPending] = useState<string | null>(null);
  const [progressPending, setProgressPending] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [filesOpenId, setFilesOpenId] = useState<string | null>(null);
  useEffect(() => {
    if (initialOpenId) {
      getTaskHistory(initialOpenId)
        .then((rows) => setHistory((h) => ({ ...h, [initialOpenId]: rows as HistoryRow[] })))
        .catch(() => {});
      getTaskComments(initialOpenId)
        .then((rows) => setComments((c) => ({ ...c, [initialOpenId]: rows as CommentRow[] })))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [history, setHistory] = useState<Record<string, HistoryRow[]>>({});
  const [loadingHist, setLoadingHist] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, CommentRow[]>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [postingComment, setPostingComment] = useState<string | null>(null);

  function toggleHistory(id: string) {
    if (openId === id) { setOpenId(null); return; }
    setOpenId(id);
    if (!history[id]) {
      setLoadingHist(id);
      getTaskHistory(id)
        .then((rows) => setHistory((h) => ({ ...h, [id]: rows as HistoryRow[] })))
        .catch(() => toast.error(m.tasks.historyLoadError))
        .finally(() => setLoadingHist((cur) => (cur === id ? null : cur)));
    }
    if (!comments[id]) {
      getTaskComments(id)
        .then((rows) => setComments((c) => ({ ...c, [id]: rows as CommentRow[] })))
        .catch(() => {});
    }
  }

  function postComment(id: string) {
    const body = (commentDraft[id] ?? "").trim();
    if (!body) return;
    setPostingComment(id);
    addTaskCommentAction(id, body)
      .then((res) => {
        if (res?.error) { toast.error(res.error); return; }
        setCommentDraft((d) => ({ ...d, [id]: "" }));
        getTaskComments(id).then((rows) => setComments((c) => ({ ...c, [id]: rows as CommentRow[] })));
        toast.success(m.tasks.commentAdded);
      })
      .finally(() => setPostingComment((cur) => (cur === id ? null : cur)));
  }

  const [searchInput, setSearchInput] = useState(localFilters.q);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(val: string) {
    setSearchInput(val);
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => applyFilter({ q: val }), 350);
  }

  function changeStatus(id: string, next: Status) {
    const prev = tasks;
    setStatusPending(id);
    setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, status: next } : t)));
    setTaskStatus(id, next).then((res) => {
      if (res?.error) { setTasks(prev); toast.error(res.error); }
      else {
        toast.success(`Status: ${m.status[next]}`);
        setHistory((h) => { if (!h[id]) return h; const { [id]: _, ...rest } = h; return rest; });
        if (openId === id) {
          getTaskHistory(id).then((rows) => setHistory((hh) => ({ ...hh, [id]: rows as HistoryRow[] }))).catch(() => {});
        }
      }
    }).finally(() => setStatusPending((cur) => (cur === id ? null : cur)));
  }

  function changeProgress(id: string, progress: number) {
    const prev = tasks;
    setProgressPending(id);
    setTasks((cur) => cur.map((t) => (t.id === id ? { ...t, progress } : t)));
    setTaskProgress(id, progress).then((res) => {
      if (res?.error) { setTasks(prev); toast.error(res.error); }
      else toast.success(`Progres: ${progress}%`);
    }).finally(() => setProgressPending((cur) => (cur === id ? null : cur)));
  }

  function remove(id: string) {
    if (!confirm(m.tasks.deleteConfirm)) return;
    const prev = tasks;
    setTasks((cur) => cur.filter((t) => t.id !== id));
    deleteTask(id).then(() => toast.success(m.tasks.deleted)).catch(() => { setTasks(prev); toast.error(m.tasks.deleteFailed); });
  }

  const activeFilters = Boolean(
    localFilters.status || localFilters.type || localFilters.assignee || localFilters.team ||
    localFilters.proj || localFilters.client || localFilters.prio || localFilters.due ||
    localFilters.q || localFilters.category || localFilters.sort,
  );

  const pageButtons = buildPageButtons(currentPage, totalPagesState);

  return (
    <>
      {scopeOptions && scopeOptions.length > 0 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
          {scopeOptions.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => applyFilter({}, s.key, 1)}
              className={`tap shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${
                localScope === s.key ? "bg-brand text-white" : "card text-ink-soft"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Filtre ─────────────────────────────────────────── */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); if (searchDebounce.current) clearTimeout(searchDebounce.current); applyFilter({ q: searchInput }); }}
          className="flex min-w-40 flex-1 items-center"
        >
          <input
            value={searchInput}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={m.tasks.searchPlaceholder}
            className="h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-brand"
          />
        </form>

        <select value={localFilters.status} onChange={(e) => applyFilter({ status: e.target.value })} className={fldCls(localFilters.status)}>
          <option value="">{m.tasks.filterStatus}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{m.status[s]}</option>)}
        </select>

        <select value={localFilters.assignee} onChange={(e) => applyFilter({ assignee: e.target.value })} className={fldCls(localFilters.assignee)}>
          <option value="">{m.tasks.filterPerson}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>

        <select value={localFilters.team} onChange={(e) => applyFilter({ team: e.target.value })} className={fldCls(localFilters.team)}>
          <option value="">{m.tasks.filterTeam}</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <select value={localFilters.proj} onChange={(e) => applyFilter({ proj: e.target.value })} className={fldCls(localFilters.proj)}>
          <option value="">{m.tasks.filterProject}</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>

        <select value={localFilters.client} onChange={(e) => applyFilter({ client: e.target.value })} className={fldCls(localFilters.client)}>
          <option value="">{m.tasks.filterClient}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {categories && categories.length > 0 && (
          <select value={localFilters.category} onChange={(e) => applyFilter({ category: e.target.value })} className={fldCls(localFilters.category)}>
            <option value="">{m.tasks.filterCategory}</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}

        <select value={localFilters.prio} onChange={(e) => applyFilter({ prio: e.target.value })} className={fldCls(localFilters.prio)}>
          <option value="">{m.tasks.filterPriority}</option>
          <option value="LOW">{m.priority.LOW}</option>
          <option value="MEDIUM">{m.priority.MEDIUM}</option>
          <option value="HIGH">{m.priority.HIGH}</option>
          <option value="URGENT">{m.priority.URGENT}</option>
        </select>

        <select value={localFilters.due} onChange={(e) => applyFilter({ due: e.target.value })} className={fldCls(localFilters.due)}>
          <option value="">{m.tasks.filterDue}</option>
          <option value="overdue">{m.tasks.filterDueOverdue}</option>
          <option value="today">{m.tasks.filterDueToday}</option>
          <option value="tomorrow">{m.tasks.filterDueTomorrow}</option>
          <option value="week">{m.tasks.filterDueWeek}</option>
          <option value="month">{m.tasks.filterDueMonth}</option>
        </select>

        <select value={localFilters.sort} onChange={(e) => applyFilter({ sort: e.target.value })} className={fldCls(localFilters.sort)}>
          <option value="">{m.tasks.sortDefault}</option>
          <option value="dueAsc">{m.tasks.sortDueAsc}</option>
          <option value="dueDesc">{m.tasks.sortDueDesc}</option>
        </select>

        {activeFilters && (
          <button
            onClick={() => {
              try { localStorage.removeItem(storageKey); } catch {}
              const emptyFilters: TaskFilters = { q:"", status:"", type:"", assignee:"", team:"", proj:"", client:"", prio:"", due:"", sort:"", category:"", ps:"" };
              setLocalFilters(emptyFilters);
              setSearchInput("");
              applyFilter(emptyFilters, localScope, 1);
            }}
            className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            {m.tasks.clearFilters}
          </button>
        )}
        <ExportButton
          entity={basePath === "/tickets" ? "tickets" : "tasks"}
          params={{
            scope: localScope !== "mine" ? localScope : undefined,
            q: localFilters.q || undefined,
            status: localFilters.status || undefined,
            prio: localFilters.prio || undefined,
            assignee: localFilters.assignee || undefined,
            team: localFilters.team || undefined,
            proj: localFilters.proj || undefined,
            client: localFilters.client || undefined,
            due: localFilters.due || undefined,
            sort: localFilters.sort || undefined,
            category: localFilters.category || undefined,
          }}
          className="tap h-9 shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
        />
        <ImportButton
          entity={basePath === "/tickets" ? "tickets" : "tasks"}
          className="tap h-9 shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
        />
      </div>

      {canCreate && createButtons && createButtons.length > 0 && (
        <div className="mb-3 flex gap-2">
          {createButtons.map((btn) => (
            <button
              key={btn.type}
              onClick={() => setCreateType(btn.type)}
              className={`tap h-10 flex-1 rounded-xl text-sm font-semibold ${
                btn.type === "TASK"
                  ? "bg-brand text-white hover:bg-brand-strong"
                  : "bg-[var(--color-surface-2)] hover:bg-brand-soft"
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}

      {navPending && (
        <div className="mb-2 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />
      )}

      {tasks.length === 0 ? (
        <div className="card grid place-items-center p-8 text-center text-sm text-ink-soft">
          {activeFilters ? m.tasks.noResults : m.tasks.noTasks}
        </div>
      ) : (
        <div className={`flex flex-col gap-0 transition-opacity duration-200 ${navPending ? "pointer-events-none opacity-50" : ""}`}>
          {groupByStatus(tasks).map(([status, group]) => (
            <div key={status} className="mb-3">
              {/* ── Header grup status ─────────────────────── */}
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold ${ST[status].badge}`}>
                  <span className={`size-2 rounded-full ${ST[status].dot}`} />
                  {m.status[status].toUpperCase()}
                </span>
                <span className="text-xs text-ink-soft">{group.length}</span>
              </div>
              <div className="flex flex-col gap-1.5">
          {group.map((t) => (
            <div key={t.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2 sm:flex-nowrap">
                <button
                  type="button"
                  onClick={() => toggleHistory(t.id)}
                  className="min-w-0 basis-full text-left sm:basis-0 sm:flex-1"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    {t.seq != null && (
                      <Link
                        href={`/${t.type === "TICKET" ? "tickets" : "tasks"}/${t.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-brand hover:bg-brand/20"
                      >
                        #{t.seq}
                      </Link>
                    )}
                    <span className="min-w-0 truncate text-sm font-medium">{t.title}</span>
                    <span className="hidden shrink-0 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-ink-soft sm:inline">
                      {t.type === "TICKET" ? m.tasks.typeTicket : m.tasks.typeTask}
                    </span>
                    <IconChevronRight
                      className={`size-3.5 shrink-0 text-ink-soft transition-transform ${openId === t.id ? "rotate-90" : ""}`}
                    />
                  </div>
                  <p className="flex flex-wrap items-center gap-x-1 truncate text-[11px] text-ink-soft">
                    {m.priority[t.priority]}
                    {t.projectName && ` · ${t.projectName}`}
                    {(t.assigneeName || t.teamName) && ` · ${t.assigneeName ?? t.teamName}`}
                    {t.dueAt && ` · ${fmtDue(t.dueAt)}`}
                    {t.progress > 0 && ` · ${t.progress}%`}
                    {t.categoryName && (
                      <span className="inline-flex items-center gap-1">
                        {" · "}
                        <span className="size-1.5 rounded-full" style={{ background: t.categoryColor ?? "#6366f1" }} />
                        {t.categoryName}
                      </span>
                    )}
                  </p>
                </button>

                <div className="flex flex-1 items-center justify-between gap-2 sm:flex-none sm:justify-end">
                  <StatusDropdown
                    status={t.status}
                    pending={statusPending === t.id}
                    onChange={(s) => changeStatus(t.id, s)}
                  />

                  <div className="flex items-center gap-2">
                    <select
                      value={t.progress}
                      onChange={(e) => changeProgress(t.id, Number(e.target.value))}
                      disabled={progressPending === t.id}
                      title="Progres"
                      className="hidden h-8 w-16 shrink-0 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-1 text-[11px] outline-none focus:border-brand disabled:opacity-50 sm:block"
                    >
                      {PROGRESS.map((p) => <option key={p} value={p}>{p}%</option>)}
                    </select>
                    <button
                      onClick={() => setFilesOpenId((id) => id === t.id ? null : t.id)}
                      className={`tap hidden size-8 shrink-0 place-items-center rounded-lg border text-sm sm:grid ${filesOpenId === t.id ? "border-brand bg-brand/10 text-brand" : "border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
                      title={m.tasks.attachmentsTitle}
                    >
                      📎
                    </button>
                    {canEdit && (
                      <button onClick={() => setEditTask(t)} className="tap hidden size-8 shrink-0 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] sm:grid" title={m.common.edit}>
                        <IconPencil className="size-3.5" />
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => remove(t.id)} className="tap hidden size-8 shrink-0 place-items-center rounded-lg border border-[var(--color-line)] text-st-cancelled hover:bg-[var(--color-surface-2)] sm:grid" title={m.common.delete}>
                        <IconTrash className="size-3.5" />
                      </button>
                    )}
                    <CardActionsMenu
                      className="sm:hidden"
                      items={[
                        {
                          key: "files",
                          label: m.tasks.attachmentsTitle,
                          icon: <span className="text-sm">📎</span>,
                          onClick: () => setFilesOpenId((id) => (id === t.id ? null : t.id)),
                        },
                        ...(canEdit
                          ? [{ key: "edit", label: m.common.edit, icon: <IconPencil className="size-3.5" />, onClick: () => setEditTask(t) }]
                          : []),
                        ...(canDelete
                          ? [{ key: "delete", label: m.common.delete, icon: <IconTrash className="size-3.5" />, onClick: () => remove(t.id), danger: true }]
                          : []),
                      ]}
                    />
                  </div>
                </div>
              </div>
              {openId === t.id && (
                <>
                  {t.description && (
                    <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)]/40 px-3 py-2.5">
                      <p className="mb-1 text-[11px] font-semibold text-ink-soft">{m.tasks.descriptionLabel}</p>
                      <p className="whitespace-pre-wrap text-[12px]">{t.description}</p>
                    </div>
                  )}
                  {t.projectLat != null && t.projectLng != null && (
                    <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)]/40 px-3 py-2.5">
                      <p className="mb-1.5 text-[11px] font-semibold text-ink-soft">{m.tasks.locationLabel}</p>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={`https://www.google.com/maps?q=${t.projectLat},${t.projectLng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 text-[11px] font-medium text-ink hover:bg-[var(--color-surface-2)]"
                        >
                          🗺 Google Maps
                        </a>
                        <a
                          href={`https://waze.com/ul?ll=${t.projectLat},${t.projectLng}&navigate=yes`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 text-[11px] font-medium text-ink hover:bg-[var(--color-surface-2)]"
                        >
                          🚗 Waze
                        </a>
                        <a
                          href={`https://maps.apple.com/?ll=${t.projectLat},${t.projectLng}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 text-[11px] font-medium text-ink hover:bg-[var(--color-surface-2)]"
                        >
                          🍎 Apple Maps
                        </a>
                      </div>
                    </div>
                  )}
                  <Timeline rows={history[t.id]} loading={loadingHist === t.id} createdAt={t.createdAt} creatorName={t.creatorName} />
                  <Comments
                    rows={comments[t.id]}
                    draft={commentDraft[t.id] ?? ""}
                    posting={postingComment === t.id}
                    onDraftChange={(v) => setCommentDraft((d) => ({ ...d, [t.id]: v }))}
                    onSubmit={() => postComment(t.id)}
                  />
                </>
              )}
              {filesOpenId === t.id && (
                <TaskAttachmentsPanel taskId={t.id} projectName={t.projectName} />
              )}
            </div>
          ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Paginare numerică ──────────────────────────────── */}
      {(totalPagesState > 1 || localFilters.ps) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1">
          <button
            disabled={currentPage <= 1}
            onClick={() => applyFilter({}, undefined, currentPage - 1)}
            className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={m.common.prev}
          >
            <IconChevronLeft className="size-4" />
          </button>
          {pageButtons.map((b, i) =>
            b === "…" ? (
              <span key={`ellipsis-${i}`} className="flex h-9 w-6 items-center justify-center text-sm text-ink-soft">…</span>
            ) : (
              <button
                key={b}
                onClick={() => applyFilter({}, undefined, Number(b))}
                className={`tap h-9 min-w-[36px] rounded-lg px-2.5 text-sm font-medium ${
                  Number(b) === currentPage
                    ? "bg-brand text-white"
                    : "border border-[var(--color-line)] text-ink hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {b}
              </button>
            ),
          )}
          <button
            disabled={!hasMoreState}
            onClick={() => applyFilter({}, undefined, currentPage + 1)}
            className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={m.common.next}
          >
            <IconChevronRight className="size-4" />
          </button>
          <select
            value={localFilters.ps || "20"}
            onChange={(e) => applyFilter({ ps: e.target.value === "20" ? "" : e.target.value }, undefined, 1)}
            className="ml-2 h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-xs outline-none focus:border-brand"
            title={m.tasks.perPage}
          >
            <option value="20">20 / pag.</option>
            <option value="50">50 / pag.</option>
            <option value="100">100 / pag.</option>
            <option value="200">200 / pag.</option>
            <option value="500">500 / pag.</option>
            <option value="1000">1000 / pag.</option>
            <option value="all">{m.common.allPages}</option>
          </select>
        </div>
      )}

      {createType && (
        <CreateDialog
          initialType={createType}
          users={users}
          teams={teams}
          projects={projects}
          clients={clients}
          categories={categories}
          canCreateProject={canCreateProject}
          quietHoursEnabled={quietHoursEnabled}
          blobEnabled={blobEnabled}
          initialProjectId={initialProjectId}
          onClose={() => setCreateType(null)}
          onCreated={() => router.refresh()}
        />
      )}
      {editTask && (
        <EditDialog
          task={editTask}
          users={users}
          teams={teams}
          projects={projects}
          clients={clients}
          categories={categories}
          quietHoursEnabled={quietHoursEnabled}
          onClose={() => setEditTask(null)}
          onSaved={(updated) => {
            setTasks((cur) => cur.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
            setEditTask(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function StatusDropdown({
  status,
  pending,
  onChange,
}: {
  status: Status;
  pending: boolean;
  onChange: (s: Status) => void;
}) {
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, minWidth: 0 });
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    function close() { setOpen(false); }
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  function handleOpen(e: React.MouseEvent) {
    e.stopPropagation();
    const rect = btnRef.current?.getBoundingClientRect();
    if (rect) {
      setPos({
        top: rect.bottom + 4,
        left: rect.left,
        minWidth: Math.max(rect.width, 144),
      });
    }
    setOpen((o) => !o);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={pending}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleOpen}
        className={`h-7 shrink-0 rounded-full px-2.5 text-[11px] font-semibold transition-opacity disabled:opacity-50 ${ST[status].badge}`}
      >
        {m.status[status]}
      </button>
      {open && mounted && createPortal(
        <div
          style={{ position: "fixed", top: pos.top, left: pos.left, minWidth: pos.minWidth, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}
          className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-xl"
        >
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={(e) => { e.stopPropagation(); onChange(s); setOpen(false); }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12px] font-medium hover:bg-[var(--color-surface-2)] ${s === status ? "font-bold" : ""}`}
            >
              <span className={`size-2 shrink-0 rounded-full ${ST[s].dot}`} />
              <span className={s === status ? "text-ink" : "text-ink-soft"}>{m.status[s]}</span>
              {s === status && <span className="ml-auto text-[10px] text-brand">✓</span>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

/** Generează lista de butoane de paginare cu „…" pentru spații mari. */
function buildPageButtons(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>();
  pages.add(1);
  pages.add(total);
  for (let i = Math.max(2, current - 2); i <= Math.min(total - 1, current + 2); i++) pages.add(i);
  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | "…")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push("…");
    result.push(sorted[i]);
  }
  return result;
}

function Timeline({
  rows, loading, createdAt, creatorName,
}: {
  rows: HistoryRow[] | undefined;
  loading: boolean;
  createdAt: string | Date;
  creatorName: string;
}) {
  const m = useMessages();
  const fmt = (d: string | Date) => new Date(d).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" });
  return (
    <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)]/40 px-3 py-2.5">
      {loading && !rows ? (
        <p className="text-[11px] text-ink-soft">{m.tasks.historyLoading}</p>
      ) : (
        <ol className="flex flex-col gap-2">
          <li className="flex items-start gap-2.5">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-st-new" />
            <div className="min-w-0 text-[11px]">
              <span className="font-medium">{m.common.created}</span>
              <span className="text-ink-soft"> · {creatorName} · {fmt(createdAt)}</span>
            </div>
          </li>
          {(rows ?? []).filter((r) => r.toStatus).map((r) => (
            <li key={r.id} className="flex items-start gap-2.5">
              <span className={`mt-1 size-2 shrink-0 rounded-full ${ST[r.toStatus!]?.dot ?? "bg-st-new"}`} />
              <div className="min-w-0 text-[11px]">
                <span className="font-medium">
                  {r.fromStatus ? `${m.status[r.fromStatus] ?? r.fromStatus} → ` : ""}
                  {m.status[r.toStatus!] ?? r.toStatus}
                </span>
                <span className="text-ink-soft"> · {r.userName} · {fmt(r.createdAt)}</span>
                {r.note && <span className="text-ink-soft"> · {r.note}</span>}
              </div>
            </li>
          ))}
          {rows && rows.length === 0 && (
            <li className="text-[11px] text-ink-soft">{m.tasks.historyEmpty}</li>
          )}
        </ol>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<CommentRow["source"], string> = {
  WEB: "", TELEGRAM: " · via Telegram", VOICE: " · din voce",
};

function Comments({
  rows, draft, posting, onDraftChange, onSubmit,
}: {
  rows: CommentRow[] | undefined;
  draft: string;
  posting: boolean;
  onDraftChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const m = useMessages();
  const fmt = (d: string | Date) => new Date(d).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" });
  return (
    <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)]/40 px-3 py-2.5">
      <p className="mb-2 text-[11px] font-semibold text-ink-soft">{m.tasks.commentSection}</p>
      <div className="mb-2 flex flex-col gap-2">
        {rows === undefined ? (
          <p className="text-[11px] text-ink-soft">{m.common.loading}</p>
        ) : rows.length === 0 ? (
          <p className="text-[11px] text-ink-soft">{m.tasks.commentEmpty}</p>
        ) : (
          rows.map((c) => (
            <div key={c.id} className="text-[11px]">
              <span className="font-medium">{c.userName}</span>
              <span className="text-ink-soft"> · {fmt(c.createdAt)}{SOURCE_LABEL[c.source]}</span>
              <p className="mt-0.5 whitespace-pre-wrap">{c.body}</p>
            </div>
          ))
        )}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="flex items-end gap-2">
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder={m.tasks.commentPlaceholder}
          rows={1}
          className="min-w-0 flex-1 resize-none rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12px] outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={posting || !draft.trim()}
          className="tap h-8 shrink-0 rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
        >
          {posting ? "…" : m.tasks.commentSubmit}
        </button>
      </form>
    </div>
  );
}

function CategoryChips({
  categories,
  value,
  onChange,
}: {
  categories: CategoryLite[];
  value: string;
  onChange: (id: string) => void;
}) {
  const m = useMessages();
  if (categories.length === 0) return null;
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold text-ink-soft">{m.tasks.categoryLabel}</label>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange("")}
          className={`h-7 rounded-full px-3 text-xs font-medium border transition-colors ${
            !value
              ? "border-brand bg-brand text-white"
              : "border-[var(--color-line)] text-ink-soft hover:border-brand"
          }`}
        >
          {m.tasks.noCategory}
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onChange(c.id)}
            className={`inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium border transition-colors ${
              value === c.id
                ? "border-brand bg-brand/10 text-brand"
                : "border-[var(--color-line)] text-ink-soft hover:border-brand"
            }`}
          >
            <span className="size-2 rounded-full" style={{ background: c.color }} />
            {c.name}
          </button>
        ))}
      </div>
      <input type="hidden" name="categoryId" value={value} />
    </div>
  );
}

function EditDialog({
  task, users, teams, projects, clients, categories, quietHoursEnabled, onClose, onSaved,
}: {
  task: Task;
  users: Opt[];
  teams: Opt[];
  projects: Opt[];
  clients: Opt[];
  categories: CategoryLite[];
  quietHoursEnabled?: boolean;
  onClose: () => void;
  onSaved: (updated: Partial<Task> & { id: string }) => void;
}) {
  const toast = useToast();
  const m = useMessages();
  const [state, action, pending] = useActionState<TaskState, FormData>(updateTaskAction, undefined);
  const [categoryId, setCategoryId] = useState(task.categoryId ?? "");
  const [description, setDescription] = useState(task.description ?? "");
  const [title, setTitle] = useState(task.title);
  useEffect(() => {
    if (state?.ok) {
      toast.success(m.tasks.saved);
      onSaved({ id: task.id, title, description: description || null });
    } else if (state?.error) {
      toast.error(state.error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const dueDate = task.dueAt ? dateKeyOf(new Date(task.dueAt), TZ) : "";
  const dueTimeRaw = task.dueAt ? formatTime(new Date(task.dueAt), TZ) : "";
  const dueTime = dueTimeRaw !== "00:00" ? dueTimeRaw : "";
  const seqLabel = task.seq != null ? ` #${task.seq}` : "";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{m.tasks.editTitle}{seqLabel}</h2>
          <button onClick={onClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>
        <form action={action} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={task.id} />
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Titlu *"
            required
            autoFocus
            className={dlgInput}
          />
          <textarea
            name="description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Descriere"
            rows={3}
            className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand"
          />
          <select name="priority" defaultValue={task.priority} className={dlgInput}>
            <option value="LOW">{m.priority.LOW}</option>
            <option value="MEDIUM">{m.priority.MEDIUM}</option>
            <option value="HIGH">{m.priority.HIGH}</option>
            <option value="URGENT">{m.priority.URGENT}</option>
          </select>
          <select name="projectId" defaultValue={task.projectId ?? ""} className={dlgInput}>
            <option value="">{m.tasks.noProjectEdit}</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {clients.length > 0 && (
            <select name="clientId" defaultValue={task.clientId ?? ""} className={dlgInput}>
              <option value="">{m.tasks.noClient}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <MultiAssignPicker
            users={users}
            teams={teams}
            initialAssigneeIds={[
              ...(task.assigneeId ? [task.assigneeId] : []),
              ...(task.extraAssigneeIds ?? []),
            ]}
            initialTeamIds={[
              ...(task.teamId ? [task.teamId] : []),
              ...(task.extraTeamIds ?? []),
            ]}
            initialSettings={task.assignmentSettingsJson ? (JSON.parse(task.assignmentSettingsJson) as AssignmentSetting[]) : []}
          />
          <CategoryChips categories={categories} value={categoryId} onChange={setCategoryId} />
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.tasks.dueDate}</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <input type="date" name="dueDate" defaultValue={dueDate} className={dlgInput} />
              <input type="time" name="dueTime" defaultValue={dueTime} placeholder={m.tasks.dueTime} className={dlgInput} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.tasks.reminderLabel}</label>
            <select name="reminderIntervalMinutes" defaultValue={task.reminderIntervalMinutes ?? 0} className={dlgInput}>
              <option value={0}>{m.tasks.reminderNever}</option>
              <option value={10}>{m.tasks.reminder10m}</option>
              <option value={30}>{m.tasks.reminder30m}</option>
              <option value={60}>{m.tasks.reminder1h}</option>
              <option value={180}>{m.tasks.reminder3h}</option>
              <option value={360}>{m.tasks.reminder6h}</option>
              <option value={720}>{m.tasks.reminder12h}</option>
              <option value={1440}>{m.tasks.reminder24h}</option>
              <option value={10080}>{m.tasks.reminder7d}</option>
            </select>
          </div>
          {quietHoursEnabled && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" name="bypassQuietHours" defaultChecked={task.bypassQuietHours} className="size-4 accent-brand" />
              <span>{m.tasks.quietBypass}</span>
            </label>
          )}
          {state?.error && <p className="text-sm text-st-cancelled">{state.error}</p>}
          <button type="submit" disabled={pending} className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {pending ? m.common.saving : m.common.save}
          </button>
        </form>
      </div>
    </div>
  );
}

function fmtFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function CreateDialog({
  initialType, users, teams, projects, clients, categories, canCreateProject, quietHoursEnabled, blobEnabled, initialProjectId, onClose, onCreated,
}: {
  initialType: "TASK" | "TICKET" | "WORK_ORDER";
  users: Opt[];
  teams: Opt[];
  projects: Opt[];
  clients: Opt[];
  categories: CategoryLite[];
  canCreateProject: boolean;
  quietHoursEnabled?: boolean;
  blobEnabled?: boolean;
  initialProjectId?: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const toast = useToast();
  const m = useMessages();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [categoryId, setCategoryId] = useState("");
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const dialogTitle = initialType === "TICKET" ? m.tasks.createTicketTitle : m.tasks.createTaskTitle;

  async function stageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0];
    if (!raw) return;
    if (raw.size > 20 * 1024 * 1024) { toast.error(m.tasks.fileSizeError); return; }
    if (fileRef.current) fileRef.current.value = "";
    const file = await optimizeImage(raw);
    setStagedFiles((prev) => [...prev, file]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formRef.current || submitting) return;
    setFormError(null);
    setSubmitting(true);
    setProgress(m.common.saving);
    try {
      const fd = new FormData(formRef.current);
      const result = await createTaskAction(undefined, fd);
      if (!result?.ok || !result.id) {
        setFormError(result?.error ?? m.common.error);
        return;
      }
      if (stagedFiles.length > 0 && blobEnabled) {
        for (let i = 0; i < stagedFiles.length; i++) {
          setProgress(`${m.tasks.fileLabel} ${i + 1} / ${stagedFiles.length}…`);
          const afd = new FormData();
          afd.append("file", stagedFiles[i]);
          await addAttachmentAction(result.id, afd).catch(() => {});
        }
      }
      toast.success(m.common.success);
      onCreated();
      onClose();
    } catch {
      setFormError(m.common.error);
    } finally {
      setSubmitting(false);
      setProgress(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{dialogTitle}</h2>
          <button onClick={onClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>
        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input name="title" placeholder="Titlu *" required autoFocus className={dlgInput} />
          <textarea name="description" placeholder="Descriere" rows={3} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand" />
          <div className="grid gap-2 sm:grid-cols-2">
            <select name="type" defaultValue={initialType} className={dlgInput}>
              <option value="TASK">{m.tasks.typeTask}</option>
              <option value="TICKET">{m.tasks.typeTicket}</option>
            </select>
            <select name="priority" defaultValue="MEDIUM" className={dlgInput}>
              <option value="LOW">{m.priority.LOW}</option>
              <option value="MEDIUM">{m.priority.MEDIUM}</option>
              <option value="HIGH">{m.priority.HIGH}</option>
              <option value="URGENT">{m.priority.URGENT}</option>
            </select>
          </div>
          <QuickSelect
            name="projectId"
            options={projects}
            placeholder={m.tasks.noProject}
            optionPrefix="Proiect: "
            canCreate={canCreateProject}
            createLabel="proiect"
            onQuickCreate={quickCreateProject}
            defaultValue={initialProjectId ?? ""}
          />
          {clients.length > 0 && (
            <select name="clientId" defaultValue="" className={dlgInput}>
              <option value="">{m.tasks.noClient}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <MultiAssignPicker users={users} teams={teams} />
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.tasks.dueDate}</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <input type="date" name="dueDate" className={dlgInput} />
              <input type="time" name="dueTime" placeholder={m.tasks.dueTime} className={dlgInput} />
            </div>
          </div>
          <CategoryChips categories={categories} value={categoryId} onChange={setCategoryId} />
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.tasks.reminderLabel}</label>
            <select name="reminderIntervalMinutes" defaultValue={0} className={dlgInput}>
              <option value={0}>{m.tasks.reminderNever}</option>
              <option value={10}>{m.tasks.reminder10m}</option>
              <option value={30}>{m.tasks.reminder30m}</option>
              <option value={60}>{m.tasks.reminder1h}</option>
              <option value={180}>{m.tasks.reminder3h}</option>
              <option value={360}>{m.tasks.reminder6h}</option>
              <option value={720}>{m.tasks.reminder12h}</option>
              <option value={1440}>{m.tasks.reminder24h}</option>
              <option value={10080}>{m.tasks.reminder7d}</option>
            </select>
          </div>
          {quietHoursEnabled && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" name="bypassQuietHours" className="size-4 accent-brand" />
              <span>{m.tasks.quietBypass}</span>
            </label>
          )}

          {/* ── Atașamente ─────────────────────────────────── */}
          {blobEnabled && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-semibold text-ink-soft">
                  {m.tasks.attachments} {stagedFiles.length > 0 && `(${stagedFiles.length})`}
                </span>
                <label className="tap cursor-pointer rounded-lg border border-[var(--color-line)] px-2.5 py-1 text-xs font-medium text-brand hover:bg-brand-soft">
                  {m.tasks.addFile}
                  <input ref={fileRef} type="file" className="sr-only" onChange={stageFile} disabled={submitting} />
                </label>
              </div>
              {stagedFiles.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {stagedFiles.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-2.5 py-1.5">
                      <span className="min-w-0 flex-1 truncate text-xs">{f.name}</span>
                      <span className="shrink-0 text-[11px] text-ink-soft">{fmtFileSize(f.size)}</span>
                      <button
                        type="button"
                        onClick={() => setStagedFiles((prev) => prev.filter((_, j) => j !== i))}
                        className="tap shrink-0 text-xs text-st-cancelled hover:text-red-600"
                        disabled={submitting}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {formError && <p className="text-sm text-st-cancelled">{formError}</p>}
          <button type="submit" disabled={submitting} className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {progress ?? m.tasks.create}
          </button>
        </form>
      </div>
    </div>
  );
}
