"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { setInvoiceStatus, deleteInvoice } from "@/app/actions/invoices";
import {
  INVOICE_STATUS,
  INVOICE_STATUS_LIST,
  money,
  fmtDate,
  type InvoiceStatusKey,
} from "./invoice-meta";
import { useToast } from "./toast";
import { IconTrash, IconChevronLeft, IconChevronRight } from "./icons";
import { useMessages } from "@/lib/i18n/context";
import ApaCanalJsonImport from "./ApaCanalJsonImport";
import InvoiceViewButton from "./InvoiceViewButton";
import CompactCard, { CompactField } from "./CompactCard";
import VirtualList from "./VirtualList";
import { useInvoiceDataset, useInvoiceMonths } from "./useInvoiceDataset";
import { buildPageButtons } from "@/lib/page-buttons";
import { perPageLabel } from "@/lib/payer-notify";
import { INVOICES_PS_COOKIE } from "@/lib/payer-prefs";
import {
  EMPTY_QUERY,
  INVOICE_ALL,
  INVOICE_DEFAULT_PER_PAGE,
  INVOICE_PER_PAGE,
  activeFilterCount,
  periodFitsLocally,
  periodMonths,
  queryInvoices,
  groupServiceRows,
  queryToParams,
  sumServiceReport,
  type InvQuery,
  type InvServiceRow,
  type InvSort,
  type InvSums,
  type InvoiceListItem,
  type InvRow,
  type MonthCount,
} from "@/lib/invoice-list";
import { useT } from "@/lib/i18n/context";

/** Peste atâtea rânduri se desenează doar cele vizibile (virtualizare), ca la plătitori. */
const VIRTUAL_MIN = 80;
const ROW_H = 28;
/** Cât timp lista locală nu e încărcată (sau perioada e prea mare), serverul dă pagini de cel mult atâtea rânduri. */
const SERVER_MAX_PENDING = 200;
const SERVER_MAX_SERVER_MODE = 1000;
/** Lățimile coloanelor tabelului (px): număr, client, emisă, scadență, achitată, sumă, datorie / avans, achitat din factură, status, acțiuni. */
const COL_W = [250, 230, 92, 92, 92, 105, 100, 100, 105, 270];

type Page = { items: InvRow[]; total: number; totalPages: number; sums: InvSums | null };

const fromItem = (i: InvoiceListItem): InvRow => ({
  id: i.id, number: i.number, status: i.status, kind: i.kind, issueMs: Date.parse(i.issueDate), dueMs: i.dueDate ? Date.parse(i.dueDate) : null,
  paidMs: i.paidAt ? Date.parse(i.paidAt) : null, grandTotal: i.grandTotal, currency: i.currency, clientName: i.clientName, publicToken: i.publicToken, svc: 0, debt: i.debt ?? 0, paid: i.paid ?? null, prevPaid: i.prevPaid ?? null, _x: null, _h: "",
});

/** Momentul curent (în afara componentei, ca randarea să rămână pură). */
function nowMs(): number {
  return Date.now();
}

