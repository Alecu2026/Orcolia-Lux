"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTION_OPTIONS,
  AUDIT_ALL_CAP,
  AUDIT_DEFAULT_PAGE_SIZE,
  AUDIT_FIRST_CHUNK,
  AUDIT_NEXT_CHUNK,
  AUDIT_PAGE_SIZES,
  AUDIT_PS_COOKIE,
  AUDIT_MODULES,
  EMPTY_AUDIT_FILTERS,
  auditStateToParams,
  countActiveAuditFilters,
  moduleLabel,
  normalizeAuditPs,
  parseJsonObject,
  rowSummary,
  sanitizeAuditState,
  type AuditFilterState,
  type AuditPs,
} from "@/lib/audit-meta";
import { deleteAllAuditLogs } from "@/app/actions/audit";
import { IconChevronLeft, IconChevronRight, IconTrash } from "./icons";
import { useToast } from "./toast";
import { useLocale, useMessages, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import AuditDetailDialog from "./AuditDetailDialog";
import { fmtStamp, moduleCls, roleCls, roleLabel, type AuditRow } from "./audit-shared";

type Opt = { id: string; name: string };
type Page = { items: AuditRow[]; total: number; page: number; pageSize: number; totalPages: number; nextCursor?: string | null; capped?: boolean };

const STORAGE_KEY = "filters:audit";
const VIRTUAL_MIN = 80; // peste atâtea rânduri se desenează doar cele vizibile
const ROW_H = 34; // înălțime fixă (necesară virtualizării)
const ROW_BLOCK = 8; // fereastra de rânduri desenate se mută din 8 în 8 rânduri
const ROW_OVERSCAN = 30;
const CACHE_TTL_MS = 20_000; // o pagină deja văzută apare instant; după 20 s se reîmprospătează discret
const GRID = "lg:grid lg:grid-cols-[150px_180px_112px_minmax(0,1.5fr)_minmax(0,1fr)_110px] lg:gap-3";

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

/** Un rând al listei, înălțime fixă (memoizat: la derulare se desenează doar rândurile noi din fereastră). */
const AuditTr = memo(function AuditTr({ r, tag, onOpen }: { r: AuditRow; tag: string; onOpen: (id: string) => void }) {
  const t = useT();
  const summary = rowSummary({ action: r.action, oldValue: shortVal(r.oldValue), newValue: shortVal(r.newValue) }, t);
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onOpen(r.id)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}
      className={`flex cursor-pointer items-center gap-x-2 overflow-hidden whitespace-nowrap border-t border-[var(--color-line)] px-3 text-[13px] outline-none hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)] ${GRID} lg:items-center`}
      style={{ height: ROW_H, contain: "layout style" }}
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

/**
 * Tabelul (antet + rânduri virtualizate). Starea de derulare stă AICI: la derulare se re-randează doar această componentă (și doar când se trece într-un alt bloc
 * de rânduri), nu filtrele și pop-up-ul. Cu „Toate”, rândurile încă neîncărcate sunt rânduri goale care se umplu singure.
 */
const AuditTable = memo(function AuditTable({
  rows,
  rowCount,
  loading,
  tag,
  onOpen,
  resetKey,
  m,
  t,
}: {
  rows: AuditRow[];
  /** Câte rânduri are lista (poate fi mai mult decât rows.length cât timp „Toate” se încarcă). */
  rowCount: number;
  loading: boolean;
  tag: string;
  onOpen: (id: string) => void;
  /** Se schimbă la alt filtru / altă pagină: tabelul revine sus. */
  resetKey: string;
  m: ReturnType<typeof useMessages>;
  t: (s: string) => string;
}) {
  const virtual = rowCount > VIRTUAL_MIN;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [vBlock, setVBlock] = useState(0);
  const [vH, setVH] = useState(800);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !virtual) return;
    const upd = () => setVH((h) => (h === el.clientHeight ? h : el.clientHeight));
    upd();
    const obs = new ResizeObserver(upd);
    obs.observe(el);
    return () => obs.disconnect();
  }, [virtual]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVBlock(0);
  }, [resetKey]);
  function onScroll(e: React.UIEvent<HTMLDivElement>) {
    // Starea se schimbă doar când se trece într-un alt bloc; între blocuri derularea e doar a browserului (fără randări React).
    const b = Math.floor(e.currentTarget.scrollTop / (ROW_H * ROW_BLOCK));
    setVBlock((cur) => (cur === b ? cur : b));
  }
  const winStart = virtual ? Math.max(0, vBlock * ROW_BLOCK - ROW_OVERSCAN) : 0;
  const winEnd = virtual ? Math.min(rowCount, (vBlock + 1) * ROW_BLOCK + Math.ceil(vH / ROW_H) + ROW_OVERSCAN) : rowCount;
  const shown = virtual ? rows.slice(winStart, Math.min(winEnd, rows.length)) : rows;
  const skeletons = winEnd > rows.length ? winEnd - Math.max(winStart, rows.length) : 0;

  return (
    <div
      ref={scrollRef}
      onScroll={virtual ? onScroll : undefined}
      role="table"
      className={`overflow-auto rounded-xl border border-[var(--color-line)] transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}
      style={{ maxHeight: rowCount > 40 ? "max(76vh, 640px)" : undefined, overflowAnchor: "none" }}
    >
      <div role="row" className={`sticky top-0 z-10 hidden border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft ${GRID}`}>
        <span>{m.auditLogs.colDate}</span>
        <span>{m.auditLogs.colUser}</span>
        <span>{t("Modul")}</span>
        <span>{m.auditLogs.colAction}</span>
        <span>{m.auditLogs.colObject}</span>
        <span>IP</span>
      </div>
      {winStart > 0 && <div aria-hidden style={{ height: winStart * ROW_H }} />}
      {shown.map((r) => <AuditTr key={r.id} r={r} tag={tag} onOpen={onOpen} />)}
      {skeletons > 0 &&
        Array.from({ length: skeletons }, (_, k) => (
          <div key={`sk-${Math.max(winStart, rows.length) + k}`} aria-hidden className="border-t border-[var(--color-line)] px-3 text-xs leading-[33px] text-ink-soft/40" style={{ height: ROW_H }}>…</div>
        ))}
      {winEnd < rowCount && <div aria-hidden style={{ height: (rowCount - winEnd) * ROW_H }} />}
    </div>
  );
});

export default function AuditLogsClient({
  initial,
  users,
  initialFilters,
  initialPage,
  initialPs,
}: {
  initial: Page;
  users: Opt[];
  initialFilters: AuditFilterState;
  initialPage: number;
  initialPs: AuditPs;
}) {
  const t = useT();
  const toast = useToast();
  const m = useMessages();
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag);

  const [filters, setFilters] = useState<AuditFilterState>(initialFilters);
  const [draftQ, setDraftQ] = useState(initialFilters.q);
  const [page, setPage] = useState(initialPage);
  const [ps, setPs] = useState<AuditPs>(initialPs);
  const [data, setData] = useState<Page>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [tick, setTick] = useState(0);
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const all = ps === "all";
  const key = useMemo(() => auditStateToParams(filters, { page: all ? 1 : page, ps }).toString(), [filters, page, ps, all]);
  /** Cheia paginii afișate acum (numeric) — ca să nu cerem din nou ce avem deja. */
  const loadedKey = useRef(auditStateToParams(initialFilters, { page: initialPage, ps: initialPs }).toString());
  /** „Toate”: unde a rămas încărcarea (cursorul următoarei bucăți), pentru cheia dată. */
  const allRef = useRef<{ key: string; cursor: string | null }>({ key: initialPs === "all" ? loadedKey.current : "", cursor: initial.nextCursor ?? null });
  /** Paginile deja văzute: revenirea la ele e instantanee. */
  const cache = useRef(new Map<string, { data: Page; at: number }>());
  useEffect(() => {
    if (initialPs !== "all" && cache.current.size === 0) cache.current.set(loadedKey.current, { data: initial, at: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restaurează filtrele salvate (doar dacă adresa nu are propriile filtre).
  useEffect(() => {
    if (key === "") {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const sp = new URLSearchParams(saved);
          const f = sanitizeAuditState(Object.fromEntries(sp.entries()));
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setFilters(f);
          setDraftQ(f.q);
          setPs(normalizeAuditPs(sp.get("ps")));
        }
      } catch {}
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adresa (link de partajat), filtrele salvate și alegerea „câte pe pagină” (cookie → prima afișare vine cu mărimea potrivită).
  useEffect(() => {
    if (!ready) return;
    const p = auditStateToParams(filters, { ps });
    try {
      if (p.toString()) localStorage.setItem(STORAGE_KEY, p.toString());
      else localStorage.removeItem(STORAGE_KEY);
      document.cookie = `${AUDIT_PS_COOKIE}=${ps}; path=/; max-age=31536000; samesite=lax`;
    } catch {}
    window.history.replaceState(null, "", `/admin/audit-logs${key ? `?${key}` : ""}`);
  }, [key, filters, ps, ready]);

  // Pagini numerice: din cache dacă am mai văzut-o (și o reîmprospătăm discret dacă e mai veche de 20 s), altfel de la server; o cerere nouă o anulează pe cea veche.
  useEffect(() => {
    if (!ready || all) return;
    if (key === loadedKey.current && tick === 0) return;
    const hit = tick === 0 ? cache.current.get(key) : undefined;
    if (hit) {
      loadedKey.current = key;
       
      setData(hit.data);
      if (Date.now() - hit.at < CACHE_TTL_MS) return;
    }
    const ctl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/admin/audit?${key}${tick > 0 ? "&fresh=1" : ""}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Eroare la încărcare.");
        return j as Page;
      })
      .then((j) => {
        loadedKey.current = key;
        cache.current.set(key, { data: j, at: Date.now() });
        if (cache.current.size > 25) cache.current.delete(cache.current.keys().next().value as string);
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
  }, [key, ready, tick, all]);

  // „Toate”: bucăți aduse una după alta (prima mică, ca lista să apară repede; următoarele mari), cu cursor; lista crește pe măsură ce vin.
  // Un filtru nou o oprește și o pornește de la capăt; când e gata (sau la limita de jurnale) se oprește singură.
  useEffect(() => {
    if (!ready || !all) return;
    const resume = allRef.current.key === key && tick === 0;
    let cursor = resume ? allRef.current.cursor : null;
    let acc: AuditRow[] = resume ? dataRef.current.items : [];
    if (resume && !cursor) return; // deja încărcat complet
    const ctl = new AbortController();
    if (!resume) allRef.current = { key, cursor: null };
     
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        let first = acc.length === 0;
        for (;;) {
          const qs = `${key}${tick > 0 && first ? "&fresh=1" : ""}&limit=${first ? AUDIT_FIRST_CHUNK : AUDIT_NEXT_CHUNK}&loaded=${acc.length}${cursor ? `&cursor=${cursor}` : ""}`;
          const r = await fetch(`/api/admin/audit?${qs}`, { signal: ctl.signal });
          const j = (await r.json()) as { items: AuditRow[]; total: number; nextCursor: string | null; capped: boolean; error?: string };
          if (!r.ok) throw new Error(j.error ?? "Eroare la încărcare.");
          acc = acc.concat(j.items);
          first = false;
          cursor = j.nextCursor;
          allRef.current = { key, cursor };
          setData({ items: acc, total: j.total, page: 1, pageSize: acc.length, totalPages: 1, nextCursor: cursor, capped: j.capped });
          if (!cursor) break;
        }
        setLoading(false);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setLoading(false);
      }
    })();
    return () => ctl.abort();
     
  }, [key, ready, tick, all]);

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
  function refresh() {
    cache.current.clear();
    loadedKey.current = "";
    allRef.current = { key: "", cursor: null };
    setTick((n) => n + 1);
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
        refresh();
      }
    } finally {
      setDeleting(false);
    }
  }

  const items = data.items;
  // „Toate”: arătăm de la început totalul (rândurile neîncărcate încă sunt goale și se umplu singure), dar nu peste limita de jurnale.
  const rowCount = all ? Math.min(data.total, AUDIT_ALL_CAP) : items.length;
  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);
  const buttons = buildPageButtons(data.page, data.totalPages);
  const selIdx = selId ? items.findIndex((r) => r.id === selId) : -1;
  const onOpen = useCallback((id: string) => setSelId(id), [setSelId]);
  const loadedAll = all && !data.nextCursor;

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
        {data.total > 0 && !all && (
          <span className="text-ink-soft">
            {t("afișate {from}–{to} din {total}", { from: nf(from), to: nf(to), total: nf(data.total) })}
            {data.totalPages > 1 ? ` · ${t("pagina {cur}/{pages}", { cur: data.page, pages: data.totalPages })}` : ""}
          </span>
        )}
        {all && data.total > 0 && (
          <span className="text-ink-soft">
            {loadedAll ? t("toate încărcate") : t("încărcate {n} din {total}…", { n: nf(items.length), total: nf(rowCount) })}
          </span>
        )}
        {loading && !all && <span className="text-ink-soft">{t("se încarcă…")}</span>}
        <button type="button" onClick={refresh} disabled={loading} title={t("Reîncarcă jurnalul")} className="tap cursor-pointer text-ink-soft hover:text-brand disabled:cursor-default">
          ↻ {t("Reîmprospătează")}
        </button>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
            {t("Afișează")}
            <select
              value={String(ps)}
              onChange={(e) => { setPs(normalizeAuditPs(e.target.value)); setPage(1); }}
              className={fldCls(ps === AUDIT_DEFAULT_PAGE_SIZE ? "" : "x")}
              aria-label={m.auditLogs.perPage}
            >
              {AUDIT_PAGE_SIZES.map((n) => <option key={n} value={n}>{t("{n} / pagină", { n })}</option>)}
              <option value="all">{t("Toate")}</option>
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

      {all && data.total > AUDIT_ALL_CAP && (
        <p className="mb-2 rounded-lg bg-st-progress/10 px-3 py-2 text-xs text-st-progress">
          {t("Se afișează cele mai noi {cap} din {total} jurnale. Restrânge filtrele (perioadă, utilizator, modul) sau exportă.", { cap: nf(AUDIT_ALL_CAP), total: nf(data.total) })}
        </p>
      )}
      {error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {t(error)}
          <button type="button" onClick={refresh} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
        </p>
      )}
      {loading && <div className="mb-1 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}

      {/* ── Lista ──────────────────────────────────────────────────────────── */}
      {rowCount === 0 ? (
        <div className="card grid place-items-center p-10 text-center text-sm text-ink-soft">
          {active > 0 ? m.auditLogs.noResultsFiltered : m.auditLogs.noResults}
        </div>
      ) : (
        <AuditTable rows={items} rowCount={rowCount} loading={loading && !all} tag={tag} onOpen={onOpen} resetKey={key} m={m} t={t} />
      )}

      {/* ── Paginare numerică ───────────────────────────────────────────────── */}
      {!all && data.total > 0 && data.totalPages > 1 && (
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
