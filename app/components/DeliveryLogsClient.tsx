"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHANNEL_CLS,
  CHANNEL_ICON,
  CHANNEL_LABEL,
  DELIVERY_ALL_CAP,
  DELIVERY_CHANNELS,
  DELIVERY_DEFAULT_PAGE_SIZE,
  DELIVERY_FIRST_CHUNK,
  DELIVERY_NEXT_CHUNK,
  DELIVERY_PAGE_SIZES,
  DELIVERY_PS_COOKIE,
  DELIVERY_STATUSES,
  EMPTY_DELIVERY_FILTERS,
  KIND_OPTIONS,
  OBJECT_TYPES,
  SOURCE_OPTIONS,
  STATUS_CLS,
  STATUS_LABEL,
  countActiveDeliveryFilters,
  deliveryStateToParams,
  kindLabel,
  normalizeDeliveryPs,
  sanitizeDeliveryState,
  sourceLabel,
  type DeliveryFilterState,
  type DeliveryPs,
} from "@/lib/delivery-meta";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import DeliveryDetailDialog from "./DeliveryDetailDialog";
import { fmtStamp } from "./audit-shared";

type Opt = { id: string; name: string };
export type DeliveryRow = {
  id: string;
  channel: string;
  status: string;
  kind: string | null;
  source: string;
  toUserId: string | null;
  toClientId: string | null;
  toName: string | null;
  to: string | null;
  fromUserId: string | null;
  fromName: string | null;
  subject: string | null;
  preview: string | null;
  hasHtml: boolean;
  objectType: string | null;
  objectId: string | null;
  objectName: string | null;
  campaignId: string | null;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
};
type Page = { items: DeliveryRow[]; total: number; page: number; pageSize: number; totalPages: number; nextCursor?: string | null; capped?: boolean };
type Summary = Record<string, Record<string, number>>;

const STORAGE_KEY = "filters:delivery";
const VIRTUAL_MIN = 80;
const ROW_H = 36;
const ROW_BLOCK = 8;
const ROW_OVERSCAN = 30;
const CACHE_TTL_MS = 20_000;
const LIVE_MS = 5_000;
const GRID = "lg:grid lg:grid-cols-[150px_104px_82px_minmax(0,1fr)_minmax(0,1.5fr)_150px_130px] lg:gap-3";

const fldCls = (val: string | boolean) =>
  `h-8 min-w-0 max-w-full appearance-none sel-arrow rounded-lg border pl-2 pr-7 text-xs outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;
const txtCls = (val: string) =>
  `h-8 min-w-0 rounded-lg border px-2 text-xs outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand placeholder:font-normal" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;

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