const fmtMs = (ms: number | null) => (ms == null ? "—" : fmtDate(new Date(ms)));
const fmtMoney = (n: number, cur: string) => `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, mo - 1, 1).toLocaleDateString("ro-RO", { month: "long", year: "numeric" });
};

/** Sortările pe care le face și serverul (cu index); restul doar în browser, pe perioada încărcată. */
const SERVER_SORTS = new Set(["issue", "number"]);
const TEXT_SORTS = new Set(["number", "client", "status"]);

const SERVICE_FILTERS = [["WATER", "Doar apă"], ["SEWER", "Doar canalizare"], ["BOTH", "Apă + canalizare"], ["NONE", "Fără servicii (consum și sumă zero)"]] as const;

const hasAdvanced = (q: InvQuery) =>
  !!(q.min || q.max || q.currency || q.issueFrom || q.issueTo || q.dueFrom || q.dueTo || q.paidFrom || q.paidTo);

const filterCls = (on: boolean) =>
  `h-7 appearance-none sel-arrow rounded-lg border pl-1.5 pr-6 text-[11px] outline-none focus:border-brand ${
    on ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)]"
  }`;
const inputCls = (on: boolean) =>
  `h-7 rounded-lg border px-1.5 text-[11px] outline-none focus:border-brand ${
    on ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)]"
  }`;

export default function InvoicesList({
  initial,
  origin,
  canImportApaCanal = false,
  canCreate = false,
  canEdit = false,
  canDelete = false,
}: {
  initial: { items: InvoiceListItem[]; page: number; total: number; totalPages: number; perPage: number; query: InvQuery; period: string; months: MonthCount[]; sums: InvSums | null };
  origin: string;
  canImportApaCanal?: boolean;
  /** Permisiunile „Creare / Editare / Ștergere" la facturi: fără ele butoanele dispar, iar statusul nu se mai poate schimba. */
  canCreate?: boolean;
  canEdit?: boolean;
  canDelete?: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const m = useMessages();

  // ── Filtrele sunt locale (schimbarea lor e instantanee în UI); adresa se sincronizează fără navigare ──
  const [query, setQuery] = useState<InvQuery>(initial.query);
  const [search, setSearch] = useState(initial.query.q);
  const [period, setPeriod] = useState(initial.period);
  const [page, setPage] = useState(initial.page);
  const [wantPerPage, setWantPerPage] = useState(initial.perPage);
  const [showMore, setShowMore] = useState(() => hasAdvanced(initial.query));
  const [goto, setGoto] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState<{ period: string; rows: InvServiceRow[]; incomplete: boolean } | null>(null);
  const [reportErr, setReportErr] = useState<string | null>(null);
  const [reportTick, setReportTick] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusMenu = useRef<HTMLDetailsElement>(null);

  // Mod telefon: fiecare factură devine un card. `cardsPref` = alegerea utilizatorului; null = automat (carduri pe ecrane înguste).
  const [cardsPref, setCardsPref] = useState<boolean | null>(null);
  const [narrow, setNarrow] = useState(false);
  const cards = cardsPref ?? narrow;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNarrow(window.matchMedia("(max-width: 639px)").matches);
    try {
      const v = localStorage.getItem("invoices-view");
      if (v === "cards" || v === "table") setCardsPref(v === "cards");
    } catch {}
  }, []);
  function toggleCards() {
    const next = !cards;
    setCardsPref(next);
    try { localStorage.setItem("invoices-view", next ? "cards" : "table"); } catch {}
  }
  useEffect(() => {
    // meniul de statusuri se închide la click în afara lui
    const close = (e: MouseEvent) => {
      const el = statusMenu.current;
      if (el?.open && !el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  // ── Motor local (lunile perioadei în browser) sau pagini de pe server ──
  const months = useInvoiceMonths(initial.months);
  const fits = periodFitsLocally(period, months);
  const monthList = useMemo(() => periodMonths(period, months), [period, months]);
  const ds = useInvoiceDataset(fits ? monthList : null);
  const useLocal = !!ds.rows;
  const serverMode = !fits;
  const perPage = useLocal ? wantPerPage : Math.min(wantPerPage, serverMode ? SERVER_MAX_SERVER_MODE : SERVER_MAX_PENDING);
  // Controalele se actualizează imediat; lista (zeci de mii de rânduri) se recalculează în randarea următoare (amânată).
  const dQuery = useDeferredValue(query);
  const local = useMemo(() => (ds.rows ? queryInvoices(ds.rows, dQuery) : null), [ds.rows, dQuery]);

  const [data, setData] = useState<Page>(() => ({ items: initial.items.map(fromItem), total: initial.total, totalPages: initial.totalPages, sums: initial.sums }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, Page>());
  const abortRef = useRef<AbortController | null>(null);
  const qKey = JSON.stringify(query);
  const key = `${qKey}|${period}|${page}|${perPage}`;
  // Pagina primită de la server are cel mult 100 de rânduri (vezi page.tsx); pentru alt număr de rânduri aducem pagina potrivită.
  const initialKey = useRef(`${JSON.stringify(initial.query)}|${initial.period}|${initial.page}|${Math.min(initial.perPage, 100)}`);
  const [reloadTick, setReloadTick] = useState(0);

  useEffect(() => {
    if (useLocal) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      setError(null);
      return;
    }
    const hit = cache.current.get(key);
    if (hit) setData(hit);
    if (!hit && key === initialKey.current && reloadTick === 0) return; // prima pagină vine deja de la server
    if (hit && reloadTick === 0) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setError(null);
    const sp = queryToParams(query);
    sp.delete("svc"); // căutarea pe server (perioade mari) nu filtrează pe servicii
    sp.set("p", period);
    sp.set("page", String(page));
    sp.set("ps", String(perPage));
    // Cât timp lista locală încă se încarcă (IndexedDB / rețea), nu pornim imediat o cerere de pagină care oricum ar fi anulată peste câteva zeci de ms.
    const wait = fits && !ds.rows && reloadTick === 0 ? 350 : 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      setLoading(true);
      fetch(`/api/invoices/list?${sp}`, { signal: ctl.signal })
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? m.common.error);
          return j as { items: InvoiceListItem[]; total: number; totalPages: number; page: number; sums: InvSums | null };
        })
        .then((j) => {
          const next: Page = { items: j.items.map(fromItem), total: j.total, totalPages: j.totalPages, sums: j.sums };
          cache.current.set(key, next);
          if (cache.current.size > 40) cache.current.delete(cache.current.keys().next().value!);
          setData(next);
          setLoading(false);
          if (j.page !== page) setPage(j.page);
        })
        .catch((e: Error) => {
          if (e.name === "AbortError") return;
          setError(t(e.message));
          setLoading(false);
        });
    };
    if (wait) timer = setTimeout(run, wait);
    else run();
    return () => {
      if (timer) clearTimeout(timer);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, useLocal, reloadTick]);

  const view: Page = useMemo(() => {
    if (!local || !ds.rows) return data;
    const from = (page - 1) * perPage;
    const items: InvRow[] = [];
    for (let k = from; k < Math.min(local.total, from + perPage); k++) items.push(ds.rows[local.idx[k]]);
    return { items, total: local.total, totalPages: Math.max(1, Math.ceil(local.total / perPage)), sums: local.sums };
  }, [local, ds.rows, page, perPage, data]);
  const totalPages = Math.max(1, Math.ceil(view.total / perPage));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (local && page > totalPages) setPage(totalPages);
  }, [local, page, totalPages]);
  const rows = view.items;
  const currencies = useMemo(() => (ds.rows ? [...new Set(ds.rows.map((r) => r.currency))].sort() : []), [ds.rows]);

  // Adresa (link de partajat) fără navigare; alegerea „câte pe pagină" se ține și într-un cookie, pentru randarea pe server.
  useEffect(() => {
    const sp = queryToParams(query);
    sp.set("m", period);
    if (page > 1) sp.set("page", String(page));
    if (wantPerPage !== INVOICE_DEFAULT_PER_PAGE) sp.set("ps", String(wantPerPage));
    window.history.replaceState(null, "", `/invoices?${sp}`);
    try { document.cookie = `${INVOICES_PS_COOKIE}=${wantPerPage}; path=/; max-age=31536000; samesite=lax`; } catch {}
  }, [query, period, page, wantPerPage]);

  function patchQuery(p: Partial<InvQuery>) {
    setQuery((q) => ({ ...q, ...p }));
    setPage(1);
  }
  function onSearch(v: string) {
    setSearch(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => patchQuery({ q: v.trim() }), ds.rows ? 120 : 300);
  }
  function toggleStatus(s: string) {
    patchQuery({ statuses: query.statuses.includes(s) ? query.statuses.filter((x) => x !== s) : [...query.statuses, s] });
  }
  function toggleSort(col: InvSort) {
    if (serverMode && !SERVER_SORTS.has(col)) return;
    setQuery((q) => (q.sort === col ? { ...q, dir: q.dir === "asc" ? "desc" : "asc" } : { ...q, sort: col, dir: TEXT_SORTS.has(col) ? "asc" : "desc" }));
    setPage(1);
  }
  const nFilters = activeFilterCount(query) + (search.trim() && !query.q ? 1 : 0);
  function resetFilters() {
    if (debounce.current) clearTimeout(debounce.current);
    setSearch("");
    setQuery(EMPTY_QUERY);
    setPage(1);
  }
  function changePeriod(p: string) {
    setPeriod(p);
    setPage(1);
  }
  const years = useMemo(() => [...new Set(months.map((x) => x.month.slice(0, 4)))], [months]);

  // ── Acțiuni pe rând: optimist (se vede pe loc), la eșec revenim ──
  const patchEverywhere = useCallback((id: string, patch: Partial<InvRow>) => {
    ds.patchInvoice(id, patch);
    setData((d) => ({ ...d, items: d.items.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
    cache.current.clear();
  }, [ds]);

  function changeStatus(id: string, s: InvoiceStatusKey) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const prev = { status: row.status, paidMs: row.paidMs };
    patchEverywhere(id, { status: s, paidMs: s === "PAID" ? (row.paidMs ?? nowMs()) : null });
    setInvoiceStatus(id, s).then((res) => {
      if (!res.ok) {
        patchEverywhere(id, prev);
        toast.error(res.error ?? m.common.error);
      } else {
        setReportTick((n) => n + 1);
        toast.success(`Status: ${INVOICE_STATUS[s].label}`);
      }
    });
  }

  function remove(id: string) {
    if (!confirm(m.invoices.deleteConfirm)) return;
    const prevRows = ds.snapshotRows();
    const prevData = data;
    ds.removeInvoice(id);
    setData((d) => ({ ...d, items: d.items.filter((r) => r.id !== id), total: Math.max(0, d.total - 1) }));
    cache.current.clear();
    deleteInvoice(id)
      .then(() => setReportTick((n) => n + 1))
      .then(() => toast.success(m.invoices.deleted))
      .catch(() => {
        if (prevRows) ds.restoreRows(prevRows);
        setData(prevData);
        toast.error(m.invoices.deleteFailed);
      });
  }

  async function copyLink(token: string) {
    const url = `${origin}/invoice/public/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(token);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      prompt(m.invoices.copyLink + ":", url);
    }
  }

  // ── Raport pe servicii (apă / canalizare / amândouă) ──
  // Perioada încape în browser: se calculează INSTANT din facturile deja încărcate (nicio cerere; se actualizează și la schimbarea unui status). Perioadă prea mare (căutare pe server):
  // o singură cerere, la care serverul răspunde din snapshot-urile lunilor din memorie, nu din baza de date.
  const localReport = useMemo(() => (showReport && ds.rows ? groupServiceRows(ds.rows) : null), [showReport, ds.rows]);
  useEffect(() => {
    if (!showReport || !serverMode) return;
    const ctl = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReportErr(null);
    fetch(`/api/invoices/report?p=${encodeURIComponent(period)}`, { signal: ctl.signal })
      .then(async (r) => {
        // un răspuns care nu e JSON (expirare, eroare de platformă) nu trebuie să ajungă ca text tehnic în panou
        const j = (await r.json().catch(() => null)) as { error?: string; rows?: InvServiceRow[]; incomplete?: boolean } | null;
        if (!r.ok || !j?.rows) throw new Error(j?.error ?? "Nu am putut calcula raportul.");
        setReport({ period, rows: j.rows, incomplete: !!j.incomplete });
      })
      .catch((e: Error) => {
        if (e.name !== "AbortError") setReportErr(t(e.message));
      });
    return () => ctl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReport, period, reportTick, serverMode]);
  const reportRows = localReport ?? (report && report.period === period ? report.rows : null);
  const reportIncomplete = localReport ? ds.incomplete : !!report?.incomplete;
  const reportSum = useMemo(
    () => (reportRows ? sumServiceReport(reportRows, query.currency) : null),
    [reportRows, query.currency],
  );

  // Contoarele chipurilor „Plăți” (pe perioada aleasă, din facturile deja încărcate): o singură trecere
  const payCounts = useMemo(() => {
    const c = { paid: 0, unpaid: 0, overdue: 0, debt: 0, advance: 0, paidprev: 0, partial: 0 };
    if (!ds.rows) return null;
    for (const r of ds.rows) {
      if (r.status === "PAID") c.paid++;
      else if (r.status === "SENT" || r.status === "OVERDUE") {
        c.unpaid++;
        if (r.status === "OVERDUE") c.overdue++;
        if (r.paid != null && r.paid > 0.005) c.partial++;
      }
      if (r.kind === "APA_CANAL") {
        if (r.debt > 0.005) c.debt++;
        else if (r.debt < -0.005) c.advance++;
      }
      if (r.prevPaid != null && r.prevPaid > 0.005) c.paidprev++;
    }
    return c;
  }, [ds.rows]);

  const pageTotal = useMemo(() => rows.reduce((sum, r) => sum + (r.status === "CANCELLED" ? 0 : r.grandTotal), 0), [rows]);

  // ── Virtualizare (tabel: înălțime fixă de rând; carduri: înălțime variabilă) ──
  const virtualTable = !cards && rows.length > VIRTUAL_MIN;
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollRaf = useRef(0);
  const [vScroll, setVScroll] = useState({ top: 0, h: 800 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !virtualTable) return;
    const upd = () => setVScroll((s) => (s.h === el.clientHeight ? s : { ...s, h: el.clientHeight }));
    upd();
    const obs = new ResizeObserver(upd);
    obs.observe(el);
    return () => obs.disconnect();
  }, [virtualTable]);
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [query, period, page, perPage, cards]);
  function onTableScroll(e: React.UIEvent<HTMLDivElement>) {
    const top = e.currentTarget.scrollTop;
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      setVScroll((s) => (s.top === top ? s : { ...s, top }));
    });
  }
  const winStart = virtualTable ? Math.max(0, Math.floor(vScroll.top / ROW_H) - 12) : 0;
  const winEnd = virtualTable ? Math.min(rows.length, Math.ceil((vScroll.top + vScroll.h) / ROW_H) + 12) : rows.length;
  const winRows = virtualTable ? rows.slice(winStart, winEnd) : rows;
  const renderRows = (list: InvRow[], fn: (r: InvRow) => React.ReactNode) =>
    list.length <= VIRTUAL_MIN ? list.map(fn) : <VirtualList count={list.length} itemKey={(i) => list[i].id} render={(i) => fn(list[i])} estimate={46} />;

  const from = view.total === 0 ? 0 : (page - 1) * perPage + 1;
  const to = Math.min(page * perPage, view.total);

  return (
    <>
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <input
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          placeholder={m.invoices.searchPlaceholder}
          className={`h-7 min-w-48 flex-1 rounded-lg border px-2 text-[11px] outline-none focus:border-brand ${
            search ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)]"
          }`}
        />
        <select value={period} onChange={(e) => changePeriod(e.target.value)} className={filterCls(false)} aria-label={t("Perioadă")} data-inv-period="">
          <option value="all">{t("Toate lunile")}</option>
          {months.length > 3 && <option value="last3">{t("Ultimele 3 luni")}</option>}
          {years.length > 1 && years.map((y) => <option key={y} value={`year:${y}`}>{t("Anul {v1}", { v1: y })}</option>)}
          {months.map((x) => <option key={x.month} value={x.month}>{monthLabel(x.month)} ({x.count.toLocaleString("ro-RO")})</option>)}
        </select>
        <details ref={statusMenu} className="relative" data-inv-status="">
          <summary className={`${filterCls(query.statuses.length > 0)} flex cursor-pointer list-none items-center`}>
            {query.statuses.length === 0 ? t("Status: {v1}", { v1: m.invoices.filterAll.toLowerCase() }) : t("Status: {v1}", { v1: query.statuses.map((s) => t(INVOICE_STATUS[s as InvoiceStatusKey].label)).join(", ") })}
          </summary>
          <div className="absolute left-0 z-40 mt-1 min-w-40 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-xl">
            {INVOICE_STATUS_LIST.map((s) => (
              <label key={s} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] hover:bg-[var(--color-surface-2)]">
                <input type="checkbox" checked={query.statuses.includes(s)} onChange={() => toggleStatus(s)} className="size-3.5 accent-[var(--color-brand)]" data-inv-status-opt={s} />
                <span className={`rounded-full px-1.5 ${INVOICE_STATUS[s].cls}`}>{t(INVOICE_STATUS[s].label)}</span>
              </label>
            ))}
          </div>
        </details>
        <select value={query.kind} onChange={(e) => patchQuery({ kind: e.target.value as InvQuery["kind"] })} className={filterCls(!!query.kind)} aria-label={t("Tip")} data-inv-kind="">
          <option value="">{t("Tip: toate")}</option>
          <option value="APA_CANAL">{t("Apă-Canal")}</option>
          <option value="STANDARD">{t("Standard")}</option>
        </select>
        <select
          value={query.service}
          disabled={serverMode}
          onChange={(e) => patchQuery({ service: e.target.value as InvQuery["service"] })}
          className={`${filterCls(!!query.service)} disabled:opacity-50`}
          aria-label={t("Serviciu")}
          title={serverMode ? t("Filtrul pe servicii merge pe o lună sau pe „Ultimele 3 luni”.") : undefined}
          data-inv-service=""
        >
          <option value="">{t("Serviciu: toate")}</option>
          {SERVICE_FILTERS.map(([k, label]) => <option key={k} value={k}>{t(label)}</option>)}
        </select>
        <select value={query.quick} onChange={(e) => patchQuery({ quick: e.target.value as InvQuery["quick"] })} className={filterCls(!!query.quick)} aria-label={t("Scurtături")} data-inv-quick="">
          <option value="">{t("Scurtături")}</option>
          <option value="unpaid">{t("Neachitate")}</option>
          <option value="overdue">{t("Restante (scadența trecută)")}</option>
          <option value="nodue">{t("Fără scadență")}</option>
          <option value="paidnodate">{t("Achitate fără dată")}</option>
          <option value="debt">{t("Cu datorie (sold anterior neachitat)")}</option>
          <option value="advance">{t("Cu avans")}</option>
          <option value="paidprev">{t("Cu plată primită înainte de factură")}</option>
          <option value="partial">{t("Parțial achitate")}</option>
        </select>
        <button
          type="button"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
          data-inv-more=""
          className={`tap h-7 cursor-pointer rounded-lg border px-2 text-[11px] ${hasAdvanced(query) ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
        >
          {showMore ? t("Mai puține filtre ▴") : t("Mai multe filtre ▾")}
        </button>
        {nFilters > 0 && (
          <button
            type="button"
            onClick={resetFilters}
            className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            {t("Resetează filtrele ({activeFilters})", { activeFilters: nFilters })}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {canImportApaCanal && (
            <ApaCanalJsonImport className="tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-medium text-ink-soft hover:bg-[var(--color-surface-2)]" />
          )}
          {canCreate && (
            <Link
              href="/invoices/new"
              className="tap inline-flex h-7 cursor-pointer items-center rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong"
            >
              {m.invoices.new}
            </Link>
          )}
        </div>
      </div>

      {showMore && (
        <div className="mb-1.5 flex flex-wrap items-end gap-x-3 gap-y-1.5 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)]/50 px-2 py-1.5 text-[11px]" data-inv-advanced="">
          <label className="flex flex-col gap-0.5">
            <span className="text-ink-soft">{t("Sumă")}</span>
            <span className="flex items-center gap-1">
              <input value={query.min} onChange={(e) => patchQuery({ min: e.target.value.replace(/[^\d.,]/g, "").slice(0, 12) })} inputMode="decimal" placeholder={t("min")} aria-label={t("Sumă minimă")} className={`${inputCls(!!query.min)} w-20`} data-inv-min="" />
              –
              <input value={query.max} onChange={(e) => patchQuery({ max: e.target.value.replace(/[^\d.,]/g, "").slice(0, 12) })} inputMode="decimal" placeholder={t("max")} aria-label={t("Sumă maximă")} className={`${inputCls(!!query.max)} w-20`} data-inv-max="" />
            </span>
          </label>
          {([
            ["Emisă", "issueFrom", "issueTo"],
            ["Scadență", "dueFrom", "dueTo"],
            ["Achitată", "paidFrom", "paidTo"],
          ] as const).map(([label, a, b]) => (
            <label key={a} className="flex flex-col gap-0.5">
              <span className="text-ink-soft">{t(label)}</span>
              <span className="flex items-center gap-1">
                <input type="date" value={query[a]} onChange={(e) => patchQuery({ [a]: e.target.value })} aria-label={`${t(label)} ${t("de la")}`} className={inputCls(!!query[a])} data-inv-date={a} />
                –
                <input type="date" value={query[b]} onChange={(e) => patchQuery({ [b]: e.target.value })} aria-label={`${t(label)} ${t("până la")}`} className={inputCls(!!query[b])} data-inv-date={b} />
              </span>
            </label>
          ))}
          {(currencies.length > 1 || query.currency) && (
            <label className="flex flex-col gap-0.5">
              <span className="text-ink-soft">{t("Valută")}</span>
              <select value={query.currency} onChange={(e) => patchQuery({ currency: e.target.value })} className={filterCls(!!query.currency)} data-inv-currency="">
                <option value="">{t("toate")}</option>
                {[...new Set([...currencies, ...(query.currency ? [query.currency] : [])])].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {/* Plăți pe perioada aleasă: un click arată CARE facturi sunt achitate / neachitate / restante / cu datorie / cu avans / cu plată primită / parțial achitate */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5" data-inv-pay-chips="">
        <span className="text-[11px] font-semibold text-ink-soft">{t("Plăți")}</span>
        {(
          [
            { key: "all", label: "Toate", statuses: [] as string[], quick: "" as InvQuery["quick"], n: null as number | null },
            { key: "paid", label: "Achitate", statuses: ["PAID"], quick: "" as InvQuery["quick"], n: payCounts?.paid ?? null },
            { key: "unpaid", label: "Neachitate", statuses: [], quick: "unpaid" as InvQuery["quick"], n: payCounts?.unpaid ?? null },
            { key: "overdue", label: "Restante", statuses: ["OVERDUE"], quick: "" as InvQuery["quick"], n: payCounts?.overdue ?? null },
            { key: "debt", label: "Cu datorie", statuses: [], quick: "debt" as InvQuery["quick"], n: payCounts?.debt ?? null },
            { key: "advance", label: "Cu avans", statuses: [], quick: "advance" as InvQuery["quick"], n: payCounts?.advance ?? null },
            { key: "paidprev", label: "Cu plată primită", statuses: [], quick: "paidprev" as InvQuery["quick"], n: payCounts?.paidprev ?? null },
            { key: "partial", label: "Parțial achitate", statuses: [], quick: "partial" as InvQuery["quick"], n: payCounts?.partial ?? null },
          ]
        ).map((c) => {
          const on = c.key === "all" ? query.statuses.length === 0 && !query.quick : query.quick === c.quick && query.statuses.length === c.statuses.length && c.statuses.every((s) => query.statuses.includes(s));
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={on}
              onClick={() => patchQuery(on || c.key === "all" ? { statuses: [], quick: "" } : { statuses: c.statuses, quick: c.quick })}
              title={t("Arată în listă care sunt")}
              className={`tap h-7 cursor-pointer rounded-lg border px-2.5 text-[11px] ${on ? "border-brand bg-brand font-semibold text-white" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
            >
              {t(c.label)}{c.n != null && <span className="ml-1 tabular-nums opacity-80">{c.n.toLocaleString("ro-RO")}</span>}
            </button>
          );
        })}
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs" data-inv-summary="">
        <span>
          <b>{view.total.toLocaleString("ro-RO")}</b> {t("facturi")}
          {view.total > 0 && <span className="text-ink-soft"> {t("· afișate {v1}–{v2} · pagina {page}/{totalPages}", { v1: from.toLocaleString("ro-RO"), v2: to.toLocaleString("ro-RO"), page, totalPages })}</span>}
        </span>
        {view.sums ? (
          <>
            <span className="text-ink-soft">{t("Σ total:")} <b className="tabular-nums text-ink">{fmtMoney(view.sums.total, view.sums.currency)}</b></span>
            <span className="text-ink-soft">{t("achitat:")} <b className="tabular-nums text-st-done">{fmtMoney(view.sums.paid, view.sums.currency)}</b></span>
            <span className="text-ink-soft">{t("neachitat:")} <b className="tabular-nums text-ink">{fmtMoney(view.sums.open, view.sums.currency)}</b></span>
            {view.sums.overdueCount > 0 && <span className="text-ink-soft">{t("din care restant:")} <b className="tabular-nums text-st-cancelled">{fmtMoney(view.sums.overdue, view.sums.currency)}</b> ({view.sums.overdueCount.toLocaleString("ro-RO")})</span>}
            {view.sums.mixedCurrency && <span className="text-ink-soft" title={t("Sumele sunt doar în valuta principală; filtrează după valută pentru celelalte.")}>{t("(mai multe valute)")}</span>}
          </>
        ) : (
          <span className="text-ink-soft">{t("Σ pagină:")} <b className="tabular-nums text-ink">{money(pageTotal, rows[0]?.currency ?? "MDL")}</b></span>
        )}
        {loading && <span className="text-ink-soft">{t("se încarcă…")}</span>}
        {useLocal && <span className="text-ink-soft" title={t("Lista e ținută în memorie și filtrată instant în browser.")}>{t("⚡ local")}</span>}
        <button
          type="button"
          onClick={() => setShowReport((v) => !v)}
          aria-expanded={showReport}
          data-inv-report-toggle=""
          title={t("Numărul de facturi și suma pe apă, canalizare și ambele (pentru perioada aleasă)")}
          className={`tap ml-auto h-7 cursor-pointer rounded-lg border px-2 text-[11px] ${showReport ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
        >
          {showReport ? t("Raport servicii ▴") : t("Raport servicii ▾")}
        </button>
        <button
          type="button"
          onClick={toggleCards}
          aria-pressed={cards}
          title={cards ? t("Înapoi la tabel") : t("Afișează facturile într-o coloană mică; apeși pe una ca să vezi detaliile (potrivit pentru telefon)")}
          className={`tap h-7 cursor-pointer rounded-lg border px-2 text-[11px] ${cards ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
        >
          {cards ? "▦ Tabel" : "📱 Mod telefon"}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          {t("Afișează")}
          <select
            value={wantPerPage}
            onChange={(e) => { setWantPerPage(Number(e.target.value)); setPage(1); }}
            className={`h-7 appearance-none sel-arrow rounded-lg border pl-1.5 pr-6 text-[11px] outline-none focus:border-brand ${
              wantPerPage === INVOICE_DEFAULT_PER_PAGE ? "border-[var(--color-line)] bg-[var(--color-surface)] text-ink" : "border-brand bg-brand/10 font-semibold text-brand"
            }`}
            aria-label={t("Câte pe pagină")}
          >
            {INVOICE_PER_PAGE.map((n) => <option key={n} value={n}>{perPageLabel(n === INVOICE_ALL ? 25_000 : n, t)}</option>)}
          </select>
        </label>
      </div>
      {showReport && (
        <div className="mb-1.5 max-w-xl rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)]/50 px-2 py-1.5 text-[11px]" data-inv-report="">
          {reportErr ? (
            <p className="text-st-cancelled">{reportErr}</p>
          ) : !reportSum ? (
            <p className="text-ink-soft">{t("se încarcă…")}</p>
          ) : (
            <>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] tabular-nums">
                <thead>
                  <tr className="text-ink-soft">
                    <th className="py-0.5 text-left font-semibold">{t("Serviciu")}</th>
                    <th className="py-0.5 text-right font-semibold">{t("Facturi")}</th>
                    <th className="py-0.5 text-right font-semibold" title={t("Venitul calculat în perioadă: totalul de plată minus datoria / avansul reportat")}>{t("Calculat")}</th>
                    <th className="py-0.5 text-right font-semibold">{t("Achitate")}</th>
                    <th className="py-0.5 text-right font-semibold">{t("Achitat (sumă)")}</th>
                    <th className="py-0.5 text-right font-semibold">{t("Neachitate")}</th>
                    <th className="py-0.5 text-right font-semibold">{t("Rest de plată")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [["WATER", "Doar apă"], ["SEWER", "Doar canalizare"], ["BOTH", "Apă + canalizare"], ["NONE", "Fără servicii (consum și sumă zero)"], ["", "Total"]] as const
                  ).map(([k, label]) => {
                    const o = k === "" ? reportSum.all : reportSum.by[k];
                    if (k === "NONE" && o.n === 0) return null;
                    // numerele sunt butoane: aplică în listă serviciul și statusul (achitate / neachitate), ca să vezi CARE sunt
                    const pick = (statuses: string[]) => patchQuery({ service: k, statuses });
                    const link = (on: boolean, children: React.ReactNode, statuses: string[], disabled: boolean) => (
                      <button type="button" disabled={disabled || o.n === 0} onClick={() => pick(statuses)} title={t("Arată în listă care sunt")} className={`cursor-pointer underline decoration-dotted underline-offset-2 hover:text-brand disabled:cursor-default disabled:no-underline ${on ? "font-bold text-brand" : ""}`}>{children}</button>
                    );
                    const svcOff = serverMode && k !== "";
                    const active = query.service === k;
                    const paidOn = active && query.statuses.length === 1 && query.statuses[0] === "PAID";
                    const unpaidOn = active && query.statuses.length === 2 && query.statuses.includes("SENT") && query.statuses.includes("OVERDUE");
                    return (
                      <tr key={k || "all"} className={`border-t border-[var(--color-line)] ${k === "" ? "font-semibold" : k === "NONE" ? "text-ink-soft" : ""}`}>
                        <td className="py-0.5">
                          {k === "" ? t(label) : (
                            <button type="button" disabled={svcOff} onClick={() => patchQuery({ service: query.service === k ? "" : k, statuses: [] })} title={t("Arată doar aceste facturi în listă")} className={`cursor-pointer text-left underline decoration-dotted underline-offset-2 hover:text-brand disabled:cursor-default disabled:no-underline ${query.service === k && !query.statuses.length ? "font-bold text-brand" : ""}`}>{t(label)}</button>
                          )}
                        </td>
                        <td className="py-0.5 text-right">{o.n.toLocaleString("ro-RO")}</td>
                        <td className="py-0.5 text-right">{fmtMoney(o.calc, reportSum.currency)}</td>
                        <td className="py-0.5 text-right">{link(paidOn, o.paidN.toLocaleString("ro-RO"), ["PAID"], svcOff)}</td>
                        <td className="py-0.5 text-right font-semibold text-st-done">{fmtMoney(o.paid, reportSum.currency)}</td>
                        <td className="py-0.5 text-right">{link(unpaidOn, <>{o.unpaidN.toLocaleString("ro-RO")}{o.overdueN > 0 && <span className="text-st-cancelled"> ({o.overdueN.toLocaleString("ro-RO")} {t("restante")})</span>}</>, ["SENT", "OVERDUE"], svcOff)}</td>
                        <td className="py-0.5 text-right font-semibold">{fmtMoney(o.rest, reportSum.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
              {reportIncomplete && <p className="mt-1 text-st-progress" data-report-incomplete="">{t("Serviciile unor luni se mai calculează în fundal: cifrele se completează singure în câteva minute.")}</p>}
              <p className="mt-1 text-ink-soft">
                {t("Doar facturile Apă-Canal din perioada aleasă (fără cele anulate), pe valută; filtrele listei nu o restrâng. „Achitat” = cât s-a plătit, dedus din soldul facturilor următoare; „Rest de plată” = totalul de plată al celor neachitate (include datoria reportată, deci pe mai multe luni se poate număra de mai multe ori).")}
                {reportSum.mixedCurrency && ` ${t("(mai multe valute)")}`}
              </p>
            </>
          )}
        </div>
      )}
      {serverMode && (
        <p className="mb-1 text-[11px] text-st-progress" data-inv-servernote="">
          {t("Perioadă mare: căutarea rulează pe server (mai lent). Sortarea după număr și dată emitere merge; pentru filtre instante și totaluri alege o lună sau „Ultimele 3 luni”.")}
        </p>
      )}
      {error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {error}
          <button type="button" onClick={() => setReloadTick((n) => n + 1)} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
        </p>
      )}

      {cards ? (
        <div className={`flex flex-col gap-1.5 transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}>
          {renderRows(rows, (r) => {
            const st = INVOICE_STATUS[r.status];
            const late = r.status !== "PAID" && r.status !== "CANCELLED" && isPast(r.dueMs);
            return (
              <CompactCard
                key={r.id}
                avatar={(r.clientName ?? r.number).trim().charAt(0).toUpperCase()}
                title={r.number}
                subtitle={
                  <>
                    <span className="min-w-0 truncate">{r.clientName ?? m.invoices.noClient}</span>
                    <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium ${st.cls}`}>{t(st.label)}</span>
                  </>
                }
                trailing={<span className="font-semibold tabular-nums">{money(r.grandTotal, r.currency)}</span>}
              >
                <dl>
                  {r.kind === "APA_CANAL" && <CompactField label={t("Tip")}><span className="rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-700">{t("Apă-Canal")}</span></CompactField>}
                  <CompactField label={t("Emisă")}>{fmtMs(r.issueMs)}</CompactField>
                  {r.kind === "APA_CANAL" && Math.abs(r.debt) > 0.005 && <CompactField label={t("Datorie / avans")}><span className={r.debt > 0 ? "font-semibold text-st-cancelled" : "font-semibold text-st-done"}>{r.debt > 0 ? "+" : "−"}{money(Math.abs(r.debt), r.currency)}</span></CompactField>}
                  {r.kind === "APA_CANAL" && r.paid != null && <CompactField label={t("Achitat din factură")}>{money(r.paid, r.currency)}</CompactField>}
                  <CompactField label={t("Scadență")}>
                    <span className={late ? "font-semibold text-st-cancelled" : ""}>{fmtMs(r.dueMs)}{late ? t("· depășită") : ""}</span>
                  </CompactField>
                  <CompactField label={t("Achitată")}>
                    {r.status === "PAID" ? (
                      r.paidMs ? <span className="text-st-done">{fmtMs(r.paidMs)}</span> : <span className="text-ink-soft/70">{t("? (data nu s-a înregistrat)")}</span>
                    ) : <span className="text-ink-soft/60">—</span>}
                  </CompactField>
                  <CompactField label={t("Status")}>
                    <select
                      value={r.status}
                      disabled={!canEdit}
                      onChange={(e) => changeStatus(r.id, e.target.value as InvoiceStatusKey)}
                      className={`h-6 cursor-pointer disabled:cursor-not-allowed rounded-full border-0 px-2 text-[12px] font-medium outline-none ${st.cls}`}
                      aria-label={`Status ${r.number}`}
                    >
                      {INVOICE_STATUS_LIST.map((x) => (
                        <option key={x} value={x}>{t(INVOICE_STATUS[x].label)}</option>
                      ))}
                    </select>
                  </CompactField>
                </dl>
                <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)]/60 px-2.5 py-1.5">
                  <InvoiceViewButton token={r.publicToken} title={`${r.number}${r.clientName ? ` · ${r.clientName}` : ""}`} className={cardBtn} />
                  {canEdit && <Link href={`/invoices/${r.id}/edit`} className={cardBtn}>{m.common.edit}</Link>}
                  <button type="button" onClick={() => copyLink(r.publicToken)} className={cardBtn}>
                    {copied === r.publicToken ? m.invoices.copied : m.invoices.copyLink}
                  </button>
                  <a href={`/invoice/public/${r.publicToken}`} target="_blank" rel="noopener noreferrer" className={cardBtn}>
                    {m.invoices.publicPdf} ↗
                  </a>
                  {canDelete && (
                    <button type="button" onClick={() => remove(r.id)} className={`${cardBtn} text-st-cancelled`} title={m.common.delete} aria-label={m.common.delete}>
                      <IconTrash className="size-3.5" />
                    </button>
                  )}
                </div>
              </CompactCard>
            );
          })}
          {rows.length === 0 && !loading && <div className="card p-8 text-center text-ink-soft">{m.invoices.noInvoices}</div>}
        </div>
      ) : (
      <div
        ref={scrollRef}
        onScroll={virtualTable ? onTableScroll : undefined}
        className={`card overflow-auto transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}
        style={{ maxHeight: rows.length > 50 ? "max(78vh, 890px)" : undefined }}
      >
        <table className="min-w-full table-fixed border-separate border-spacing-0 text-[11px] leading-[14px]" style={{ width: COL_W.reduce((a, b) => a + b, 0) }}>
          <colgroup>{COL_W.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
          <thead className="sticky top-0 z-20 bg-[var(--color-surface-2)]">
            <tr>
              <Th sortKey="number" q={query} onSort={toggleSort} disabled={false}>{t("Număr")}</Th>
              <Th sortKey="client" q={query} onSort={toggleSort} disabled={serverMode}>{t("Client")}</Th>
              <Th sortKey="issue" q={query} onSort={toggleSort} disabled={false}>{t("Emisă")}</Th>
              <Th sortKey="due" q={query} onSort={toggleSort} disabled={serverMode}>{t("Scadență")}</Th>
              <Th sortKey="paid" q={query} onSort={toggleSort} disabled={serverMode}>{t("Achitată")}</Th>
              <Th sortKey="total" q={query} onSort={toggleSort} disabled={serverMode} right>{t("Sumă")}</Th>
              <Th right>{t("Datorie / avans")}</Th>
              <Th right>{t("Achitat din factură")}</Th>
              <Th sortKey="status" q={query} onSort={toggleSort} disabled={serverMode}>{t("Status")}</Th>
              <Th>{t("Acțiuni")}</Th>
            </tr>
          </thead>
          <tbody>
            {winStart > 0 && (
              <tr aria-hidden>
                <td colSpan={10} style={{ height: winStart * ROW_H, padding: 0, border: 0 }} />
              </tr>
            )}
            {winRows.map((r) => {
              const st = INVOICE_STATUS[r.status];
              const late = r.status !== "PAID" && r.status !== "CANCELLED" && isPast(r.dueMs);
              const cell = "border-b border-[var(--color-line)] px-1.5 py-[2px]";
              return (
                <tr key={r.id} style={{ height: ROW_H }} className="hover:bg-brand-soft/30">
                  <td className={`${cell} font-semibold`}>
                    {/* numărul + insigna într-un rând care nu iese din celulă (numerele lungi, ex. AC-2500317-202610, nu mai acoperă coloana „Client”) */}
                    <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap">
                      <span className="truncate" title={r.number}>{r.number}</span>
                      {r.kind === "APA_CANAL" && (
                        <span className="shrink-0 rounded bg-sky-100 px-1 text-[9px] font-semibold text-sky-700">{t("Apă-Canal")}</span>
                      )}
                    </div>
                  </td>
                  <td className={cell}>
                    <div className="truncate" title={r.clientName ?? ""}>{r.clientName ?? <span className="text-ink-soft/60">{m.invoices.noClient}</span>}</div>
                  </td>
                  <td className={`${cell} whitespace-nowrap`}>{fmtMs(r.issueMs)}</td>
                  <td className={`${cell} whitespace-nowrap ${late ? "font-semibold text-st-cancelled" : ""}`} title={late ? t("Scadența a trecut") : undefined}>{fmtMs(r.dueMs)}</td>
                  <td className={`${cell} whitespace-nowrap`}>
                    {r.status === "PAID" ? (
                      r.paidMs ? <span className="text-st-done">{fmtMs(r.paidMs)}</span> : <span className="text-ink-soft/70" title={t("Marcată plătită, dar data nu s-a înregistrat")}>?</span>
                    ) : <span className="text-ink-soft/60">—</span>}
                  </td>
                  <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums`}>{money(r.grandTotal, r.currency)}</td>
                  <td className={`${cell} whitespace-nowrap text-right tabular-nums ${r.debt > 0.005 ? "text-st-cancelled" : r.debt < -0.005 ? "text-st-done" : "text-ink-soft/60"}`} title={r.debt > 0.005 ? t("Datorie din facturile trecute") : r.debt < -0.005 ? t("Avans plătit în plus") : undefined}>
                    {r.kind === "APA_CANAL" && Math.abs(r.debt) > 0.005 ? `${r.debt > 0 ? "+" : "−"}${money(Math.abs(r.debt), r.currency)}` : "—"}
                  </td>
                  <td className={`${cell} whitespace-nowrap text-right tabular-nums`} title={r.paid != null ? t("Cât din această factură s-a achitat (dedus din datoria de pe factura următoare)") : t("Încă nu se știe: apare când se emite factura următoare")}>
                    {r.kind === "APA_CANAL" && r.paid != null ? <span className={r.paid > 0.005 ? "text-st-done" : "text-ink-soft/70"}>{money(r.paid, r.currency)}</span> : <span className="text-ink-soft/60">—</span>}
                  </td>
                  <td className={cell}>
                    <select
                      value={r.status}
                      disabled={!canEdit}
                      onChange={(e) => changeStatus(r.id, e.target.value as InvoiceStatusKey)}
                      className={`h-[18px] cursor-pointer disabled:cursor-not-allowed rounded-full border-0 px-1.5 text-[10px] font-medium outline-none ${st.cls}`}
                      aria-label={`Status ${r.number}`}
                    >
                      {INVOICE_STATUS_LIST.map((s) => (
                        <option key={s} value={s}>{t(INVOICE_STATUS[s].label)}</option>
                      ))}
                    </select>
                  </td>
                  <td className={cell}>
                    <div className="flex items-center gap-1">
                      <InvoiceViewButton token={r.publicToken} title={`${r.number}${r.clientName ? ` · ${r.clientName}` : ""}`} className={btn} />
                      {canEdit && <Link href={`/invoices/${r.id}/edit`} className={btn}>{m.common.edit}</Link>}
                      <button type="button" onClick={() => copyLink(r.publicToken)} className={btn}>
                        {copied === r.publicToken ? m.invoices.copied : m.invoices.copyLink}
                      </button>
                      <a href={`/invoice/public/${r.publicToken}`} target="_blank" rel="noopener noreferrer" className={btn}>
                        {m.invoices.publicPdf} ↗
                      </a>
                      {canDelete && (
                        <button type="button" onClick={() => remove(r.id)} className={`${btn} text-st-cancelled`} title={m.common.delete} aria-label={m.common.delete}>
                          <IconTrash className="size-3" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {winEnd < rows.length && (
              <tr aria-hidden>
                <td colSpan={10} style={{ height: (rows.length - winEnd) * ROW_H, padding: 0, border: 0 }} />
              </tr>
            )}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={10} className="p-8 text-center text-ink-soft">{m.invoices.noInvoices}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {totalPages > 1 && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-1">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="tap grid size-7 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-40"
            aria-label={m.common.previous}
          >
            <IconChevronLeft className="size-4" />
          </button>
          {buildPageButtons(page, totalPages).map((b, i) =>
            b === "…" ? (
              <span key={`e${i}`} className="flex h-7 w-6 items-center justify-center text-sm text-ink-soft">…</span>
            ) : (
              <button
                key={b}
                onClick={() => setPage(b)}
                aria-current={b === page ? "page" : undefined}
                className={`tap h-7 min-w-[28px] cursor-pointer rounded-lg px-2 text-xs font-medium ${b === page ? "bg-brand text-white" : "border border-[var(--color-line)] text-ink hover:bg-[var(--color-surface-2)]"}`}
              >
                {b}
              </button>
            ),
          )}
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="tap grid size-7 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-40"
            aria-label={m.common.next}
          >
            <IconChevronRight className="size-4" />
          </button>
          {/* Salt direct la o pagină aleasă */}
          <form
            className="ml-2 flex items-center gap-1 text-xs text-ink-soft"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.floor(Number(goto));
              if (!Number.isFinite(n) || n < 1) return;
              setGoto("");
              setPage(Math.min(n, totalPages));
            }}
          >
            {t("Mergi la")}
            <input
              value={goto}
              onChange={(e) => setGoto(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              placeholder={String(page)}
              aria-label={t("Număr pagină")}
              className="h-7 w-14 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 text-center text-xs text-ink outline-none focus:border-brand"
            />
            / {totalPages}
            <button type="submit" className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-xs font-medium text-ink hover:bg-[var(--color-surface-2)]">{t("Du-te")}</button>
          </form>
        </div>
      )}
    </>
  );
}

