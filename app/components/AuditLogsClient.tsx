"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTION_OPTIONS,
  AUDIT_MODULES,
  EMPTY_AUDIT_FILTERS,
  auditStateToParams,
  countActiveAuditFilters,
  moduleLabel,
  parseJsonObject,
  rowSummary,
  sanitizeAuditState,
  type AuditFilterState,
} from "@/lib/audit-meta";
import { deleteAllAuditLogs } from "@/app/actions/audit";
import { IconChevronLeft, IconChevronRight, IconTrash } from "./icons";
import { useToast } from "./toast";
import { useLocale, useMessages, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import AuditDetailDialog from "./AuditDetailDialog";
import { fmtStamp, moduleCls, roleCls, roleLabel, type AuditRow } from "./audit-shared";

type Opt = { id: string; name: string };
type Page = { items: AuditRow[]; total: number; page: number; pageSize: number; totalPages: number };

const PAGE_SIZES = [20, 50, 100, 200, 500] as const;
const STORAGE_KEY = "filters:audit";

const fldCls = (val: string | boolean) =>
  `h-8 min-w-0 max-w-full appearance-none sel-arrow rounded-lg border pl-2 pr-7 text-xs outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;
const txtCls = (val: string) =>
  `h-8 min-w-0 rounded-lg border px-2 text-xs outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand placeholder:font-normal" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;

/** O valoare veche / nouă pentru rândul din listă: JSON-ul (obiect) nu se afișează — se vede în pop-up. */
function shortVal(v: string | null): string | null {
  if (v == null) return null;
  return parseJsonObject(v) ? null : v;
}

function buildPageButtons(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set<number>([1, total]);
  for (let i = Math.max(2, current - 2); i <= Math.min(total - 1, current + 2); i++) pages.add(i);
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) out.push("…");
    out.push(sorted[i]);
  }
  return out;
}

/** Un rând al listei (memoizat: la schimbarea paginii se refac doar rândurile noi). */
const AuditTr = memo(function AuditTr({ r, first, tag, onOpen }: { r: AuditRow; first: boolean; tag: string; onOpen: (id: string) => void }) {
  const t = useT();
  const oldV = shortVal(r.oldValue);
  const newV = shortVal(r.newValue);
  const summary = rowSummary({ action: r.action, oldValue: oldV, newValue: newV }, t);
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onOpen(r.id)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}
      className={`flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-0.5 px-3 py-1.5 text-[13px] outline-none hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)] lg:grid lg:grid-cols-[150px_180px_112px_minmax(0,1.5fr)_minmax(0,1fr)_110px] lg:items-center lg:gap-3 ${first ? "" : "border-t border-[var(--color-line)]"}`}
    >
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-soft">{fmtStamp(r.createdAt, tag)}</span>
      <span className="hidden min-w-0 items-center gap-1.5 lg:flex">
        <span className="truncate font-medium">{r.userName}</span>
        <span className={`shrink-0 rounded px-1 py-px text-[10px] font-semibold ${roleCls(r.userRole)}`}>{roleLabel(r.userRole)}</span>
      </span>
      <span className="hidden lg:block">
        <span className={`inline-block max-w-full truncate rounded-full px-2 py-px text-[10px] font-semibold ${moduleCls(r.module)}`}>{moduleLabel(r.module, t)}</span>
      </span>
      <span className="min-w-0 flex-1 truncate lg:flex-none">
        <span className="font-medium lg:hidden">{r.userName}: </span>
        {summary}
        {r.hasDetails && <span className="ml-1.5 rounded bg-brand/10 px-1 py-px text-[10px] font-semibold text-brand" title={t("Are modificări detaliate — apasă pe rând")}>{t("detalii")}</span>}
      </span>
      <span className="hidden min-w-0 truncate text-ink-soft lg:block" title={r.objectName ?? ""}>
        {r.objectName ?? <span className="italic">—</span>}
      </span>
      <span className="hidden truncate font-mono text-[11px] text-ink-soft lg:block" title={r.ip ?? ""}>{r.ip ?? "—"}</span>
    </div>
  );
});

