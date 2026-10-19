"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  setTaskStatus,
  setTaskProgress,
  updateTaskFieldAction,
  type TaskFieldPatch,
  deleteTask,
  getTaskHistory,
  getTaskComments,
  addTaskCommentAction,
} from "@/app/actions/tasks";
import DataTable, { type Col, type Filter } from "./DataTable";
import { DateTimePick, EditableSelect, EditableText, MultiPick, PopEditor } from "./InlineCells";
import ExportButton from "./ExportButton";
import ImportButton from "./ImportButton";
import TaskAttachmentsPanel from "./TaskAttachmentsPanel";
import {
  Comments,
  CreateDialog,
  EditDialog,
  STATUSES,
  StatusDropdown,
  Timeline,
  TZ,
  fmtDue,
  withRetry,
  type CommentRow,
  type HistoryRow,
  type Opt,
  type Status,
  type Task,
} from "./TasksManager";
import { useToast } from "./toast";
import { IconPencil, IconTrash, IconX } from "./icons";
import { addDaysToKey, dateKeyOf, formatTime, todayKey, zonedToUtc } from "@/lib/date";
import { useMessages } from "@/lib/i18n/context";
import type { CategoryLite } from "./types";

const PRIO_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 } as const;
const PRIO_CLS: Record<Task["priority"], string> = {
  LOW: "text-ink-soft",
  MEDIUM: "text-ink",
  HIGH: "font-semibold text-st-progress",
  URGENT: "font-bold text-st-cancelled",
};
const OPEN: Status[] = ["NEW", "ASSIGNED", "READ", "IN_PROGRESS", "ON_HOLD", "REVIEW"];
const GROUPS: Record<string, Status[]> = {
  "g:active": OPEN,
  "g:new": ["NEW"],
  "g:closed": ["DONE", "CANCELLED"],
};

const iconBtn =
  "tap grid size-5 cursor-pointer place-items-center rounded border border-[var(--color-line)] hover:bg-brand-soft";
const topBtn =
  "tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]";
const dmy = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Task-uri / Tickete — tabel dens cu filtre locale (ca la Plătitori): toate task-urile din „scope" vin o dată, iar
 * filtrarea/sortarea/paginarea rulează în browser. Click pe rând = popup cu detalii, atașamente, istoric și comentarii.
 */
