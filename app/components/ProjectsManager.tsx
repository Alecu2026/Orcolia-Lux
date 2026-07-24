"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  createProject,
  updateProject,
  deleteProject,
  type ProjectState,
} from "@/app/actions/projects";
import { getProjectTasksAction, type ProjectTaskRow } from "@/app/actions/tasks";
import { useToast } from "./toast";
import { IconX, IconPencil, IconTrash, IconPlus, IconChevronLeft, IconChevronRight } from "./icons";
import ExportButton from "./ExportButton";
import ImportButton from "./ImportButton";
import ProjectFilesPanel from "./ProjectFilesPanel";
import ProjectMapPickerDynamic from "./ProjectMapPickerDynamic";
import CardActionsMenu from "./CardActionsMenu";
import { useMessages } from "@/lib/i18n/context";

type Opt = { id: string; name: string };
type Project = {
  id: string;
  seq: number | null;
  name: string;
  description: string | null;
  status: "ACTIVE" | "ON_HOLD" | "DONE" | "ARCHIVED";
  clientId: string | null;
  assigneeId: string | null;
  teamId: string | null;
  taskCount: number;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

const STATUS_DOT: Record<string, string> = {
  NEW: "bg-st-new", ASSIGNED: "bg-st-new", READ: "bg-st-confirmed",
  IN_PROGRESS: "bg-st-progress", ON_HOLD: "bg-st-noshow",
  REVIEW: "bg-st-confirmed", DONE: "bg-st-done", CANCELLED: "bg-st-cancelled",
};
const input =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

export default function ProjectsManager({
  projects,
  users,
  teams,
  clients,
  page = 1,
  hasMore = false,
  totalPages = 1,
  filters = { q: "", status: "", ps: "" },
  openCreate,
}: {
  projects: Project[];
  users: Opt[];
  teams: Opt[];
  clients: Opt[];
  page?: number;
  hasMore?: boolean;
  totalPages?: number;
  filters?: { q: string; status: string; ps?: string };
  openCreate?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const m = useMessages();
  const [rows, setRows] = useState(projects);
  useEffect(() => setRows(projects), [projects]);

  // ── Persistenţă filtre ──────────────────────────────────
  const projFiltersEmpty = !filters.q && !filters.status;
  const projIsFirstSave = useRef(true);
  useEffect(() => {
    if (projFiltersEmpty) {
      try {
        const saved = localStorage.getItem("filters:projects");
        if (saved) router.replace(`/projects?${saved}`);
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (projIsFirstSave.current) { projIsFirstSave.current = false; if (projFiltersEmpty) return; }
    try {
      const sp = new URLSearchParams();
      if (filters.q) sp.set("q", filters.q);
      if (filters.status) sp.set("status", filters.status);
      if (filters.ps && filters.ps !== "20") sp.set("ps", filters.ps);
      const str = sp.toString();
      if (str) localStorage.setItem("filters:projects", str);
      else localStorage.removeItem("filters:projects");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.status, filters.ps]);
  const [dialog, setDialog] = useState<{ open: boolean; project: Project | null }>({
    open: openCreate ? true : false,
    project: null,
  });

  // ── Expandare task-uri + fișiere ────────────────────────
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filesOpenId, setFilesOpenId] = useState<string | null>(null);
  const [projectTasks, setProjectTasks] = useState<Record<string, ProjectTaskRow[]>>({});
  const [loadingTasks, setLoadingTasks] = useState<string | null>(null);

  function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!projectTasks[id]) {
      setLoadingTasks(id);
      getProjectTasksAction(id)
        .then((rows) => setProjectTasks((prev) => ({ ...prev, [id]: rows })))
        .catch(() => {})
        .finally(() => setLoadingTasks((cur) => (cur === id ? null : cur)));
    }
  }

  // Filtrare pe server (reflectată în URL)
  const [searchInput, setSearchInput] = useState(filters.q);
  useEffect(() => setSearchInput(filters.q), [filters.q]);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchInput === filters.q) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      router.push(buildUrl({ q: searchInput }));
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function buildUrl(patch: { q?: string; status?: string; page?: number; ps?: string }) {
    const merged = { q: filters.q, status: filters.status, ps: filters.ps ?? "", ...patch } as Record<string, string | number | undefined>;
    const usp = new URLSearchParams();
    if (merged.q) usp.set("q", String(merged.q));
    if (merged.status) usp.set("status", String(merged.status));
    const psVal = String(merged.ps ?? "");
    if (psVal && psVal !== "20") usp.set("ps", psVal);
    const pageVal = "page" in patch ? Number(patch.page) : 1;
    if (pageVal > 1) usp.set("page", String(pageVal));
    const qs = usp.toString();
    return `/projects${qs ? `?${qs}` : ""}`;
  }
  const activeFilters = Boolean(filters.q || filters.status);

  const nameOf = (id: string | null, list: Opt[]) => list.find((o) => o.id === id)?.name;

  function remove(id: string) {
    if (!confirm(m.projects.deleteConfirm)) return;
    const prev = rows;
    setRows((r) => r.filter((p) => p.id !== id)); // optimistic
    deleteProject(id)
      .then(() => toast.success(m.projects.deleted))
      .catch(() => {
        setRows(prev);
        toast.error(m.projects.deleteFailed);
      });
  }

  return (
    <>
      <button
        onClick={() => setDialog({ open: true, project: null })}
        className="tap mb-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong"
      >
        {m.projects.new}
      </button>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => { e.preventDefault(); router.push(buildUrl({ q: searchInput })); }}
          className="flex min-w-40 flex-1 items-center"
        >
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={m.projects.searchPlaceholder}
            className="h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-brand"
          />
        </form>
        <select value={filters.status} onChange={(e) => router.push(buildUrl({ status: e.target.value }))} className={`h-9 rounded-lg border px-2 text-xs outline-none focus:border-brand ${filters.status ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"}`}>
          <option value="">{m.projects.statusAll}</option>
          <option value="ACTIVE">{m.projects.status.ACTIVE}</option>
          <option value="ON_HOLD">{m.projects.status.ON_HOLD}</option>
          <option value="DONE">{m.projects.status.DONE}</option>
          <option value="ARCHIVED">{m.projects.status.ARCHIVED}</option>
        </select>
        <button
          onClick={() => { try { localStorage.removeItem("filters:projects"); } catch {} router.push("/projects"); }}
          className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
        >
          {m.projects.clearFilters}
        </button>
        <ExportButton
          entity="projects"
          params={{
            q: filters.q || undefined,
            status: filters.status || undefined,
          }}
          className="tap h-9 shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
        />
        <ImportButton
          entity="projects"
          className="tap h-9 shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
        />
      </div>

      {rows.length === 0 ? (
        <div className="card grid place-items-center p-10 text-center text-sm text-ink-soft">
          {activeFilters ? m.projects.noResultsFilters : m.projects.noProjects}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((p) => (
            <div key={p.id} className="card overflow-hidden">
              {/* ── Rând principal ── */}
              <div className="flex items-center gap-1.5 p-2.5 sm:gap-2.5 sm:p-3.5">
                {/* Chevron expand */}
                <button
                  type="button"
                  onClick={() => toggleExpand(p.id)}
                  className="tap grid size-6 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)] sm:size-7"
                  title={expandedId === p.id ? m.projects.collapse : m.projects.expand}
                >
                  <IconChevronRight
                    className={`size-3 transition-transform sm:size-3.5 ${expandedId === p.id ? "rotate-90" : ""}`}
                  />
                </button>

                {/* Numele proiectului */}
                <Link href={`/projects/${p.id}`} className="tap min-w-0 flex-1 text-left">
                  <div className="flex min-w-0 items-center gap-1">
                    {p.seq != null && (
                      <span
                        className="shrink-0 cursor-copy rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[10px] font-mono font-semibold text-ink-soft hover:bg-brand/10 hover:text-brand"
                        title="Click pentru copiere"
                        onClick={(e) => {
                          e.preventDefault();
                          navigator.clipboard.writeText(`#${String(p.seq).padStart(3, "0")}`);
                          toast.success(`Copiat: #${String(p.seq).padStart(3, "0")}`);
                        }}
                      >
                        #{String(p.seq).padStart(3, "0")}
                      </span>
                    )}
                    <p className="truncate text-[12px] font-semibold leading-tight sm:text-sm">{p.name}</p>
                  </div>
                  <p className="truncate text-[11px] text-ink-soft">
                    {m.projects.status[p.status]} · {p.taskCount} {m.projects.taskUnit}
                    {p.clientId && ` · ${nameOf(p.clientId, clients) ?? "?"}`}
                    {p.assigneeId && ` · ${nameOf(p.assigneeId, users) ?? "?"}`}
                    {p.teamId && ` · ${nameOf(p.teamId, teams) ?? "?"}`}
                    {p.lat != null && ` · 📍`}
                  </p>
                </Link>
                {/* Buton hartă — ascuns pe mobile, vizibil pe desktop */}
                {p.lat != null && p.lng != null && (
                  <Link href={`/projects/${p.id}`} className="tap hidden size-8 shrink-0 place-items-center rounded-lg border border-[var(--color-line)] hover:bg-[var(--color-surface-2)] sm:grid" title={m.projects.mapTooltip}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 14 8 14s8-8.75 8-14a8 8 0 0 0-8-8Z"/></svg>
                  </Link>
                )}
                {/* + Task: doar icon pe mobile, icon+text pe desktop */}
                <Link href={`/tasks?create=task&project=${p.id}`} className="tap grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--color-line)] text-brand hover:bg-brand-soft sm:inline-flex sm:h-9 sm:w-auto sm:gap-1 sm:px-2.5 sm:text-xs sm:font-medium" title={m.projects.addTask}>
                  <IconPlus className="size-3.5" />
                  <span className="hidden sm:inline text-xs font-medium">{m.projects.taskLabel}</span>
                </Link>
                <button
                  type="button"
                  onClick={() => setFilesOpenId((id) => id === p.id ? null : p.id)}
                  className={`tap hidden size-9 shrink-0 place-items-center rounded-lg border text-sm sm:grid ${filesOpenId === p.id ? "border-brand bg-brand/10 text-brand" : "border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
                  title={m.projects.files}
                >
                  📎
                </button>
                <button onClick={() => setDialog({ open: true, project: p })} className="tap hidden size-9 place-items-center rounded-lg border border-[var(--color-line)] hover:bg-[var(--color-surface-2)] sm:grid" title={m.common.edit}>
                  <IconPencil className="size-4" />
                </button>
                <button onClick={() => remove(p.id)} className="tap hidden size-9 place-items-center rounded-lg border border-[var(--color-line)] text-st-cancelled hover:bg-[var(--color-surface-2)] sm:grid" title={m.common.delete}>
                  <IconTrash className="size-4" />
                </button>
                <CardActionsMenu
                  className="sm:hidden"
                  items={[
                    { key: "files", label: m.projects.files, icon: <span className="text-sm">📎</span>, onClick: () => setFilesOpenId((id) => (id === p.id ? null : p.id)) },
                    { key: "edit", label: m.common.edit, icon: <IconPencil className="size-3.5" />, onClick: () => setDialog({ open: true, project: p }) },
                    { key: "delete", label: m.common.delete, icon: <IconTrash className="size-3.5" />, onClick: () => remove(p.id), danger: true },
                  ]}
                />
              </div>

              {/* ── Task-uri expandate ── */}
              {expandedId === p.id && (
                <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)]/40">
                  {loadingTasks === p.id ? (
                    <p className="px-4 py-3 text-[12px] text-ink-soft">{m.projects.loadingTasks}</p>
                  ) : !projectTasks[p.id]?.length ? (
                    <p className="px-4 py-3 text-[12px] text-ink-soft">{m.projects.noTasksInProject}</p>
                  ) : (
                    <>
                      <div className="flex flex-col divide-y divide-[var(--color-line)]">
                        {projectTasks[p.id].map((t) => (
                          <Link
                            key={t.id}
                            href={`/tasks/${t.id}`}
                            className="flex items-center gap-2.5 px-4 py-2 hover:bg-[var(--color-surface-2)]"
                          >
                            <span className={`size-2 shrink-0 rounded-full ${STATUS_DOT[t.status] ?? "bg-gray-400"}`} />
                            {t.seq != null && (
                              <span className="shrink-0 rounded bg-brand/10 px-1.5 py-px text-[10px] font-mono font-semibold text-brand">
                                #{t.seq}
                              </span>
                            )}
                            <span className="min-w-0 flex-1 truncate text-[13px]">{t.title}</span>
                            {(t.assigneeName || t.teamName) && (
                              <span className="shrink-0 text-[11px] text-ink-soft">{t.assigneeName ?? t.teamName}</span>
                            )}
                            {t.dueAt && (
                              <span className={`shrink-0 text-[11px] ${new Date(t.dueAt) < new Date() && t.status !== "DONE" ? "text-red-500" : "text-ink-soft"}`}>
                                {new Date(t.dueAt).toLocaleDateString("ro-RO", { day: "2-digit", month: "2-digit" })}
                              </span>
                            )}
                          </Link>
                        ))}
                      </div>
                      <div className="border-t border-[var(--color-line)] px-4 py-2">
                        <Link
                          href={`/tasks?scope=all&proj=${p.id}`}
                          className="text-[11px] font-medium text-brand hover:underline"
                        >
                          {m.projects.viewAllTasks}
                        </Link>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Fișiere proiect ── */}
              {filesOpenId === p.id && <ProjectFilesPanel projectId={p.id} />}
            </div>
          ))}
        </div>
      )}

      {(page > 1 || hasMore || filters.ps) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1">
          <button
            disabled={page <= 1}
            onClick={() => router.push(buildUrl({ page: page - 1 }))}
            className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={m.common.prev}
          >
            <IconChevronLeft className="size-4" />
          </button>
          {totalPages > 1 && (
            <span className="px-2 text-sm text-ink-soft">
              {page} / {totalPages}
            </span>
          )}
          <button
            disabled={!hasMore}
            onClick={() => router.push(buildUrl({ page: page + 1 }))}
            className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={m.common.next}
          >
            <IconChevronRight className="size-4" />
          </button>
          <select
            value={filters.ps || "20"}
            onChange={(e) => router.push(buildUrl({ ps: e.target.value, page: 1 }))}
            className="ml-2 h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-xs outline-none focus:border-brand"
            title={m.projects.perPage}
          >
            <option value="20">20 / pag.</option>
            <option value="50">50 / pag.</option>
            <option value="100">100 / pag.</option>
            <option value="200">200 / pag.</option>
            <option value="500">500 / pag.</option>
            <option value="1000">1000 / pag.</option>
            <option value="all">{m.common.all}</option>
          </select>
        </div>
      )}

      {dialog.open && (
        <ProjectDialog
          project={dialog.project}
          users={users}
          teams={teams}
          clients={clients}
          onClose={() => setDialog({ open: false, project: null })}
        />
      )}
    </>
  );
}

function ProjectDialog({
  project,
  users,
  teams,
  clients,
  onClose,
}: {
  project: Project | null;
  users: Opt[];
  teams: Opt[];
  clients: Opt[];
  onClose: () => void;
}) {
  const router = useRouter();
  const m = useMessages();
  const action = project ? updateProject : createProject;
  const [state, formAction, pending] = useActionState<ProjectState, FormData>(action, undefined);
  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
  }, [state, router, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{project ? m.projects.editTitle : m.projects.newTitle}</h2>
          <button onClick={onClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>
        <form action={formAction} className="flex flex-col gap-3">
          {project && <input type="hidden" name="id" value={project.id} />}
          <input name="name" defaultValue={project?.name ?? ""} placeholder={m.projects.namePlaceholder} required className={input} />
          <textarea name="description" defaultValue={project?.description ?? ""} placeholder={m.projects.descriptionPlaceholder} rows={3} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand" />
          <select name="status" defaultValue={project?.status ?? "ACTIVE"} className={input}>
            <option value="ACTIVE">{m.projects.status.ACTIVE}</option>
            <option value="ON_HOLD">{m.projects.status.ON_HOLD}</option>
            <option value="DONE">{m.projects.status.DONE}</option>
            <option value="ARCHIVED">{m.projects.status.ARCHIVED}</option>
          </select>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.projects.clientLabel}</label>
            <select name="clientId" defaultValue={project?.clientId ?? ""} className={input}>
              <option value="">{m.projects.noClient}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <p className="text-xs text-ink-soft">{m.projects.assignNote}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <select name="assigneeId" defaultValue={project?.assigneeId ?? ""} className={input}>
              <option value="">{m.projects.personPlaceholder}</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <select name="teamId" defaultValue={project?.teamId ?? ""} className={input}>
              <option value="">{m.projects.teamPlaceholder}</option>
              {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.projects.locationLabel}</label>
            <input
              name="address"
              defaultValue={project?.address ?? ""}
              placeholder={m.projects.addressPlaceholder}
              className={input}
            />
            <div className="mt-2">
              <ProjectMapPickerDynamic
                initialLat={project?.lat}
                initialLng={project?.lng}
              />
            </div>
          </div>
          {state?.error && <p className="text-sm text-st-cancelled">{state.error}</p>}
          <button type="submit" disabled={pending} className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {pending ? m.projects.saving : m.common.save}
          </button>
        </form>
      </div>
    </div>
  );
}
