"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { deleteProject, updateProjectFieldAction, type ProjectFieldPatch } from "@/app/actions/projects";
import { getProjectTasksAction, type ProjectTaskRow } from "@/app/actions/tasks";
import DataTable, { type Col, type Filter } from "./DataTable";
import { EditableSelect, EditableText } from "./InlineCells";
import ExportButton from "./ExportButton";
import ImportButton from "./ImportButton";
import ProjectFilesPanel from "./ProjectFilesPanel";
import { ProjectDialog, type Opt, type Project } from "./ProjectsManager";
import { useToast } from "./toast";
import { IconPencil, IconPlus, IconTrash, IconX } from "./icons";
import { useMessages } from "@/lib/i18n/context";
import { useT } from "@/lib/i18n/context";

const STATUS_CLS: Record<Project["status"], string> = {
  ACTIVE: "bg-st-progress/15 text-st-progress",
  ON_HOLD: "bg-st-noshow/15 text-st-noshow",
  DONE: "bg-st-done/15 text-st-done",
  ARCHIVED: "bg-[var(--color-surface-2)] text-ink-soft",
};
const TASK_DOT: Record<string, string> = {
  NEW: "bg-st-new", ASSIGNED: "bg-st-new", READ: "bg-st-confirmed", IN_PROGRESS: "bg-st-progress",
  ON_HOLD: "bg-st-noshow", REVIEW: "bg-st-confirmed", DONE: "bg-st-done", CANCELLED: "bg-st-cancelled",
};

const iconBtn =
  "tap grid size-5 cursor-pointer place-items-center rounded border border-[var(--color-line)] hover:bg-brand-soft";
const topBtn =
  "tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]";