export default function TasksTable({
  items,
  scope,
  users,
  teams,
  projects,
  clients = [],
  categories = [],
  canCreate,
  canDelete,
  canEdit = false,
  userId,
  canCreateProject = false,
  quietHoursEnabled = false,
  blobEnabled = false,
  initialCreate,
  initialProjectId,
  initialOpenId,
  scopeOptions,
  basePath = "/tasks",
  createLabel,
  ticketMode = false,
  presetValues,
}: {
  items: Task[];
  scope: string;
  users: Opt[];
  teams: Opt[];
  projects: Opt[];
  clients?: Opt[];
  categories?: CategoryLite[];
  canCreate: boolean;
  canDelete: boolean;
  canEdit?: boolean;
  userId?: string;
  canCreateProject?: boolean;
  quietHoursEnabled?: boolean;
  blobEnabled?: boolean;
  initialCreate?: "TASK" | "TICKET" | "WORK_ORDER";
  initialProjectId?: string;
  initialOpenId?: string;
  scopeOptions?: { key: string; label: string }[];
  basePath?: "/tasks" | "/tickets";
  createLabel?: string;
  ticketMode?: boolean;
  presetValues?: Record<string, string | undefined>;
}) {
  const router = useRouter();
  const toast = useToast();
  const m = useMessages();
  const [rows, setRows] = useState(items);
  useEffect(() => setRows(items), [items]);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [createType, setCreateType] = useState<"TASK" | "TICKET" | "WORK_ORDER" | null>(initialCreate ?? null);
  const [statusPending, setStatusPending] = useState<string | null>(null);

  const canEditRow = (t: Task) =>
    canEdit || (!!userId && (t.creatorId === userId || t.assigneeId === userId || t.extraAssigneeIds.includes(userId)));

  function changeStatus(id: string, next: Status) {
    const prev = rows;
    if (prev.find((t) => t.id === id)?.status === next) return;
    setStatusPending(id);
    setRows((cur) => cur.map((t) => (t.id === id ? { ...t, status: next } : t))); // optimist
    setTaskStatus(id, next)
      .then((res) => {
        if (res?.error) { setRows(prev); toast.error(res.error); }
        else toast.success(`Status: ${m.status[next]}`);
      })
      .finally(() => setStatusPending((cur) => (cur === id ? null : cur)));
  }

  function changeProgress(id: string, progress: number) {
    const prev = rows;
    setRows((cur) => cur.map((t) => (t.id === id ? { ...t, progress } : t)));
    setTaskProgress(id, progress).then((res) => {
      if (res?.error) { setRows(prev); toast.error(res.error); }
      else toast.success(`Progres: ${progress}%`);
    });
  }

  function remove(id: string) {
    if (!confirm(m.tasks.deleteConfirm)) return;
    const prev = rows;
    setRows((cur) => cur.filter((t) => t.id !== id));
    setOpenId((o) => (o === id ? null : o));
    deleteTask(id).then(() => toast.success(m.tasks.deleted)).catch(() => { setRows(prev); toast.error(m.tasks.deleteFailed); });
  }

  /** Editare dintr-un câmp: se schimbă imediat în tabel (optimist), serverul confirmă; la eșec revenim + mesaj. */
  function patchTask(t: Task, patch: TaskFieldPatch, optimistic: Partial<Task>) {
    const prev = rows;
    setRows((cur) => cur.map((x) => (x.id === t.id ? { ...x, ...optimistic } : x)));
    updateTaskFieldAction(t.id, patch)
      .then((res) => {
        if (res?.error) { setRows(prev); toast.error(res.error); }
        else router.refresh(); // reconciliază câmpurile derivate (ex. clientul proiectului)
      })
      .catch(() => { setRows(prev); toast.error(m.common.error); });
  }

  const nameIn = (list: Opt[], id: string) => list.find((o) => o.id === id)?.name ?? null;
  const dash = <span className="text-ink-soft/60">—</span>;
  const now = new Date();
  const overdue = (t: Task) => !!t.dueAt && new Date(t.dueAt) < now && t.status !== "DONE" && t.status !== "CANCELLED";

  const columns: Col<Task>[] = [
    {
      key: "seq", label: "#", minW: 45, sort: (t) => t.seq,
      render: (t) => (
        <button type="button" onClick={() => setOpenId(t.id)} title="Deschide detaliile" className="cursor-pointer rounded px-0.5 font-mono font-semibold text-brand hover:bg-brand-soft/60 hover:underline">
          {t.seq != null ? `#${t.seq}` : "↗"}
        </button>
      ),
    },
    {
      key: "title", label: "Titlu", minW: 240, maxW: 340, sticky: true, sort: (t) => t.title,
      render: (t) => (
        <EditableText value={t.title} disabled={!canEditRow(t)} onSave={(v) => patchTask(t, { title: v }, { title: v })} display={<span title={t.title}>{t.title}</span>} />
      ),
    },
    {
      key: "status", label: "Status", minW: 95, sort: (t) => STATUSES.indexOf(t.status),
      render: (t) => (
        <div className="origin-left scale-90" onClick={(e) => e.stopPropagation()}>
          <StatusDropdown status={t.status} pending={statusPending === t.id} onChange={(s) => changeStatus(t.id, s)} />
        </div>
      ),
    },
    {
      key: "prio", label: "Prioritate", minW: 80, sort: (t) => PRIO_RANK[t.priority],
      render: (t) => (
        <EditableSelect
          value={t.priority}
          emptyLabel={null}
          disabled={!canEditRow(t)}
          options={(["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map((p) => ({ value: p, label: m.priority[p] }))}
          onChange={(v) => patchTask(t, { priority: v }, { priority: v as Task["priority"] })}
          display={<span className={PRIO_CLS[t.priority]}>{m.priority[t.priority]}</span>}
        />
      ),
    },
    {
      key: "project", label: "Proiect", minW: 130, maxW: 180, sort: (t) => t.projectName,
      render: (t) => (
        <EditableSelect
          value={t.projectId ?? ""}
          disabled={!canEditRow(t)}
          options={projects.map((o) => ({ value: o.id, label: o.name }))}
          onChange={(v) => patchTask(t, { projectId: v || null }, { projectId: v || null, projectName: nameIn(projects, v) })}
          display={t.projectName ?? dash}
        />
      ),
    },
    {
      key: "client", label: "Client", minW: 130, maxW: 180, sort: (t) => t.clientName,
      render: (t) => (
        <EditableSelect
          value={t.clientId ?? ""}
          disabled={!canEditRow(t)}
          options={clients.map((o) => ({ value: o.id, label: o.name }))}
          onChange={(v) => patchTask(t, { clientId: v || null }, { clientId: v || null, clientName: nameIn(clients, v) })}
          display={t.clientName ?? dash}
        />
      ),
    },
    {
      key: "assignee", label: "Responsabili", minW: 120, maxW: 170, sort: (t) => t.assigneeName ?? t.teamName,
      render: (t) => {
        const names = [t.assigneeName ?? t.teamName, ...t.extraAssigneeIds.map((id) => nameIn(users, id)), ...t.extraTeamIds.map((id) => nameIn(teams, id))].filter(Boolean);
        const display = names.length ? <span title={names.join(", ")}>{names.join(", ")}</span> : dash;
        const selected = [...(t.assigneeId ? [t.assigneeId] : []), ...t.extraAssigneeIds, ...(t.teamId ? [t.teamId] : []), ...t.extraTeamIds];
        return (
          <PopEditor display={display} disabled={!canEditRow(t)} width={260}>
            {(close) => (
              <MultiPick
                groups={[{ label: "Persoane", items: users }, { label: "Echipe", items: teams }]}
                selected={selected}
                onCancel={close}
                onSave={(picked) => {
                  close();
                  const u = picked["Persoane"] ?? [];
                  const tm = picked["Echipe"] ?? [];
                  patchTask(t, { assigneeIds: u, teamIds: tm }, {
                    assigneeId: u[0] ?? null, extraAssigneeIds: u.slice(1), assigneeName: u[0] ? nameIn(users, u[0]) : null,
                    teamId: tm[0] ?? null, extraTeamIds: tm.slice(1), teamName: tm[0] ? nameIn(teams, tm[0]) : null,
                  });
                }}
              />
            )}
          </PopEditor>
        );
      },
    },
    {
      key: "due", label: "Termen", minW: 120, sort: (t) => (t.dueAt ? new Date(t.dueAt).getTime() : null),
      render: (t) => {
        const display = t.dueAt ? <span className={overdue(t) ? "font-semibold text-st-cancelled" : ""} title={overdue(t) ? "Termen depășit" : undefined}>{fmtDue(t.dueAt)}</span> : dash;
        const dueDate = t.dueAt ? dateKeyOf(new Date(t.dueAt), TZ) : "";
        const rawTime = t.dueAt ? formatTime(new Date(t.dueAt), TZ) : "";
        return (
          <PopEditor display={display} disabled={!canEditRow(t)} width={240}>
            {(close) => (
              <DateTimePick
                date={dueDate}
                time={rawTime !== "00:00" ? rawTime : ""}
                onCancel={close}
                onSave={(d, tm) => {
                  close();
                  patchTask(t, { dueDate: d || null, dueTime: tm || null }, { dueAt: d ? zonedToUtc(d, tm || "00:00", TZ).toISOString() : null });
                }}
              />
            )}
          </PopEditor>
        );
      },
    },
    {
      key: "progress", label: "%", minW: 50, right: true, sort: (t) => t.progress,
      render: (t) => (
        <div onClick={(e) => e.stopPropagation()}>
          <select value={t.progress} onChange={(e) => changeProgress(t.id, Number(e.target.value))} className="h-4 w-12 cursor-pointer rounded border-0 bg-transparent text-[11px] outline-none" aria-label="Progres">
            {[0, 25, 50, 75, 100].map((p) => <option key={p} value={p}>{p}%</option>)}
          </select>
        </div>
      ),
    },
    {
      key: "cat", label: "Categorie", minW: 110, sort: (t) => t.categoryName,
      render: (t) => (
        <EditableSelect
          value={t.categoryId ?? ""}
          disabled={!canEditRow(t) || categories.length === 0}
          options={categories.map((o) => ({ value: o.id, label: o.name }))}
          onChange={(v) => {
            const c = categories.find((x) => x.id === v);
            patchTask(t, { categoryId: v || null }, { categoryId: v || null, categoryName: c?.name ?? null, categoryColor: c?.color ?? null });
          }}
          display={t.categoryName ? <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: t.categoryColor ?? "#6366f1" }} />{t.categoryName}</span> : dash}
        />
      ),
    },
    { key: "creator", label: "Creat de", minW: 100, maxW: 140, sort: (t) => t.creatorName, render: (t) => t.creatorName },
    { key: "created", label: "Creat la", minW: 80, sort: (t) => new Date(t.createdAt).getTime(), render: (t) => dmy(t.createdAt) },
    {
      key: "act", label: "", minW: 55,
      render: (t) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canEditRow(t) && <button type="button" className={iconBtn} title={m.common.edit} onClick={() => setEditTask(t)}><IconPencil className="size-3" /></button>}
          {canDelete && <button type="button" className={`${iconBtn} text-st-cancelled`} title={m.common.delete} onClick={() => remove(t.id)}><IconTrash className="size-3" /></button>}
        </div>
      ),
    },
  ];

  const filters = useMemo<Filter<Task>[]>(() => {
    const today = todayKey(TZ);
    const dueKey = (t: Task) => (t.dueAt ? dateKeyOf(new Date(t.dueAt), TZ) : null);
    return [
      {
        kind: "text", key: "q", label: "Caută", grow: true, placeholder: m.tasks.searchPlaceholder,
        test: (t, v) => {
          const seq = v.match(/^#?(\d+)$/);
          if (seq && t.seq === Number(seq[1])) return true;
          return [t.title, t.description, t.projectName, t.clientName, t.assigneeName, t.teamName, t.creatorName].some((x) => (x ?? "").toLowerCase().includes(v));
        },
      },
      {
        kind: "select", key: "status", label: m.tasks.filterStatus,
        options: [
          ...(ticketMode
            ? [{ value: "g:active", label: m.tickets.scopeActive }, { value: "g:new", label: m.tickets.scopeNew }, { value: "g:closed", label: m.tickets.scopeClosed }]
            : [{ value: "g:active", label: "Deschise (toate cele active)" }, { value: "g:closed", label: "Închise (finalizate/anulate)" }]),
          ...STATUSES.map((s) => ({ value: s, label: m.status[s] })),
        ],
        test: (t, v) => (v in GROUPS ? GROUPS[v].includes(t.status) : t.status === v),
      },
      {
        kind: "select", key: "prio", label: m.tasks.filterPriority,
        options: (["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map((p) => ({ value: p, label: m.priority[p] })),
        test: (t, v) => t.priority === v,
      },
      {
        kind: "select", key: "assignee", label: m.tasks.filterPerson,
        options: users.map((u) => ({ value: u.id, label: u.name })),
        test: (t, v) => t.assigneeId === v || t.extraAssigneeIds.includes(v),
      },
      { kind: "select", key: "team", label: m.tasks.filterTeam, options: teams.map((x) => ({ value: x.id, label: x.name })), test: (t, v) => t.teamId === v || t.extraTeamIds.includes(v) },
      { kind: "select", key: "proj", label: m.tasks.filterProject, options: projects.map((x) => ({ value: x.id, label: x.name })), test: (t, v) => t.projectId === v },
      ...(clients.length ? [{ kind: "select" as const, key: "client", label: m.tasks.filterClient, options: clients.map((x) => ({ value: x.id, label: x.name })), test: (t: Task, v: string) => t.clientId === v }] : []),
      ...(categories.length ? [{ kind: "select" as const, key: "category", label: m.tasks.filterCategory, options: categories.map((x) => ({ value: x.id, label: x.name })), test: (t: Task, v: string) => t.categoryId === v }] : []),
      {
        kind: "select", key: "due", label: m.tasks.filterDue,
        options: [
          { value: "overdue", label: m.tasks.filterDueOverdue },
          { value: "today", label: m.tasks.filterDueToday },
          { value: "tomorrow", label: m.tasks.filterDueTomorrow },
          { value: "week", label: m.tasks.filterDueWeek },
          { value: "month", label: m.tasks.filterDueMonth },
          { value: "none", label: "Fără termen" },
        ],
        test: (t, v) => {
          const k = dueKey(t);
          if (v === "none") return k == null;
          if (k == null) return false;
          if (v === "overdue") return k < today && t.status !== "DONE" && t.status !== "CANCELLED";
          if (v === "today") return k === today;
          if (v === "tomorrow") return k === addDaysToKey(today, 1, TZ);
          if (v === "week") return k >= today && k <= addDaysToKey(today, 6, TZ);
          return k >= today && k <= addDaysToKey(today, 30, TZ);
        },
      },
      { kind: "date", key: "from", label: "Termen de la", test: (t, v) => { const k = dueKey(t); return !!k && k >= v; } },
      { kind: "date", key: "to", label: "Termen până la", test: (t, v) => { const k = dueKey(t); return !!k && k <= v; } },
    ];
  }, [m, users, teams, projects, clients, categories, ticketMode]);

  const current = openId ? rows.find((t) => t.id === openId) ?? null : null;

  return (
    <>
      {scopeOptions && scopeOptions.length > 0 && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {scopeOptions.map((s) => (
            <Link
              key={s.key}
              href={`${basePath}${s.key === "mine" ? "" : `?scope=${s.key}`}`}
              className={`tap shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium ${scope === s.key ? "bg-brand text-white" : "card text-ink-soft"}`}
            >
              {s.label}
            </Link>
          ))}
        </div>
      )}
      <DataTable
        storageKey={`tasks:${basePath}:${scope}`}
        rows={rows}
        columns={columns}
        filters={filters}
        defaultSort={{ key: "created", dir: "desc" }}
        presetValues={presetValues}
        noun={ticketMode ? "tichete" : "task-uri"}
        emptyText={m.tasks.noTasks}
        rowClassName={(t) => (overdue(t) ? "bg-st-cancelled/5" : "")}
        toolbar={
          <>
            <ExportButton entity={ticketMode ? "tickets" : "tasks"} params={{ scope: scope !== "mine" ? scope : undefined }} className={topBtn} />
            <ImportButton entity={ticketMode ? "tickets" : "tasks"} className={topBtn} />
            {canCreate && (
              <button type="button" onClick={() => setCreateType(ticketMode ? "TICKET" : "TASK")} className="tap h-7 cursor-pointer rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong">
                {createLabel ?? m.tasks.newButton}
              </button>
            )}
          </>
        }
      />

      {current && (
        <TaskDetailDialog
          task={current}
          basePath={basePath}
          canEdit={canEditRow(current)}
          canDelete={canDelete}
          statusPending={statusPending === current.id}
          onStatus={(s) => changeStatus(current.id, s)}
          onProgress={(p) => changeProgress(current.id, p)}
          onEdit={() => { setEditTask(current); }}
          onDelete={() => remove(current.id)}
          onClose={() => setOpenId(null)}
        />
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
          onCreated={(id) => {
            router.refresh(); // noul task apare în tabel
            setOpenId(id); // și se deschide direct (se afișează când sosește în listă)
          }}
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
            setRows((cur) => cur.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
            setEditTask(null);
            router.refresh();
          }}
        />
      )}
    </>
  );
}

