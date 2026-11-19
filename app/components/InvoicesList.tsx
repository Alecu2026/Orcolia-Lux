"use client";

import DebtAgingButton from "./DebtAgingButton";
import FiltersToggle from "./FiltersToggle";
import { useFiltersOpen } from "./useFiltersOpen";
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
import DataTable, { type Col } from "./DataTable";

/** Cât timp lista locală nu e încărcată (sau perioada e prea mare), serverul dă pagini de cel mult atâtea rânduri. */
const SERVER_MAX_PENDING = 200;
const SERVER_MAX_SERVER_MODE = 1000;

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
  const [fOpen, toggleF] = useFiltersOpen("invoices");
  const [goto, setGoto] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [report, setReport] = useState<{ period: string; rows: InvServiceRow[]; incomplete: boolean } | null>(null);
  const [reportErr, setReportErr] = useState<string | null>(null);
  const [reportTick, setReportTick] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusMenu = useRef<HTMLDetailsElement>(null);

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

  const pageTotal = useMemo(() => rows.reduce((sum, r) => sum + (r.status === "CANCELLED" ? 0 : r.grandTotal), 0), [rows]);



  // Lista întreagă pentru tabel (paginarea o face DataTable): din memorie pe perioade care încap local, altfel pagina primită de la server.
  const tableRows = useMemo(() => {
    if (local && ds.rows) {
      const out: InvRow[] = new Array(local.total);
      for (let k = 0; k < local.total; k++) out[k] = ds.rows[local.idx[k]];
      return out;
    }
    return rows;
  }, [local, ds.rows, rows]);

  // ── Coloane (ca la Sarcini): se mută, se ascund, se redimensionează și se colorează din „⚙ Coloane”; alegerea rămâne salvată în browser („Resetează” revine la cele de la început). ──
  const dash = <span className="text-ink-soft/60">—</span>;
  const columns: Col<InvRow>[] = [
    {
      key: "number", label: "Număr", minW: 150, maxW: 250, sticky: true, sort: (r) => r.number,
      render: (r) => (
        <span className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap font-semibold">
          <span className="truncate" title={r.number}>{r.number}</span>
          {r.kind === "APA_CANAL" && <span className="shrink-0 rounded bg-sky-100 px-1 text-[9px] font-semibold text-sky-700">{t("Apă-Canal")}</span>}
        </span>
      ),
    },
    { key: "client", label: "Client", minW: 180, maxW: 260, sort: (r) => r.clientName ?? "", render: (r) => r.clientName ?? <span className="text-ink-soft/60">{m.invoices.noClient}</span> },
    { key: "issue", label: "Emisă", minW: 90, sort: (r) => r.issueMs, render: (r) => fmtMs(r.issueMs) },
    {
      key: "due", label: "Scadență", minW: 90, sort: (r) => r.dueMs,
      render: (r) => {
        const late = r.status !== "PAID" && r.status !== "CANCELLED" && isPast(r.dueMs);
        return <span className={late ? "font-semibold text-st-cancelled" : ""} title={late ? t("Scadența a trecut") : undefined}>{fmtMs(r.dueMs)}{late ? " ⚠" : ""}</span>;
      },
    },
    {
      key: "paid", label: "Achitată", minW: 90, sort: (r) => r.paidMs,
      render: (r) => (r.status === "PAID"
        ? (r.paidMs ? <span className="text-st-done">{fmtMs(r.paidMs)}</span> : <span className="text-ink-soft/70" title={t("Marcată plătită, dar data nu s-a înregistrat")}>?</span>)
        : dash),
    },
    { key: "total", label: "Sumă", minW: 100, right: true, sort: (r) => r.grandTotal, render: (r) => <span className="font-semibold">{money(r.grandTotal, r.currency)}</span> },
    {
      key: "debt", label: "Datorie / avans", minW: 100, right: true, sort: (r) => (r.kind === "APA_CANAL" ? r.debt : null),
      render: (r) => (r.kind === "APA_CANAL" && Math.abs(r.debt) > 0.005
        ? <span className={r.debt > 0 ? "text-st-cancelled" : "text-st-done"} title={r.debt > 0 ? t("Datorie din facturile trecute") : t("Avans plătit în plus")}>{r.debt > 0 ? "+" : "−"}{money(Math.abs(r.debt), r.currency)}</span>
        : dash),
    },
    {
      key: "paidAmt", label: "Achitat din factură", minW: 105, right: true, sort: (r) => (r.kind === "APA_CANAL" ? r.paid : null),
      render: (r) => (r.kind === "APA_CANAL" && r.paid != null
        ? <span className={r.paid > 0.005 ? "text-st-done" : "text-ink-soft/70"} title={t("Cât din această factură s-a achitat (dedus din datoria de pe factura următoare)")}>{money(r.paid, r.currency)}</span>
        : <span className="text-ink-soft/60" title={t("Încă nu se știe: apare când se emite factura următoare")}>—</span>),
    },
    {
      key: "status", label: "Status", minW: 105, sort: (r) => r.status,
      render: (r) => (
        <select
          value={r.status}
          disabled={!canEdit}
          onChange={(e) => changeStatus(r.id, e.target.value as InvoiceStatusKey)}
          className={`h-[18px] cursor-pointer disabled:cursor-not-allowed rounded-full border-0 px-1.5 text-[10px] font-medium outline-none ${INVOICE_STATUS[r.status].cls}`}
          aria-label={`Status ${r.number}`}
        >
          {INVOICE_STATUS_LIST.map((s) => (
            <option key={s} value={s}>{t(INVOICE_STATUS[s].label)}</option>
          ))}
        </select>
      ),
    },
    {
      key: "actions", label: "", minW: 270,
      render: (r) => (
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
      ),
    },
  ];


  return (
    <>
      {/* ── Bară compactă: filtre, totaluri, acțiuni — un singur rând (mai mult loc pentru listă) ── */}
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" data-inv-summary="">
        <FiltersToggle open={fOpen} onToggle={toggleF} activeCount={nFilters} />
        {view.sums ? (
          <>
            <span className="text-ink-soft">{t("Σ total:")} <b className="tabular-nums text-ink">{fmtMoney(view.sums.total, view.sums.currency)}</b></span>
            <span className="text-ink-soft" title={t("Cât au plătit între facturi (la fel ca „Încasat” din raport)")}>{t("achitat:")} <b className="tabular-nums text-st-done">{fmtMoney(view.sums.paid, view.sums.currency)}</b></span>
            <span className="text-ink-soft" title={t("Datoria reportată pe facturi (la fel ca „Datorie” din raport)")}>{t("neachitat:")} <b className="tabular-nums text-ink">{fmtMoney(view.sums.open, view.sums.currency)}</b></span>
            {view.sums.overdueCount > 0 && <span className="text-ink-soft" title={t("Facturile lunii cu statusul Restantă: totalul lor de plată")}>{t("facturi restante:")} <b className="tabular-nums text-st-cancelled">{fmtMoney(view.sums.overdue, view.sums.currency)}</b> ({view.sums.overdueCount.toLocaleString("ro-RO")})</span>}
            {view.sums.mixedCurrency && <span className="text-ink-soft" title={t("Sumele sunt doar în valuta principală; filtrează după valută pentru celelalte.")}>{t("(mai multe valute)")}</span>}
          </>
        ) : (
          <span className="text-ink-soft">{t("Σ pagină:")} <b className="tabular-nums text-ink">{money(pageTotal, rows[0]?.currency ?? "MDL")}</b></span>
        )}
        {serverMode && <span className="text-ink-soft"><b className="text-ink">{view.total.toLocaleString("ro-RO")}</b> {t("facturi")} · {page}/{totalPages}</span>}
        {loading && <span className="text-ink-soft">{t("se încarcă…")}</span>}
        {useLocal && <span className="text-ink-soft" title={t("Lista e ținută în memorie și filtrată instant în browser.")}>{t("⚡ local")}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {serverMode && (
            <select
              value={`${query.sort}|${query.dir}`}
              onChange={(e) => { const [s, d] = e.target.value.split("|"); setQuery((q) => ({ ...q, sort: s as InvSort, dir: d as InvQuery["dir"] })); setPage(1); }}
              className={filterCls(false)}
              aria-label={t("Sortare")}
            >
              <option value="issue|desc">{t("Emisă")} ▼</option>
              <option value="issue|asc">{t("Emisă")} ▲</option>
              <option value="number|asc">{t("Număr")} ▲</option>
              <option value="number|desc">{t("Număr")} ▼</option>
            </select>
          )}
          {serverMode && (
            <select
              value={wantPerPage}
              onChange={(e) => { setWantPerPage(Number(e.target.value)); setPage(1); }}
              className={filterCls(wantPerPage !== INVOICE_DEFAULT_PER_PAGE)}
              aria-label={t("Câte pe pagină")}
            >
              {INVOICE_PER_PAGE.map((n) => <option key={n} value={n}>{perPageLabel(n === INVOICE_ALL ? 25_000 : n, t)}</option>)}
            </select>
          )}
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
          <DebtAgingButton />
          <button
            type="button"
            onClick={() => setShowReport((v) => !v)}
            aria-expanded={showReport}
            data-inv-report-toggle=""
            title={t("Numărul de facturi și suma pe apă, canalizare și ambele (pentru perioada aleasă)")}
            className={`tap h-7 cursor-pointer rounded-lg border px-2 text-[11px] ${showReport ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
          >
            {showReport ? t("Raport servicii ▴") : t("Raport servicii ▾")}
          </button>
        </div>
      </div>
      <div className={`flex-wrap items-center gap-1.5 ${fOpen ? "mb-1.5 flex" : "hidden"}`}>
        <div className={fOpen ? "contents" : "hidden"}>
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
          <option value="settled">{t("Au achitat factura anterioară")}</option>
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
        </div>
        {nFilters > 0 && (
          <button
            type="button"
            onClick={resetFilters}
            className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            {t("Resetează filtrele ({activeFilters})", { activeFilters: nFilters })}
          </button>
        )}
      </div>
      {showMore && fOpen && (
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

      {showReport && (
        <div className="mb-1.5 max-w-3xl rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)]/50 px-2 py-1.5 text-[11px]" data-inv-report="">
          {reportErr ? (
            <p className="text-st-cancelled">{reportErr}</p>
          ) : !reportSum ? (
            <p className="text-ink-soft">{t("se încarcă…")}</p>
          ) : (
            <>
              {/* un card pe serviciu (nu tabel): sumele mari nu mai ies din ecran, pe telefon și pe desktop deopotrivă */}
              <div className="flex flex-col gap-1.5">
                {(
                  [["WATER", "Doar apă"], ["SEWER", "Doar canalizare"], ["BOTH", "Apă + canalizare"], ["NONE", "Fără servicii (consum și sumă zero)"], ["", "Total"]] as const
                ).map(([k, label]) => {
                  const o = k === "" ? reportSum.all : reportSum.by[k];
                  if (k === "NONE" && o.n === 0) return null;
                  // numerele sunt butoane: aplică în listă serviciul și statusul (achitate / neachitate), ca să vezi CARE sunt
                  const pick = (quick: InvQuery["quick"]) => patchQuery({ service: k, statuses: [], quick });
                  const link = (on: boolean, children: React.ReactNode, quick: InvQuery["quick"], disabled: boolean) => (
                    <button type="button" disabled={disabled || o.n === 0} onClick={() => pick(quick)} title={t("Arată în listă care sunt")} className={`cursor-pointer underline decoration-dotted underline-offset-2 hover:text-brand disabled:cursor-default disabled:no-underline ${on ? "font-bold text-brand" : ""}`}>{children}</button>
                  );
                  const svcOff = serverMode && k !== "";
                  const active = query.service === k;
                  const paidOn = active && query.quick === "settled";
                  const unpaidOn = active && query.quick === "debt";
                  const cell = "min-w-0";
                  const lab = "block text-[10px] leading-tight text-ink-soft";
                  const num = "block break-words font-semibold tabular-nums leading-tight";
                  return (
                    <div key={k || "all"} className={`rounded-lg border px-2 py-1.5 ${k === "" ? "border-brand/40 bg-brand-soft/40" : "border-[var(--color-line)] bg-[var(--color-surface)]"} ${k === "NONE" ? "text-ink-soft" : ""}`}>
                      <div className="mb-1 flex items-baseline justify-between gap-2">
                        {k === "" ? (
                          <span className="font-semibold">{t(label)}</span>
                        ) : (
                          <button type="button" disabled={svcOff} onClick={() => patchQuery({ service: query.service === k ? "" : k, statuses: [] })} title={t("Arată doar aceste facturi în listă")} className={`cursor-pointer text-left font-semibold underline decoration-dotted underline-offset-2 hover:text-brand disabled:cursor-default disabled:no-underline ${query.service === k && !query.statuses.length ? "text-brand" : ""}`}>{t(label)}</button>
                        )}
                        <span className="shrink-0 tabular-nums"><b>{o.n.toLocaleString("ro-RO")}</b> <span className="text-ink-soft">{t("facturi")}</span></span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-5">
                        <div className={cell}><span className={lab} title={t("Venitul calculat în perioadă: totalul de plată minus datoria / avansul reportat")}>{t("Calculat")}</span><span className={num}>{fmtMoney(o.calc, reportSum.currency)}</span></div>
                        <div className={cell}><span className={lab} title={t("Au achitat factura anterioară (datoria de pe factură e 0 sau au avans)")}>{t("Achitate")}</span><span className={num}>{link(paidOn, o.settledN.toLocaleString("ro-RO"), "settled", svcOff)}</span></div>
                        <div className={cell}><span className={lab} title={t("Cât au plătit între facturi (dedus din soldul de pe factură)")}>{t("Încasat (sumă)")}</span><span className={`${num} text-st-done`}>{fmtMoney(o.paid, reportSum.currency)}</span></div>
                        <div className={cell}><span className={lab} title={t("Nu au achitat integral factura anterioară: datoria s-a reportat pe factură")}>{t("Neachitate")}</span><span className={num}>{link(unpaidOn, o.owesN.toLocaleString("ro-RO"), "debt", svcOff)}</span></div>
                        <div className={cell}><span className={lab}>{t("Datorie (sumă)")}</span><span className={`${num} text-st-cancelled`}>{fmtMoney(o.rest, reportSum.currency)}</span></div>
                      </div>
                      <p className="mt-1 text-[10px] text-ink-soft">{t("Facturile lunii: {a} achitate · {b} restante", { a: o.paidInvN.toLocaleString("ro-RO"), b: o.overdueN.toLocaleString("ro-RO") })}</p>
                    </div>
                  );
                })}
              </div>
              {reportIncomplete && <p className="mt-1 text-st-progress" data-report-incomplete="">{t("Serviciile unor luni se mai calculează în fundal: cifrele se completează singure în câteva minute.")}</p>}
              <p className="mt-1 text-ink-soft">
                {t("Doar facturile Apă-Canal din perioada aleasă (fără cele anulate și ciornele), pe valută; filtrele listei nu o restrâng. Plățile se citesc din soldul de pe fiecare factură: „Achitate” = au achitat factura anterioară (datorie 0 sau avans), „Încasat” = cât au plătit între facturi, „Neachitate” = datoria s-a reportat pe factură (suma = „Datorie”; pe mai multe luni aceeași datorie poate apărea de mai multe ori). „Facturile lunii” = statusul fiecărei facturi, aflat din factura următoare.")}
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

      <DataTable<InvRow>
        storageKey="invoices"
        rows={tableRows}
        columns={serverMode ? columns.map((c) => ({ ...c, sort: undefined })) : columns}
        showAllRows={serverMode}
        filters={[]}
        noun={t("facturi")}
        emptyText={m.invoices.noInvoices}
        pending={!useLocal && !serverMode ? { total: view.total } : undefined}
        cardKeys={["number", "client", "total"]}
      />


      {serverMode && totalPages > 1 && (
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


/** Scadența a trecut? (în afara componentei, ca randarea să rămână pură). */
function isPast(ms: number | null): boolean {
  return ms != null && ms < Date.now();
}