/** Un rând (înălțime fixă; memoizat: la derulare se desenează doar rândurile noi din fereastră). */
const DeliveryTr = memo(function DeliveryTr({ r, tag, onOpen }: { r: DeliveryRow; tag: string; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <div
      role="row"
      tabIndex={0}
      onClick={() => onOpen(r.id)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(r.id)}
      className={`flex cursor-pointer items-center gap-x-2 overflow-hidden whitespace-nowrap border-t border-[var(--color-line)] px-3 text-[13px] outline-none hover:bg-[var(--color-surface-2)] focus-visible:bg-[var(--color-surface-2)] ${GRID} ${r.status === "FAILED" ? "bg-st-cancelled/5" : ""}`}
      style={{ height: ROW_H, contain: "layout style" }}
    >
      <span className="shrink-0 font-mono text-[11px] tabular-nums text-ink-soft">{fmtStamp(r.createdAt, tag)}</span>
      <span className="shrink-0">
        <span className={`inline-block max-w-full truncate rounded-full px-2 py-px text-[10px] font-semibold ${CHANNEL_CLS[r.channel] ?? ""}`}>{CHANNEL_ICON[r.channel]} {t(CHANNEL_LABEL[r.channel] ?? r.channel)}</span>
      </span>
      <span className="shrink-0" title={r.error ?? undefined}>
        <span className={`inline-block rounded-full px-2 py-px text-[10px] font-semibold ${STATUS_CLS[r.status] ?? ""}`}>{t(STATUS_LABEL[r.status] ?? r.status)}</span>
      </span>
      <span className="hidden min-w-0 truncate lg:block" title={[r.toName, r.to].filter(Boolean).join(" · ")}>
        <span className="font-medium">{r.toName ?? r.to ?? "—"}</span>
        {r.toName && r.to && <span className="ml-1.5 text-[11px] text-ink-soft">{r.to}</span>}
      </span>
      <span className="min-w-0 flex-1 truncate lg:flex-none" title={r.error ?? r.subject ?? r.preview ?? undefined}>
        {r.error && r.status !== "SENT" ? (
          <span className="text-st-cancelled">{r.error}</span>
        ) : (
          <>
            <span className="font-medium">{r.subject ?? r.preview ?? "—"}</span>
            {r.subject && r.preview && <span className="ml-1.5 text-[11px] text-ink-soft">{r.preview}</span>}
          </>
        )}
      </span>
      <span className="hidden min-w-0 truncate text-[12px] text-ink-soft lg:block">{kindLabel(r.kind, t)}</span>
      <span className="hidden min-w-0 truncate text-[12px] text-ink-soft lg:block" title={sourceLabel(r.source, t)}>{r.fromName ?? sourceLabel(r.source, t)}</span>
    </div>
  );
});

/** Tabelul (antet + rânduri virtualizate; cu „Toate”, rândurile neîncărcate încă sunt goale și se umplu singure). */
const DeliveryTable = memo(function DeliveryTable({
  rows,
  rowCount,
  loading,
  tag,
  onOpen,
  resetKey,
  t,
}: {
  rows: DeliveryRow[];
  rowCount: number;
  loading: boolean;
  tag: string;
  onOpen: (id: string) => void;
  resetKey: string;
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
        <span>{t("Data & ora")}</span>
        <span>{t("Canal")}</span>
        <span>{t("Status")}</span>
        <span>{t("Destinatar")}</span>
        <span>{t("Mesaj")}</span>
        <span>{t("Tip")}</span>
        <span>{t("De la")}</span>
      </div>
      {winStart > 0 && <div aria-hidden style={{ height: winStart * ROW_H }} />}
      {shown.map((r) => <DeliveryTr key={r.id} r={r} tag={tag} onOpen={onOpen} />)}
      {skeletons > 0 &&
        Array.from({ length: skeletons }, (_, k) => (
          <div key={`sk-${Math.max(winStart, rows.length) + k}`} aria-hidden className="border-t border-[var(--color-line)] px-3 text-xs leading-[35px] text-ink-soft/40" style={{ height: ROW_H }}>…</div>
        ))}
      {winEnd < rowCount && <div aria-hidden style={{ height: (rowCount - winEnd) * ROW_H }} />}
    </div>
  );
});