function TaskDetailDialog({
  task: t,
  basePath,
  canEdit,
  canDelete,
  statusPending,
  onStatus,
  onProgress,
  onEdit,
  onDelete,
  onClose,
}: {
  task: Task;
  basePath: "/tasks" | "/tickets";
  canEdit: boolean;
  canDelete: boolean;
  statusPending: boolean;
  onStatus: (s: Status) => void;
  onProgress: (p: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const m = useMessages();
  const toast = useToast();
  const [history, setHistory] = useState<HistoryRow[] | undefined>(undefined);
  const [comments, setComments] = useState<CommentRow[] | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let alive = true;
    withRetry(() => getTaskHistory(t.id)).then((r) => alive && setHistory(r as HistoryRow[])).catch(() => alive && setHistory([]));
    withRetry(() => getTaskComments(t.id)).then((r) => alive && setComments(r as CommentRow[])).catch(() => alive && setComments([]));
    return () => { alive = false; };
  }, [t.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function post() {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    addTaskCommentAction(t.id, body)
      .then((res) => {
        if (res?.error) { toast.error(res.error); return; }
        setDraft("");
        getTaskComments(t.id).then((rows) => setComments(rows as CommentRow[]));
        toast.success(m.tasks.commentAdded);
      })
      .finally(() => setPosting(false));
  }

  const miniBtn = "tap inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft";
  const late = !!t.dueAt && new Date(t.dueAt) < new Date() && t.status !== "DONE" && t.status !== "CANCELLED";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[94dvh] w-full max-w-2xl overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">
              {t.seq != null && <span className="mr-1.5 rounded bg-brand/10 px-1.5 font-mono text-xs font-semibold text-brand">#{t.seq}</span>}
              {t.title}
            </h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              {t.type === "TICKET" ? m.tasks.typeTicket : m.tasks.typeTask} · creat de {t.creatorName} · {dmy(t.createdAt)}
            </p>
          </div>
          <button onClick={onClose} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-1.5 border-y border-[var(--color-line)] py-2">
          <Link href={`${t.type === "TICKET" ? "/tickets" : "/tasks"}/${t.id}`} className="tap inline-flex h-8 cursor-pointer items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">
            Pagina {basePath === "/tickets" ? "tichetului" : "task-ului"} →
          </Link>
          {canEdit && <button type="button" onClick={onEdit} className={miniBtn}>✎ {m.common.edit}</button>}
          {canDelete && <button type="button" onClick={onDelete} className={`${miniBtn} text-st-cancelled`}>🗑 {m.common.delete}</button>}
          <span className="ml-auto flex items-center gap-2">
            <StatusDropdown status={t.status} pending={statusPending} onChange={onStatus} />
            <select value={t.progress} onChange={(e) => onProgress(Number(e.target.value))} className="h-7 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-1 text-[11px]" aria-label="Progres">
              {[0, 25, 50, 75, 100].map((p) => <option key={p} value={p}>{p}%</option>)}
            </select>
          </span>
        </div>

        <Box title="Detalii">
          <Item label="Prioritate" value={<span className={PRIO_CLS[t.priority]}>{m.priority[t.priority]}</span>} />
          <Item label="Termen" value={t.dueAt ? <span className={late ? "font-semibold text-st-cancelled" : ""}>{fmtDue(t.dueAt)}{late ? " · depășit" : ""}</span> : null} />
          <Item label="Responsabil" value={t.assigneeName ?? t.teamName} />
          <Item label="Proiect" value={t.projectName} />
          <Item label="Client" value={t.clientName} />
          <Item label="Categorie" value={t.categoryName ? <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: t.categoryColor ?? "#6366f1" }} />{t.categoryName}</span> : null} />
          {t.description && <div className="px-2.5 py-1.5"><p className="mb-0.5 text-[11px] text-ink-soft">{m.tasks.descriptionLabel}</p><p className="whitespace-pre-wrap text-[13px]">{t.description}</p></div>}
        </Box>

        {t.projectLat != null && t.projectLng != null && (
          <Box title={m.tasks.locationLabel}>
            <div className="flex flex-wrap gap-1.5 p-2">
              <a className={miniBtn} target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${t.projectLat},${t.projectLng}`}>🗺 Google Maps</a>
              <a className={miniBtn} target="_blank" rel="noreferrer" href={`https://waze.com/ul?ll=${t.projectLat},${t.projectLng}&navigate=yes`}>🚗 Waze</a>
              <a className={miniBtn} target="_blank" rel="noreferrer" href={`https://maps.apple.com/?ll=${t.projectLat},${t.projectLng}`}>🍎 Apple Maps</a>
            </div>
          </Box>
        )}

        <Box title={m.tasks.attachmentsTitle}>
          <TaskAttachmentsPanel taskId={t.id} projectName={t.projectName} />
        </Box>

        <Box title="Istoric">
          <Timeline rows={history} loading={history === undefined} createdAt={t.createdAt} creatorName={t.creatorName} />
        </Box>

        <Box title={m.tasks.commentSection}>
          <Comments rows={comments} draft={draft} posting={posting} onDraftChange={setDraft} onSubmit={post} />
        </Box>
      </div>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-2.5 overflow-hidden rounded-lg border border-[var(--color-line)]">
      <h3 className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</h3>
      <div className="divide-y divide-[var(--color-line)]">{children}</div>
    </section>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value == null || value === "";
  return (
    <div className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
      <span className="shrink-0 text-[11px] text-ink-soft">{label}</span>
      <span className="min-w-0 break-words text-right text-[13px]">{empty ? <span className="text-ink-soft/60">—</span> : value}</span>
    </div>
  );
}