/** Proiecte — tabel dens cu filtre locale (ca la Plătitori). Click pe rând = popup cu detalii, task-uri și fișiere. */
export default function ProjectsTable({
  projects,
  users,
  teams,
  clients,
  openCreate,
  canEdit = true,
  canCreate = true,
  canDelete = true,
  canCreateTask = true,
}: {
  canEdit?: boolean;
  canCreate?: boolean;
  canDelete?: boolean;
  /** „Sarcini – Creare": butonul „+" de pe rând (sarcină nouă în proiect). */
  canCreateTask?: boolean;
  projects: Project[];
  users: Opt[];
  teams: Opt[];
  clients: Opt[];
  openCreate?: boolean;
}) {
  const tr = useT();
  const toast = useToast();
  const m = useMessages();
  const [rows, setRows] = useState(projects);
  useEffect(() => setRows(projects), [projects]);
  const [dialog, setDialog] = useState<{ open: boolean; project: Project | null }>({ open: !!openCreate && canCreate, project: null });
  const [detail, setDetail] = useState<Project | null>(null);

  const nameOf = (id: string | null, list: Opt[]) => (id ? (list.find((o) => o.id === id)?.name ?? "?") : null);

  function remove(id: string) {
    if (!confirm(m.projects.deleteConfirm)) return;
    const prev = rows;
    setRows((r) => r.filter((p) => p.id !== id)); // optimist
    deleteProject(id)
      .then(() => toast.success(m.projects.deleted))
      .catch(() => { setRows(prev); toast.error(m.projects.deleteFailed); });
  }

  /** Editare dintr-un câmp: se schimbă imediat în tabel (optimist), serverul confirmă; la eșec revenim + mesaj. */
  function patchProject(p: Project, patch: ProjectFieldPatch, optimistic: Partial<Project>) {
    const prev = rows;
    setRows((cur) => cur.map((x) => (x.id === p.id ? { ...x, ...optimistic } : x)));
    updateProjectFieldAction(p.id, patch)
      .then((res) => { if (res?.error) { setRows(prev); toast.error(tr(res.error)); } })
      .catch(() => { setRows(prev); toast.error(tr(m.common.error)); });
  }
  const opts = (list: Opt[]) => list.map((o) => ({ value: o.id, label: o.name }));

  const dash = <span className="text-ink-soft/60">—</span>;
  const columns: Col<Project>[] = [
    {
      key: "seq", label: "#", minW: 45, sort: (p) => p.seq,
      render: (p) => (
        <button type="button" onClick={() => setDetail(p)} title={tr("Deschide detaliile")} className="cursor-pointer rounded px-0.5 font-mono font-semibold text-brand hover:bg-brand-soft/60 hover:underline">
          {p.seq != null ? `#${String(p.seq).padStart(3, "0")}` : "↗"}
        </button>
      ),
    },
    {
      key: "name", label: "Proiect", minW: 200, maxW: 280, sticky: true, sort: (p) => p.name,
      render: (p) => <EditableText value={p.name} disabled={!canEdit} onSave={(v) => patchProject(p, { name: v }, { name: v })} display={<span title={p.name}>{p.name}</span>} />,
    },
    {
      key: "status", label: "Status", minW: 90, sort: (p) => m.projects.status[p.status],
      render: (p) => (
        <EditableSelect
          value={p.status}
          emptyLabel={null}
          disabled={!canEdit}
          options={(["ACTIVE", "ON_HOLD", "DONE", "ARCHIVED"] as const).map((s) => ({ value: s, label: m.projects.status[s] }))}
          onChange={(v) => patchProject(p, { status: v }, { status: v as Project["status"] })}
          display={<span className={`inline-block rounded-full px-1.5 text-[10px] font-medium leading-[14px] ${STATUS_CLS[p.status]}`}>{m.projects.status[p.status]}</span>}
        />
      ),
    },
    {
      key: "client", label: "Client", minW: 140, maxW: 200, sort: (p) => nameOf(p.clientId, clients),
      render: (p) => <EditableSelect value={p.clientId ?? ""} disabled={!canEdit} options={opts(clients)} onChange={(v) => patchProject(p, { clientId: v || null }, { clientId: v || null })} display={nameOf(p.clientId, clients) ?? dash} />,
    },
    {
      key: "assignee", label: "Responsabil", minW: 120, maxW: 160, sort: (p) => nameOf(p.assigneeId, users),
      render: (p) => <EditableSelect value={p.assigneeId ?? ""} disabled={!canEdit} options={opts(users)} onChange={(v) => patchProject(p, { assigneeId: v || null }, { assigneeId: v || null })} display={nameOf(p.assigneeId, users) ?? dash} />,
    },
    {
      key: "team", label: "Echipă", minW: 100, maxW: 140, sort: (p) => nameOf(p.teamId, teams),
      render: (p) => <EditableSelect value={p.teamId ?? ""} disabled={!canEdit} options={opts(teams)} onChange={(v) => patchProject(p, { teamId: v || null }, { teamId: v || null })} display={nameOf(p.teamId, teams) ?? dash} />,
    },
    {
      key: "desc", label: "Descriere", minW: 240, maxW: 340, defaultHidden: true, sort: (p) => p.description,
      render: (p) => <EditableText value={p.description ?? ""} allowEmpty disabled={!canEdit} onSave={(v) => patchProject(p, { description: v || null }, { description: v || null })} display={p.description ? <span title={p.description}>{p.description}</span> : undefined} />,
    },
    { key: "tasks", label: "Sarcini", minW: 55, right: true, sort: (p) => p.taskCount, render: (p) => p.taskCount },
    {
      key: "loc", label: "Locație", minW: 150, maxW: 220,
      render: (p) => <EditableText value={p.address ?? ""} allowEmpty disabled={!canEdit} onSave={(v) => patchProject(p, { address: v || null }, { address: v || null })} display={p.lat != null ? <span>📍 {p.address ?? ""}</span> : (p.address ?? dash)} />,
    },
    {
      key: "act", label: "", minW: 110,
      render: (p) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canCreateTask && <Link href={`/tasks?create=task&project=${p.id}`} className={`${iconBtn} text-brand`} title={m.projects.addTask}><IconPlus className="size-3" /></Link>}
          {canEdit && <button type="button" className={iconBtn} title={m.common.edit} onClick={() => setDialog({ open: true, project: p })}><IconPencil className="size-3" /></button>}
          {canDelete && <button type="button" className={`${iconBtn} text-st-cancelled`} title={m.common.delete} onClick={() => remove(p.id)}><IconTrash className="size-3" /></button>}
        </div>
      ),
    },
  ];

  const filters = useMemo<Filter<Project>[]>(
    () => [
      {
        kind: "text", key: "q", label: "Caută", grow: true, placeholder: m.projects.searchPlaceholder,
        test: (p, v) => {
          const seq = v.match(/^#?(\d+)$/);
          if (seq && p.seq === Number(seq[1])) return true;
          return [p.name, p.description, p.address].some((x) => (x ?? "").toLowerCase().includes(v));
        },
      },
      {
        kind: "select", key: "status", label: m.projects.statusAll,
        options: (["ACTIVE", "ON_HOLD", "DONE", "ARCHIVED"] as const).map((s) => ({ value: s, label: m.projects.status[s] })),
        test: (p, v) => p.status === v,
      },
      {
        kind: "select", key: "client", label: "Client: toți",
        options: [{ value: "none", label: "Fără client" }, ...clients.map((c) => ({ value: c.id, label: c.name }))],
        test: (p, v) => (v === "none" ? !p.clientId : p.clientId === v),
      },
      {
        kind: "select", key: "assignee", label: "Responsabil: toți",
        options: [{ value: "none", label: "Fără responsabil" }, ...users.map((u) => ({ value: u.id, label: u.name }))],
        test: (p, v) => (v === "none" ? !p.assigneeId : p.assigneeId === v),
      },
      {
        kind: "select", key: "team", label: "Echipă: toate",
        options: [{ value: "none", label: "Fără echipă" }, ...teams.map((t) => ({ value: t.id, label: t.name }))],
        test: (p, v) => (v === "none" ? !p.teamId : p.teamId === v),
      },
      {
        kind: "select", key: "tasks", label: "Sarcini: toate",
        options: [{ value: "has", label: "Cu sarcini" }, { value: "none", label: "Fără sarcini" }],
        test: (p, v) => (v === "has" ? p.taskCount > 0 : p.taskCount === 0),
      },
      {
        kind: "select", key: "loc", label: "Locație: toate",
        options: [{ value: "map", label: "Cu pin pe hartă" }, { value: "none", label: "Fără locație" }],
        test: (p, v) => (v === "map" ? p.lat != null : p.lat == null && !p.address),
      },
    ],
    [m, clients, users, teams],
  );

  return (
    <>
      <DataTable
        storageKey="projects"
        rows={rows}
        columns={columns}
        filters={filters}
        noun="proiecte"
        emptyText={m.projects.noProjects}
        toolbar={
          <>
            <ExportButton entity="projects" className={topBtn} />
            {canCreate && <ImportButton entity="projects" className={topBtn} />}
            {canCreate && (
              <button type="button" onClick={() => setDialog({ open: true, project: null })} className="tap h-7 cursor-pointer rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong">
                {m.projects.new}
              </button>
            )}
          </>
        }
      />
      {detail && (
        <ProjectDetailDialog
          project={rows.find((p) => p.id === detail.id) ?? detail}
          clientName={nameOf(detail.clientId, clients)}
          assigneeName={nameOf(detail.assigneeId, users)}
          teamName={nameOf(detail.teamId, teams)}
          canCreateTask={canCreateTask}
          onEdit={canEdit ? () => { const p = rows.find((x) => x.id === detail.id) ?? detail; setDetail(null); setDialog({ open: true, project: p }); } : undefined}
          onClose={() => setDetail(null)}
        />
      )}
      {dialog.open && (
        <ProjectDialog project={dialog.project} users={users} teams={teams} clients={clients} onClose={() => setDialog({ open: false, project: null })} />
      )}
    </>
  );
}