export default function DeliveryLogsClient({
  initial,
  users,
  initialFilters,
  initialPage,
  initialPs,
  apiBase = "/api/admin/delivery",
  pageBase = "/admin/jurnal-notificari",
  pageParams = "",
  kindOptions = KIND_OPTIONS,
  storageKey = STORAGE_KEY,
}: {
  initial: Page;
  users: Opt[];
  initialFilters: DeliveryFilterState;
  initialPage: number;
  initialPs: DeliveryPs;
  /** Rutele API ale jurnalului (lista, rezumat, detalii, export). Implicit: jurnalul complet al super-adminilor. */
  apiBase?: string;
  /** Pagina în care stă jurnalul (adresa se sincronizează cu filtrele) + parametrii fixi ai paginii (ex. „view=jurnal”). */
  pageBase?: string;
  pageParams?: string;
  /** Tipurile de mesaje din filtrul „Tip” (jurnalul plătitorilor are doar cele către plătitori). */
  kindOptions?: readonly { key: string; label: string }[];
  storageKey?: string;
}) {
  const t = useT();
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag);

  const [filters, setFilters] = useState<DeliveryFilterState>(initialFilters);
  const [draftQ, setDraftQ] = useState(initialFilters.q);
  const [page, setPage] = useState(initialPage);
  const [ps, setPs] = useState<DeliveryPs>(initialPs);
  const [data, setData] = useState<Page>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [live, setLive] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const qTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dataRef = useRef(data);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const all = ps === "all";
  const key = useMemo(() => deliveryStateToParams(filters, { page: all ? 1 : page, ps }).toString(), [filters, page, ps, all]);
  const loadedKey = useRef(deliveryStateToParams(initialFilters, { page: initialPage, ps: initialPs }).toString());
  const allRef = useRef<{ key: string; cursor: string | null }>({ key: initialPs === "all" ? loadedKey.current : "", cursor: initial.nextCursor ?? null });
  const cache = useRef(new Map<string, { data: Page; at: number }>());
  useEffect(() => {
    if (initialPs !== "all" && cache.current.size === 0) cache.current.set(loadedKey.current, { data: initial, at: Date.now() });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Restaurează filtrele salvate (doar dacă adresa nu are propriile filtre).
  useEffect(() => {
    if (key === "") {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
          const sp = new URLSearchParams(saved);
          const f = sanitizeDeliveryState(Object.fromEntries(sp.entries()));
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setFilters(f);
          setDraftQ(f.q);
          setPs(normalizeDeliveryPs(sp.get("ps")));
        }
      } catch {}
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adresa (link de partajat), filtrele salvate și alegerea „câte pe pagină” (cookie).
  useEffect(() => {
    if (!ready) return;
    const p = deliveryStateToParams(filters, { ps });
    try {
      if (p.toString()) localStorage.setItem(storageKey, p.toString());
      else localStorage.removeItem(storageKey);
      document.cookie = `${DELIVERY_PS_COOKIE}=${ps}; path=/; max-age=31536000; samesite=lax`;
    } catch {}
    const qs = [pageParams, key].filter(Boolean).join("&");
    window.history.replaceState(null, "", `${pageBase}${qs ? `?${qs}` : ""}`);
  }, [key, filters, ps, ready, pageBase, pageParams, storageKey]);

  // Rezumatul ultimelor 24 h (se reîmprospătează odată cu lista).
  useEffect(() => {
    if (!ready) return;
    const ctl = new AbortController();
    fetch(`${apiBase}/summary`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setSummary(j as Summary))
      .catch(() => {});
    return () => ctl.abort();
  }, [ready, tick, apiBase]);

  // Pagini numerice: din cache dacă am mai văzut-o (reîmprospătată discret după 20 s), altfel de la server; o cerere nouă o anulează pe cea veche.
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
    fetch(`${apiBase}?${key}${tick > 0 ? "&fresh=1" : ""}`, { signal: ctl.signal })
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

  // „Toate”: bucăți aduse una după alta (prima mică, următoarele mari), cu cursor; lista crește pe măsură ce vin.
  useEffect(() => {
    if (!ready || !all) return;
    const resume = allRef.current.key === key && tick === 0;
    let cursor = resume ? allRef.current.cursor : null;
    let acc: DeliveryRow[] = resume ? dataRef.current.items : [];
    if (resume && !cursor) return;
    const ctl = new AbortController();
    if (!resume) allRef.current = { key, cursor: null };
     
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        let first = acc.length === 0;
        for (;;) {
          const qs = `${key}${tick > 0 && first ? "&fresh=1" : ""}&limit=${first ? DELIVERY_FIRST_CHUNK : DELIVERY_NEXT_CHUNK}&loaded=${acc.length}${cursor ? `&cursor=${cursor}` : ""}`;
          const r = await fetch(`${apiBase}?${qs}`, { signal: ctl.signal });
          const j = (await r.json()) as { items: DeliveryRow[]; total: number; nextCursor: string | null; capped: boolean; error?: string };
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
     
  }, [key, ready, tick, all, apiBase]);

  function setFilter(patch: Partial<DeliveryFilterState>) {
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
    setFilters(EMPTY_DELIVERY_FILTERS);
    setDraftQ("");
    setPage(1);
  }
  const refresh = useCallback(() => {
    cache.current.clear();
    loadedKey.current = "";
    allRef.current = { key: "", cursor: null };
    setTick((n) => n + 1);
  }, []);

  // „Live”: lista (prima pagină, cele mai noi) se reîmprospătează singură la 5 secunde, cât timp fila e vizibilă — pentru urmărit trimiterile pe măsură ce pleacă.
  useEffect(() => {
    if (!live || all || page !== 1) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, LIVE_MS);
    return () => clearInterval(id);
  }, [live, all, page, refresh]);

  const active = countActiveDeliveryFilters({ ...filters, q: draftQ.trim() });
  const exportQs = deliveryStateToParams(filters).toString();

  const items = data.items;
  const rowCount = all ? Math.min(data.total, DELIVERY_ALL_CAP) : items.length;
  const from = data.total === 0 ? 0 : (data.page - 1) * data.pageSize + 1;
  const to = Math.min(data.page * data.pageSize, data.total);
  const buttons = buildPageButtons(data.page, data.totalPages);
  const selIdx = selId ? items.findIndex((r) => r.id === selId) : -1;
  const onOpen = useCallback((id: string) => setSelId(id), [setSelId]);
  const loadedAll = all && !data.nextCursor;

  return (
    <>
      {/* ── Rezumat ultimele 24 h (click pe un canal îl filtrează) ─────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-ink-soft">{t("Ultimele 24 h")}:</span>
        {DELIVERY_CHANNELS.map((c) => {
          const s = summary?.[c] ?? {};
          const total = (s.SENT ?? 0) + (s.FAILED ?? 0) + (s.SKIPPED ?? 0);
          return (
            <button
              key={c}
              type="button"
              onClick={() => setFilter({ channel: filters.channel === c ? "" : c })}
              aria-pressed={filters.channel === c}
              title={t("Filtrează după canal")}
              className={`tap inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-2 ${filters.channel === c ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] hover:bg-[var(--color-surface-2)]"}`}
            >
              <span aria-hidden>{CHANNEL_ICON[c]}</span>
              <span>{t(CHANNEL_LABEL[c])}</span>
              <b className="tabular-nums">{summary ? nf(total) : "…"}</b>
              {(s.FAILED ?? 0) > 0 && <span className="rounded bg-st-cancelled/15 px-1 text-[10px] font-semibold text-st-cancelled">✗ {s.FAILED}</span>}
              {(s.SKIPPED ?? 0) > 0 && <span className="rounded bg-st-progress/15 px-1 text-[10px] font-semibold text-st-progress">⊘ {s.SKIPPED}</span>}
            </button>
          );
        })}
      </div>

      {/* ── Filtre ──────────────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input
          value={draftQ}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={t("Caută: destinatar, adresă, subiect, mesaj, eroare…")}
          title={t("Minimum 2 caractere. Caută în destinatar, adresă, subiect, textul mesajului, eroare, obiect și ID furnizor.")}
          aria-label={t("Căutare")}
          className={`${txtCls(draftQ)} min-w-52 flex-1`}
        />
        <select value={filters.channel} onChange={(e) => setFilter({ channel: e.target.value })} className={fldCls(filters.channel)} aria-label={t("Canal")}>
          <option value="">{t("Canal: toate")}</option>
          {DELIVERY_CHANNELS.map((c) => <option key={c} value={c}>{CHANNEL_ICON[c]} {t(CHANNEL_LABEL[c])}</option>)}
        </select>
        <select value={filters.status} onChange={(e) => setFilter({ status: e.target.value })} className={fldCls(filters.status)} aria-label={t("Status")}>
          <option value="">{t("Status: toate")}</option>
          {DELIVERY_STATUSES.map((s) => <option key={s} value={s}>{t(STATUS_LABEL[s])}</option>)}
        </select>
        <label className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs ${filters.problems ? "border-st-cancelled bg-st-cancelled/10 font-semibold text-st-cancelled" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"}`} title={t("Doar mesajele eșuate sau omise")}>
          <input type="checkbox" checked={filters.problems} onChange={(e) => setFilter({ problems: e.target.checked })} className="size-3 accent-[var(--color-brand)]" />
          {t("Doar probleme")}
        </label>
        <select value={filters.kind} onChange={(e) => setFilter({ kind: e.target.value })} className={fldCls(filters.kind)} aria-label={t("Tip mesaj")}>
          <option value="">{t("Tip: toate")}</option>
          {kindOptions.map((k) => <option key={k.key} value={k.key}>{t(k.label)}</option>)}
        </select>
        <select value={filters.source} onChange={(e) => setFilter({ source: e.target.value })} className={fldCls(filters.source)} aria-label={t("Sursa")}>
          <option value="">{t("Sursa: toate")}</option>
          {SOURCE_OPTIONS.map((s) => <option key={s.key} value={s.key}>{t(s.label)}</option>)}
        </select>
        <select value={filters.sender} onChange={(e) => setFilter({ sender: e.target.value })} className={fldCls(filters.sender)} aria-label={t("Declanșat de")}>
          <option value="">{t("Declanșat de: oricine")}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={filters.recipient} onChange={(e) => setFilter({ recipient: e.target.value })} className={fldCls(filters.recipient)} aria-label={t("Destinatar utilizator")}>
          <option value="">{t("Destinatar: oricine")}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={filters.objectType} onChange={(e) => setFilter({ objectType: e.target.value })} className={fldCls(filters.objectType)} aria-label={t("Obiect legat")}>
          <option value="">{t("Obiect: toate")}</option>
          {OBJECT_TYPES.map((o) => <option key={o.key} value={o.key}>{t(o.label)}</option>)}
        </select>
        <span className="flex items-center gap-1" title={t("Perioada (ziua în fusul orar al firmei)")}>
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter({ from: e.target.value })} aria-label={t("De la data")} className={txtCls(filters.from)} />
          <span className="text-ink-soft">–</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter({ to: e.target.value })} aria-label={t("Până la data")} className={txtCls(filters.to)} />
        </span>
        {filters.campaign && (
          <button type="button" onClick={() => setFilter({ campaign: "" })} className="tap h-8 rounded-lg border border-brand bg-brand/10 px-2 text-xs font-semibold text-brand" title={t("Scoate filtrul de campanie")}>
            {t("Campanie")}: …{filters.campaign.slice(-6)} ✕
          </button>
        )}
        {active > 0 && (
          <button type="button" onClick={clearAll} className="tap h-8 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]">
            {t("✕ Filtre")}{` (${active})`}
          </button>
        )}
      </div>

      {/* ── Sumar + acțiuni ─────────────────────────────────────────────────── */}
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span><b>{nf(data.total)}</b> {t("mesaje")}{active > 0 ? ` ${t("(filtrat)")}` : ""}</span>
        {data.total > 0 && !all && (
          <span className="text-ink-soft">
            {t("afișate {from}–{to} din {total}", { from: nf(from), to: nf(to), total: nf(data.total) })}
            {data.totalPages > 1 ? ` · ${t("pagina {cur}/{pages}", { cur: data.page, pages: data.totalPages })}` : ""}
          </span>
        )}
        {all && data.total > 0 && <span className="text-ink-soft">{loadedAll ? t("toate încărcate") : t("încărcate {n} din {total}…", { n: nf(items.length), total: nf(rowCount) })}</span>}
        {loading && !all && <span className="text-ink-soft">{t("se încarcă…")}</span>}
        <button type="button" onClick={refresh} disabled={loading} title={t("Reîncarcă jurnalul")} className="tap cursor-pointer text-ink-soft hover:text-brand disabled:cursor-default">
          ↻ {t("Reîmprospătează")}
        </button>
        <label className={`flex cursor-pointer items-center gap-1.5 ${live ? "font-semibold text-st-done" : "text-ink-soft"}`} title={t("Reîmprospătează automat la 5 secunde (prima pagină, cele mai noi mesaje)")}>
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} disabled={all} className="size-3 accent-[var(--color-brand)]" />
          {live && !all ? "● " : ""}{t("Live")}
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-soft">
            {t("Afișează")}
            <select
              value={String(ps)}
              onChange={(e) => { setPs(normalizeDeliveryPs(e.target.value)); setPage(1); }}
              className={fldCls(ps === DELIVERY_DEFAULT_PAGE_SIZE ? "" : "x")}
              aria-label={t("Rânduri pe pagină")}
            >
              {DELIVERY_PAGE_SIZES.map((n) => <option key={n} value={n}>{t("{n} / pagină", { n })}</option>)}
              <option value="all">{t("Toate")}</option>
            </select>
          </label>
          <a href={`${apiBase}/export${exportQs ? `?${exportQs}` : ""}`} download className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]" title={t("Exportă mesajele filtrate (CSV, maximum 10.000)")}>
            ⬇ CSV
          </a>
        </div>
      </div>

      {all && data.total > DELIVERY_ALL_CAP && (
        <p className="mb-2 rounded-lg bg-st-progress/10 px-3 py-2 text-xs text-st-progress">
          {t("Se afișează cele mai noi {cap} din {total} mesaje. Restrânge filtrele (perioadă, canal, tip) sau exportă.", { cap: nf(DELIVERY_ALL_CAP), total: nf(data.total) })}
        </p>
      )}
      {error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {t(error)}
          <button type="button" onClick={refresh} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
        </p>
      )}
      {loading && <div className="mb-1 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}

      {rowCount === 0 ? (
        <div className="card grid place-items-center p-10 text-center text-sm text-ink-soft">
          {active > 0 ? t("Niciun mesaj cu filtrele acestea.") : t("Nicio trimitere înregistrată încă. Jurnalul se umple pe măsură ce aplicația trimite emailuri, SMS-uri, mesaje Telegram și notificări.")}
        </div>
      ) : (
        <DeliveryTable rows={items} rowCount={rowCount} loading={loading && !all} tag={tag} onOpen={onOpen} resetKey={key} t={t} />
      )}

      {!all && data.total > 0 && data.totalPages > 1 && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1">
          <button disabled={data.page <= 1} onClick={() => setPage(data.page - 1)} className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40" aria-label={t("Pagina anterioară")}>
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
          <button disabled={data.page >= data.totalPages} onClick={() => setPage(data.page + 1)} className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40" aria-label={t("Pagina următoare")}>
            <IconChevronRight className="size-4" />
          </button>
        </div>
      )}

      {selId && (
        <DeliveryDetailDialog
          key={selId}
          id={selId}
          apiBase={apiBase}
          preview={items.find((r) => r.id === selId) ?? null}
          onClose={() => setSelId(null)}
          onPrev={selIdx > 0 ? () => setSelId(items[selIdx - 1].id) : undefined}
          onNext={selIdx >= 0 && selIdx < items.length - 1 ? () => setSelId(items[selIdx + 1].id) : undefined}
          onOpen={setSelId}
          onFilter={(patch) => {
            setSelId(null);
            setFilter(patch);
          }}
        />
      )}
    </>
  );
}
