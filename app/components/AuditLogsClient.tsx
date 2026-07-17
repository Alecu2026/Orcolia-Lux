"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { rowSummary, moduleLabel, AUDIT_MODULES, ACTION_OPTIONS } from "@/lib/audit-meta";
import { deleteAllAuditLogs } from "@/app/actions/audit";
import { IconChevronLeft, IconChevronRight, IconTrash } from "./icons";
import { useToast } from "./toast";
import { useMessages } from "@/lib/i18n/context";

type Opt = { id: string; name: string };
type Row = {
  id: string;
  userId: string | null;
  userName: string;
  userRole: string;
  action: string;
  module: string;
  objectId: string | null;
  objectName: string | null;
  oldValue: string | null;
  newValue: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: string | Date;
};
type Filters = {
  user: string;
  role: string;
  action: string;
  module: string;
  ps?: string;
};

const fldCls = (val: string) =>
  `h-8 appearance-none sel-arrow rounded-lg border pl-2 pr-7 text-xs outline-none focus:border-brand ${
    val
      ? "border-brand bg-brand/10 font-semibold text-brand"
      : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;

function fmtTime(d: string | Date): string {
  const dt = new Date(d);
  const day = String(dt.getDate()).padStart(2, "0");
  const mon = String(dt.getMonth() + 1).padStart(2, "0");
  const yr = dt.getFullYear();
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${day}.${mon}.${yr} ${hh}:${mm}`;
}

function roleLabel(r: string): string {
  if (r.includes("SUPER")) return "Super";
  if (r.includes("ADMIN")) return "Admin";
  if (r.includes("STAFF")) return "Staff";
  return r.slice(0, 5);
}

function roleCls(r: string): string {
  if (r.includes("SUPER")) return "bg-purple-100 text-purple-700";
  if (r.includes("ADMIN")) return "bg-brand/10 text-brand";
  return "bg-[var(--color-surface-2)] text-ink-soft";
}