export default function AuditLogsClient({
  initial,
  users,
  initialFilters,
  initialPage,
  initialPageSize,
}: {
  initial: Page;
  users: Opt[];
  initialFilters: AuditFilterState;
  initialPage: number;
  initialPageSize: number;
}) {
  const t = useT();
  const toast = useToast();
  const m = useMessages();
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag);

  const [filters, setFilters] = useState<AuditFilterState>(initialFilters);
  const [draftQ, setDraftQ] = useState(initialFilters.q);
  const [page, setPage] = useState(initialPage);
  const [ps, setPs] = useState(initialPageSize);
  const [data, setData] = useState<Page>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tick, setTick] = useState(0);
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const key = useMemo(() => auditStateToParams(filters, { page, ps }).toString(), [filters, page, ps]);
  const loadedKey = useRef(auditStateToParams(initialFilters, { page: initialPage, ps: initialPageSize }).toString());

  // Restaurează filtrele salvate (doar dacă adresa nu are propriile filtre).
  useEffect(() => {
    if (key === "") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const sp = new URLSearchParams(saved);
          const f = sanitizeAuditState(Object.fromEntries(sp.entries()));
          const savedPs = Number(sp.get("ps"));
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setFilters(f);
          setDraftQ(f.q);
          if ((PAGE_SIZES as readonly number[]).includes(savedPs)) setPs(savedPs);
        }
      } catch {}
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adresa (link de partajat) + filtrele salvate; fără navigare.
  useEffect(() => {
    if (!ready) return;
    const p = auditStateToParams(filters, { ps });
    try {
      if (p.toString()) localStorage.setItem(STORAGE_KEY, p.toString());
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
    window.history.replaceState(null, "", `/admin/audit-logs${key ? `?${key}` : ""}`);
  }, [key, filters, ps, ready]);

  // Pagina cerută de la server doar când se schimbă ceva; o cerere nouă o anulează pe cea veche. Rândurile vechi rămân vizibile (estompate) până sosesc cele noi.
  useEffect(() => {
    if (!ready) return;
    if (key === loadedKey.current && tick === 0) return;
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/admin/audit?${key}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Eroare la încărcare.");
        return j as Page;
      })
      .then((j) => {
        loadedKey.current = key;
        setData(j);
        setLoading(false);
        if (j.page !== page) setPage(j.page);
      })
      .catch((e: Error) => {
        if (e.name === "AbortError") return;
        setError(e.message);
        setLoading(false);
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, tick]);

  function setFilter(patch: Partial<AuditFilterState>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }
  function onSearch(v: string) {
    setDraftQ(v);
    if (qTimer.current) clearTimeout(qTimer.current);
    qTimer.current = setTimeout(() => setFilter({ q: v.trim() }), 300);
  }
  function clearAll() {
    if (qTimer.current) clearTimeout(qTimer.current);
    setFilters(EMPTY_AUDIT_FILTERS);
    setDraftQ("");
    setPage(1);
  }

  const active = countActiveAuditFilters({ ...filters, q: draftQ.trim() });
  const exportQs = auditStateToParams(filters).toString();
  const exportUrl = (format: "csv" | "excel") => `/api/admin/audit/export?format=${format}${exportQs ? `&${exportQs}` : ""}`;

  async function handleDeleteAll() {
    setDeleting(true);
    try {
      const res = await deleteAllAuditLogs();
      if (res?.error) toast.error(t(res.error));
      else {
        toast.success(m.auditLogs.allDeleted);
        setConfirmDelete(false);
        loadedKey.current = "";
        setTick((n) => n + 1);
      }
    } finally {
      setDeleting(false);
    }
  }

  const items = data.items;
  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);
  const buttons = buildPageButtons(data.page, data.totalPages);
  const selIdx = selId ? items.findIndex((r) => r.id === selId) : -1;
  const onOpen = useCallback((id: string) => setSelId(id), [setSelId]);

  return (
    <>
      {/* ── Filtre ─────────────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input
          value={draftQ}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t("Caută: utilizator, obiect, IP, valori…")}
          title={t("Minimum 2 caractere. Caută în numele utilizatorului, obiect, IP și în valorile veche / nouă.")}
          aria-label={t("Căutare")}
          className={`${txtCls(draftQ)} min-w-52 flex-1`}
        />
        <select value={filters.user} onChange={(e) => setFilter({ user: e.target.value })} className={fldCls(filters.user)} aria-label={m.auditLogs.filterUser}>
          <option value="">{m.auditLogs.filterUser}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={filters.role} onChange={(e) => setFilter({ role: e.target.value as AuditFilterState["role"] })} className={fldCls(filters.role)} aria-label={m.auditLogs.filterRole}>
          <option value="">{m.auditLogs.filterRole}</option>
          <option value="ADMIN">{m.auditLogs.roleAdmin}</option>
          <option value="STAFF">{m.auditLogs.roleStaff}</option>
          <option value="SUPER">{t("Super-admin")}</option>
        </select>
        <select value={filters.module} onChange={(e) => setFilter({ module: e.target.value })} className={fldCls(filters.module)} aria-label={m.auditLogs.filterModule}>
          <option value="">{m.auditLogs.filterModule}</option>
          {AUDIT_MODULES.map((mod) => <option key={mod} value={mod}>{moduleLabel(mod, t)}</option>)}
        </select>
        <select value={filters.action} onChange={(e) => setFilter({ action: e.target.value })} className={fldCls(filters.action)} aria-label={m.auditLogs.filterAction}>
          <option value="">{m.auditLogs.filterAction}</option>
          {ACTION_OPTIONS.map((a) => <option key={a.key} value={a.key}>{t(a.label)}</option>)}
        </select>
        <span className="flex items-center gap-1" title={t("Perioada (ziua în fusul orar al firmei)")}>
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} aria-label={t("De la data")} className={txtCls(filters.from)} />
          <span className="text-ink-soft">–</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} aria-label={t("Până la data")} className={txtCls(filters.to)} />
        </span>
        <label className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs ${filters.changes ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"}`} title={t("Arată doar jurnalele care au modificări pe câmpuri (ce s-a schimbat)")}>
          <input type="checkbox" checked={filters.changes} onChange={(e) => setFilter({ changes: e.target.checked })} className="size-3 accent-[var(--color-brand)]" />
          {t("Cu modificări detaliate")}
        </label>
        {(active > 0) && (
          <button type="button" onClick={clearAll} className="tap h-8 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]">
            {m.auditLogs.clearFilters}{` (${active})`}
          </button>
        )}
      </div>

      {/* ── Sumar + acțiuni ─────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span><b>{nf(data.total)}</b> {t("jurnale")}{active > 0 ? ` ${t("(filtrat)")}` : ""}</span>
        {data.total > 0 && (
          <span className="text-ink-soft">
            {t("afișate {from}–{to} din {total}", { from: nf(from), to: nf(to), total: nf(data.total) })}
            {data.totalPages > 1 ? ` · ${t("pagina {cur}/{pages}", { cur: data.page, pages: data.totalPages })}` : ""}
          </span>
        )}
        {loading && <span className="text-ink-soft">{t("se încarcă…")}</span>}
        <button type="button" onClick={() => { loadedKey.current = ""; setTick((n) => n + 1); }} disabled={loading} title={t("Reîncarcă jurnalul")} className="tap cursor-pointer text-ink-soft hover:text-brand disabled:cursor-default">
          ↻ {t("Reîmprospătează")}
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
            {t("Afișează")}
            <select value={ps} onChange={(e) => { setPs(Number(e.target.value)); setPage(1); }} className={fldCls(ps === 50 ? "" : "x")} aria-label={m.auditLogs.perPage}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{t("{n} / pagină", { n })}</option>)}
            </select>
          </label>
          <a href={exportUrl("csv")} download className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]" title={t("Exportă jurnalele filtrate (maximum 10.000)")}>
            {m.auditLogs.exportCsv}
          </a>
          <a href={exportUrl("excel")} download className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]" title={t("Exportă jurnalele filtrate (maximum 10.000)")}>
            {m.auditLogs.exportExcel}
          </a>
          <button onClick={() => setConfirmDelete(true)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-600 hover:bg-red-50">
            <IconTrash className="size-3.5" />
            {m.auditLogs.deleteAll}
          </button>
        </div>
      </div>

      {confirmDelete && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5">
          <span className="flex-1 text-sm text-red-700">{m.auditLogs.deleteWarning}</span>
          <button onClick={handleDeleteAll} disabled={deleting} className="h-7 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60">
            {deleting ? m.auditLogs.deleting : m.auditLogs.confirmDelete}
          </button>
          <button onClick={() => setConfirmDelete(false)} disabled={deleting} className="h-7 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-60">
            {m.common.cancel}
          </button>
        </div>
      )}

      {error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {t(error)}
          <button type="button" onClick={() => { loadedKey.current = ""; setTick((n) => n + 1); }} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
        </p>
      )}
      {loading && <div className="mb-1 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}

      {/* ── Lista ──────────────────────────────────────────────────────────── */}
      {items.length === 0 ? (
        <div className="card grid place-items-center p-10 text-center text-sm text-ink-soft">
          {active > 0 ? m.auditLogs.noResultsFiltered : m.auditLogs.noResults}
        </div>
      ) : (
        <div role="table" className={`overflow-hidden rounded-xl border border-[var(--color-line)] transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}>
          <div role="row" className="hidden grid-cols-[150px_180px_112px_minmax(0,1.5fr)_minmax(0,1fr)_110px] gap-3 border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft lg:grid">
            <span>{m.auditLogs.colDate}</span>
            <span>{m.auditLogs.colUser}</span>
            <span>{t("Modul")}</span>
            <span>{m.auditLogs.colAction}</span>
            <span>{m.auditLogs.colObject}</span>
            <span>IP</span>
          </div>
          {items.map((r, i) => <AuditTr key={r.id} r={r} first={i === 0} tag={tag} onOpen={onOpen} />)}
        </div>
      )}

      {/* ── Paginare numerică ───────────────────────────────────────────────── */}
      {data.total > 0 && data.totalPages > 1 && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1">
          <button disabled={data.page <= 1} onClick={() => setPage(data.page - 1)} className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40" aria-label={m.common.prev}>
            <IconChevronLeft className="size-4" />
          </button>
          {buttons.map((b, i) =>
            b === "…" ? (
              <span key={`e${i}`} className="flex h-8 w-6 items-center justify-center text-sm text-ink-soft">…</span>
            ) : (
              <button key={b} onClick={() => setPage(b)} className={`tap h-8 min-w-[32px] rounded-lg px-2 text-xs font-medium ${b === data.page ? "bg-brand text-white" : "border border-[var(--color-line)] text-ink hover:bg-[var(--color-surface-2)]"}`}>
                {b}
              </button>
            ),
          )}
          <button disabled={data.page >= data.totalPages} onClick={() => setPage(data.page + 1)} className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40" aria-label={m.common.next}>
            <IconChevronRight className="size-4" />
          </button>
        </div>
      )}

      {selId && (
        <AuditDetailDialog
          key={selId}
          id={selId}
          preview={items.find((r) => r.id === selId) ?? null}
          onClose={() => setSelId(null)}
          onPrev={selIdx > 0 ? () => setSelId(items[selIdx - 1].id) : undefined}
          onNext={selIdx >= 0 && selIdx < items.length - 1 ? () => setSelId(items[selIdx + 1].id) : undefined}
          onOpen={setSelId}
        />
      )}
    </>
  );
}