const btn =
  "tap inline-flex h-5 cursor-pointer items-center rounded border border-[var(--color-line)] px-1.5 text-[10px] leading-none hover:bg-brand-soft";

const cardBtn =
  "tap inline-flex h-7 cursor-pointer items-center rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[11px] leading-none hover:bg-brand-soft";

/** Scadența a trecut? (în afara componentei, ca randarea să rămână pură). */
function isPast(ms: number | null): boolean {
  return ms != null && ms < Date.now();
}

function Th({ children, right, sortKey, q, onSort, disabled }: { children: React.ReactNode; right?: boolean; sortKey?: InvSort; q?: InvQuery; onSort?: (k: InvSort) => void; disabled?: boolean }) {
  const active = !!sortKey && q?.sort === sortKey;
  return (
    <th
      className={`border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-1 font-semibold ${right ? "text-right" : "text-left"}`}
      aria-sort={active ? (q?.dir === "asc" ? "ascending" : "descending") : undefined}
    >
      {sortKey && onSort && !disabled ? (
        <button type="button" onClick={() => onSort(sortKey)} data-inv-sort={sortKey} className={`cursor-pointer font-semibold hover:text-brand ${active ? "text-brand" : ""}`}>
          {children}
          {active ? (q?.dir === "asc" ? " ▲" : " ▼") : ""}
        </button>
      ) : children}
    </th>
  );
}