export default function AuditLogsClient({
  items,
  users,
  page,
  hasMore,
  filters,
  totalPages = 1,
}: {
  items: Row[];
  users: Opt[];
  page: number;
  hasMore: boolean;
  filters: Filters;
  totalPages?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const m = useMessages();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // ── Persistenţă filtre ──────────────────────────────────
  const auditFiltersEmpty = !filters.user && !filters.role && !filters.action && !filters.module;
  const auditIsFirstSave = useRef(true);
  useEffect(() => {
    if (auditFiltersEmpty) {
      try {
        const saved = localStorage.getItem("filters:audit");
        if (saved) router.replace(`/admin/audit-logs?${saved}`);
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (auditIsFirstSave.current) { auditIsFirstSave.current = false; if (auditFiltersEmpty) return; }
    try {
      const sp = new URLSearchParams();
      if (filters.user) sp.set("user", filters.user);
      if (filters.role) sp.set("role", filters.role);
      if (filters.action) sp.set("action", filters.action);
      if (filters.module) sp.set("module", filters.module);
      if (filters.ps && filters.ps !== "20") sp.set("ps", filters.ps);
      const str = sp.toString();
      if (str) localStorage.setItem("filters:audit", str);
      else localStorage.removeItem("filters:audit");
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.user, filters.role, filters.action, filters.module, filters.ps]);

  function apply(patch: Partial<Filters & { page: number }>) {
    const next: Record<string, string> = {
      user: filters.user,
      role: filters.role,
      action: filters.action,
      module: filters.module,
      ps: filters.ps ?? "",
      ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, String(v ?? "")])),
    };
    if (!("page" in patch)) next.page = "1";
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (!v || v === "1") continue;
      if (k === "ps" && v === "20") continue;
      usp.set(k, v);
    }
    if (next.page && next.page !== "1") usp.set("page", next.page);
    const qs = usp.toString();
    router.push(`/admin/audit-logs${qs ? `?${qs}` : ""}`);
  }

  function exportUrl(format: "csv" | "excel"): string {
    const sp = new URLSearchParams({ format });
    if (filters.user) sp.set("user", filters.user);
    if (filters.role) sp.set("role", filters.role);
    if (filters.action) sp.set("action", filters.action);
    if (filters.module) sp.set("module", filters.module);
    return `/api/admin/audit/export?${sp.toString()}`;
  }

  async function handleDeleteAll() {
    setDeleting(true);
    try {
      const res = await deleteAllAuditLogs();
      if (res?.error) toast.error(res.error);
      else { toast.success(m.auditLogs.allDeleted); setConfirmDelete(false); router.refresh(); }
    } finally {
      setDeleting(false);
    }
  }

  const activeFilters = Boolean(filters.user || filters.role || filters.action || filters.module);

  return (
    <>
      {/* Bară filtre + acțiuni */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={filters.user} onChange={(e) => apply({ user: e.target.value })} className={fldCls(filters.user)}>
          <option value="">{m.auditLogs.filterUser}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={filters.role} onChange={(e) => apply({ role: e.target.value })} className={fldCls(filters.role)}>
          <option value="">{m.auditLogs.filterRole}</option>
          <option value="ADMIN">{m.auditLogs.roleAdmin}</option>
          <option value="STAFF">{m.auditLogs.roleStaff}</option>
        </select>
        <select value={filters.module} onChange={(e) => apply({ module: e.target.value })} className={fldCls(filters.module)}>
          <option value="">{m.auditLogs.filterModule}</option>
          {AUDIT_MODULES.map((mod) => <option key={mod} value={mod}>{moduleLabel(mod)}</option>)}
        </select>
        <select value={filters.action} onChange={(e) => apply({ action: e.target.value })} className={fldCls(filters.action)}>
          <option value="">{m.auditLogs.filterAction}</option>
          {ACTION_OPTIONS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
        <button
          onClick={() => { try { localStorage.removeItem("filters:audit"); } catch {} router.push("/admin/audit-logs"); }}
          className="tap h-8 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
        >
          {m.auditLogs.clearFilters}
        </button>

        <div className="ml-auto flex items-center gap-2">
          <a
            href={exportUrl("csv")}
            download
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            {m.auditLogs.exportCsv}
          </a>
          <a
            href={exportUrl("excel")}
            download
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            {m.auditLogs.exportExcel}
          </a>
          <button
            onClick={() => setConfirmDelete(true)}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-600 hover:bg-red-50"
          >
            <IconTrash className="size-3.5" />
            {m.auditLogs.deleteAll}
          </button>
        </div>
      </div>

      {/* Confirmare ștergere */}
      {confirmDelete && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5">
          <span className="flex-1 text-sm text-red-700">
            {m.auditLogs.deleteWarning}
          </span>
          <button
            onClick={handleDeleteAll}
            disabled={deleting}
            className="h-7 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
          >
            {deleting ? m.auditLogs.deleting : m.auditLogs.confirmDelete}
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            disabled={deleting}
            className="h-7 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-60"
          >
            {m.common.cancel}
          </button>
        </div>
      )}

      {/* Rânduri compacte */}
      {items.length === 0 ? (
        <div className="card grid place-items-center p-10 text-center text-sm text-ink-soft">
          {activeFilters ? m.auditLogs.noResultsFiltered : m.auditLogs.noResults}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--color-line)]">
          {/* Header — doar desktop */}
          <div className="hidden grid-cols-[130px_170px_160px_1fr] border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft lg:grid">
            <span>{m.auditLogs.colDate}</span>
            <span>{m.auditLogs.colUser}</span>
            <span>{m.auditLogs.colObject}</span>
            <span>{m.auditLogs.colAction}</span>
          </div>

          {items.map((r, i) => (
            <div
              key={r.id}
              className={`flex items-baseline gap-2 px-3 py-1.5 text-[13px] hover:bg-[var(--color-surface-2)] lg:grid lg:grid-cols-[130px_170px_160px_1fr] lg:items-center lg:gap-3 ${
                i > 0 ? "border-t border-[var(--color-line)]" : ""
              }`}
            >
              {/* Timestamp */}
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-soft">
                {fmtTime(r.createdAt)}
              </span>

              {/* Utilizator + rol */}
              <span className="hidden min-w-0 items-center gap-1.5 lg:flex">
                <span className="truncate font-medium">{r.userName}</span>
                <span className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold ${roleCls(r.userRole)}`}>
                  {roleLabel(r.userRole)}
                </span>
              </span>

              {/* Obiect */}
              <span className="hidden min-w-0 truncate text-ink-soft lg:block">
                {r.objectName ?? <span className="italic">—</span>}
              </span>

              {/* Acțiune */}
              <span className="min-w-0 flex-1 truncate lg:flex-none">
                <span className="font-medium lg:hidden">{r.userName}: </span>
                {rowSummary(r)}
                {r.objectName && (
                  <span className="ml-1 lg:hidden text-ink-soft">— {r.objectName}</span>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Paginare */}
      {(page > 1 || hasMore || filters.ps) && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1">
          <button
            disabled={page <= 1}
            onClick={() => apply({ page: page - 1 })}
            className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={m.common.prev}
          >
            <IconChevronLeft className="size-4" />
          </button>
          {totalPages > 1 && (
            <span className="px-2 text-sm text-ink-soft">{page} / {totalPages}</span>
          )}
          <button
            disabled={!hasMore}
            onClick={() => apply({ page: page + 1 })}
            className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={m.common.next}
          >
            <IconChevronRight className="size-4" />
          </button>
          <select
            value={filters.ps || "20"}
            onChange={(e) => apply({ ps: e.target.value, page: 1 } as Partial<Filters & { page: number }>)}
            className="ml-2 h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-xs outline-none focus:border-brand"
            title={m.auditLogs.perPage}
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
    </>
  );
}