function ProjectDetailDialog({
  project: p,
  clientName,
  assigneeName,
  teamName,
  canCreateTask,
  onEdit,
  onClose,
}: {
  project: Project;
  clientName: string | null;
  assigneeName: string | null;
  teamName: string | null;
  canCreateTask?: boolean;
  onEdit?: () => void;
  onClose: () => void;
}) {
  const tr = useT();
  const m = useMessages();
  const [tasks, setTasks] = useState<ProjectTaskRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    getProjectTasksAction(p.id).then((r) => alive && setTasks(r)).catch(() => alive && setTasks([]));
    return () => { alive = false; };
  }, [p.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const miniBtn = "tap inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-xl overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{p.seq != null && <span className="mr-1.5 font-mono text-sm text-ink-soft">#{String(p.seq).padStart(3, "0")}</span>}{p.name}</h2>
            <span className={`inline-block rounded-full px-2 text-[11px] font-medium ${STATUS_CLS[p.status]}`}>{m.projects.status[p.status]}</span>
          </div>
          <button onClick={onClose} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5 border-y border-[var(--color-line)] py-2">
          <Link href={`/projects/${p.id}`} className="tap inline-flex h-8 cursor-pointer items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">{tr("Pagina proiectului →")}</Link>
          {onEdit && <button type="button" onClick={onEdit} className={miniBtn}>✎ {m.common.edit}</button>}
          {canCreateTask && <Link href={`/tasks?create=task&project=${p.id}`} className={miniBtn}>+ {m.projects.taskLabel}</Link>}
          <Link href={`/tasks?scope=all&proj=${p.id}`} className={miniBtn}>{m.projects.viewAllTasks}</Link>
        </div>

        <Box title={tr("Detalii")}>
          <Item label={tr("Client")} value={clientName} />
          <Item label={tr("Responsabil")} value={assigneeName} />
          <Item label={tr("Echipă")} value={teamName} />
          <Item label={tr("Locație")} value={p.address ? `${p.lat != null ? "📍 " : ""}${p.address}` : p.lat != null ? tr("📍 pin pe hartă") : null} />
          <Item label={tr("Sarcini")} value={String(p.taskCount)} />
          {p.description && <div className="px-2.5 py-1.5"><p className="mb-0.5 text-[11px] text-ink-soft">{tr("Descriere")}</p><p className="whitespace-pre-wrap text-[13px]">{p.description}</p></div>}
        </Box>

        <Box title={`${tr("Sarcini")}${tasks ? ` (${tasks.length})` : ""}`}>
          {!tasks ? (
            <p className="px-2.5 py-2 text-sm text-ink-soft">{m.projects.loadingTasks}</p>
          ) : tasks.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-ink-soft">{m.projects.noTasksInProject}</p>
          ) : (
            tasks.map((t) => (
              <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center gap-2 px-2.5 py-1.5 text-[13px] hover:bg-[var(--color-surface-2)]">
                <span className={`size-2 shrink-0 rounded-full ${TASK_DOT[t.status] ?? "bg-gray-400"}`} />
                {t.seq != null && <span className="shrink-0 rounded bg-brand/10 px-1.5 text-[10px] font-mono font-semibold text-brand">#{t.seq}</span>}
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                {(t.assigneeName || t.teamName) && <span className="shrink-0 text-[11px] text-ink-soft">{t.assigneeName ?? t.teamName}</span>}
                {t.dueAt && <span className="shrink-0 text-[11px] text-ink-soft">{new Date(t.dueAt).toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit" })}</span>}
              </Link>
            ))
          )}
        </Box>

        <Box title={m.projects.files}>
          <ProjectFilesPanel projectId={p.id} />
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
