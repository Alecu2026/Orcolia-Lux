"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ONEC_COLUMNS, type OneCColumn } from "@/lib/apa-canal-1c";
import { useT } from "@/lib/i18n/context";
import { HEAD, IDX_DIFF, IDX_PWA_TOTAL, IDX_TOKEN, TOLERANCE, filterOneC, type OneCTuple } from "@/lib/onec-table";
import { PER_PAGE_ALL, perPageLabel } from "@/lib/payer-notify";
import { useOneCDataset } from "./useOneCDataset";

type Row = Record<string, string | number | null> & {
  id: string;
  clientId: string | null;
  invoiceNumber: string | null;
  pwaTotal: number | null;
  diff: number | null;
  invoiceToken: string | null;
};
type ServerPayload = {
  items: Row[];
  total: number;
  page: number;
  perPage: number;
  sums: { calculat: number; datorieAvans: number; deAchitat: number };
  months: { month: string; count: number }[];
  period: string;
};

const LUNI = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const monthLabel = (m: string) => `${LUNI[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} ${m.slice(0, 4)}`;
type Detail = {
  id: string; uid: string; nume: string; payerId: string | null; invoiceId: string | null; invoiceNumber: string | null;
  consumers: Record<string, string | number | null>[] | null;
  meters: Record<string, string | number | null>[] | null;
  readings: Record<string, string | number | null>[] | null;
  lines: Record<string, string | number | null>[] | null;
};

const MONEY = new Set(["calculat", "datorieAvans", "deAchitat", "apaSuma", "canalSuma", "apaTarif", "canalTarif"]);
const PER_PAGE = [50, 100, 200, 500, 1000, PER_PAGE_ALL];
const ROW_H = 28; // înălțimea fixă a unui rând (necesară virtualizării)
const HEAD_H = 76; // antetul (titlu + filtru) — rândurile încep sub el
const VIEW_H = 640; // înălțimea zonei derulabile
const OVER = 8;
const VIRT_MIN = 60; // peste atâtea rânduri pe pagină se desenează doar cele vizibile

/** Un rând primit de la server („Toate lunile”) în aceeași formă de tuplu ca în snapshot. */
function serverRowToTuple(r: Row): OneCTuple {
  return [r.id, r.clientId, r.invoiceNumber, ...ONEC_COLUMNS.map((c) => (r[c.key] ?? null) as string | number | null), r.pwaTotal, r.diff, r.invoiceToken];
}

const money = (n: number | null | undefined) =>
  n == null ? "" : n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmt(col: OneCColumn, v: string | number | null | undefined) {
  if (v == null || v === "") return "";
  if (col.type === "num") return MONEY.has(col.key) ? money(Number(v)) : String(v);
  return String(v);
}

const inputCls =
  "h-7 w-full min-w-0 rounded-md border border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 text-xs font-normal outline-none focus:border-brand";

export default function OneCTable({ canExport = true }: { canExport?: boolean } = {}) {
  const tr = useT();
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState("nume");
  const [dir, setDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(100);
  const [onlyDiff, setOnlyDiff] = useState(false);
  // Implicit un rând per abonat (luna cea mai recentă) — UID-ul 1C e per chitanță, deci altfel același
  // abonat apare o dată pentru fiecare lună importată.
  const [period, setPeriod] = useState("latest");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [previewToken, setPreviewToken] = useState<string | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  // „Toate lunile” (un rând per abonat ȘI lună) ar fi de zeci de ori mai mare: rămâne pe interogări server (filtre cu pauză de tastare, max. 500 pe pagină).
  const serverMode = period === "all";
  const ds = useOneCDataset(serverMode ? null : period);
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [srv, setSrv] = useState<ServerPayload | null>(null);
  const [srvLoading, setSrvLoading] = useState(false);
  const [srvError, setSrvError] = useState<string | null>(null);
  const reqId = useRef(0);
  const appliedRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!serverMode) return;
    const t = setTimeout(() => {
      const prev = appliedRef.current;
      const same = Object.keys({ ...prev, ...filters }).every((k) => (prev[k] ?? "") === (filters[k] ?? ""));
      if (same) return;
      appliedRef.current = filters;
      setApplied(filters);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [filters, serverMode]);

  const queryString = useCallback(
    (extra: Record<string, string> = {}, f: Record<string, string> = filters) => {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(f)) if (v.trim()) sp.set(`f_${k}`, v.trim());
      sp.set("sort", sort);
      sp.set("dir", dir);
      if (onlyDiff) sp.set("diff", "1");
      sp.set("period", period);
      for (const [k, v] of Object.entries(extra)) sp.set(k, v);
      return sp.toString();
    },
    [filters, sort, dir, onlyDiff, period],
  );

  const effPerPage = serverMode ? Math.min(perPage === PER_PAGE_ALL ? 500 : perPage, 500) : perPage;
  useEffect(() => {
    if (!serverMode) return;
    const id = ++reqId.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- inițializare / resetare declanșată de schimbarea dependențelor (nu se poate deriva în randare)
    setSrvLoading(true);
    setSrvError(null);
    fetch(`/api/platitori/tabel?${queryString({ page: String(page), perPage: String(effPerPage) }, applied)}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Eroare la încărcare.");
        return j as ServerPayload;
      })
      .then((j) => { if (id === reqId.current) setSrv(j); })
      .catch((e: Error) => { if (id === reqId.current) setSrvError(tr(e.message)); })
      .finally(() => { if (id === reqId.current) setSrvLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverMode, applied, sort, dir, onlyDiff, page, effPerPage]);

  // ── modul local: filtrare / sortare / totaluri pe lista completă din browser ──
  const dFilters = useDeferredValue(filters);
  const local = useMemo(
    () => (!serverMode && ds.rows ? filterOneC(ds.rows, { filters: dFilters, onlyDiff, sort, dir }) : null),
    [serverMode, ds.rows, dFilters, onlyDiff, sort, dir],
  );
  const total = serverMode ? (srv?.total ?? 0) : (local?.total ?? 0);
  const sums = serverMode ? srv?.sums : local?.sums;
  const months = serverMode ? (srv?.months ?? ds.months) : ds.months;
  const allPage = !serverMode && perPage === PER_PAGE_ALL;
  const pageSize = allPage ? Math.max(total, 1) : effPerPage;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const curPage = Math.min(page, pages);
  const loading = serverMode ? srvLoading : ds.loading;
  const error = serverMode ? srvError : ds.error;

  // rândurile paginii curente, ca tupluri (modul server: din răspuns, în aceeași formă)
  const pageRows: OneCTuple[] = useMemo(() => {
    if (serverMode) return (srv?.items ?? []).map(serverRowToTuple);
    if (!local || !ds.rows) return [];
    const out: OneCTuple[] = [];
    const from = (curPage - 1) * pageSize;
    for (let k = from; k < Math.min(from + pageSize, local.idx.length); k++) out.push(ds.rows[local.idx[k]]);
    return out;
  }, [serverMode, srv, local, ds.rows, curPage, pageSize]);

  const virt = pageRows.length > VIRT_MIN;
  const start = virt ? Math.max(0, Math.floor(Math.max(0, scrollTop - HEAD_H) / ROW_H) - OVER) : 0;
  const end = virt ? Math.min(pageRows.length, Math.ceil((scrollTop + VIEW_H) / ROW_H) + OVER) : pageRows.length;
  useEffect(() => {
    if (box.current) box.current.scrollTop = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- inițializare / resetare declanșată de schimbarea dependențelor (nu se poate deriva în randare)
    setScrollTop(0);
  }, [curPage, perPage, sort, dir, onlyDiff, period, dFilters]);

  const activeFilters = Object.values(filters).filter((v) => v.trim()).length + (onlyDiff ? 1 : 0);
  const exportUrl = useCallback((sheet: string) => `/api/platitori/tabel/export?${queryString({ sheet })}`, [queryString]);

  function toggleSort(key: string) {
    if (sort === key) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSort(key); setDir("asc"); }
    setPage(1);
  }
  const setFilter = (key: string, v: string) => { setFilters((f) => ({ ...f, [key]: v })); setPage(1); };
  const waiting = !serverMode && !ds.rows && !ds.error;
  const colSpan = ONEC_COLUMNS.length + 4;

  return (
    <div data-onec="" data-mode={serverMode ? "server" : "local"}>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <select
          value={period}
          onChange={(e) => { setPeriod(e.target.value); setPage(1); }}
          className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm font-medium"
          aria-label={tr("Luna")}
        >
          <option value="latest">{tr("Luna cea mai recentă (un rând per abonat)")}</option>
          {months.map((m) => (
            <option key={m.month} value={m.month}>{tr("Doar {v1} ({v2})", { v1: monthLabel(m.month), v2: m.count.toLocaleString("ro-RO") })}</option>
          ))}
          <option value="all">{tr("Toate lunile (un rând per abonat și lună)")}</option>
        </select>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={onlyDiff} onChange={(e) => { setOnlyDiff(e.target.checked); setPage(1); }} className="size-4 accent-[var(--color-brand)]" />
          {tr("Doar diferențe PWA ≠ 1C")}
        </label>
        <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} className="h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm" aria-label={tr("Rânduri pe pagină")}>
          {PER_PAGE.map((n) => <option key={n} value={n} disabled={serverMode && n > 500}>{perPageLabel(n, tr)}</option>)}
        </select>
        {activeFilters > 0 && (
          <button type="button" onClick={() => { appliedRef.current = {}; setFilters({}); setApplied({}); setOnlyDiff(false); setPage(1); }} className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-sm text-ink-soft hover:bg-[var(--color-surface-2)]">
            {tr("Resetează filtrele ({activeFilters})", { activeFilters })}</button>
        )}
        {canExport && <details className="relative ml-auto">
          <summary className="tap inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg bg-brand px-3 text-sm font-semibold text-white hover:bg-brand-strong">
            {tr("📊 Descarcă Excel ▾")}
          </summary>
          <div className="absolute right-0 z-40 mt-1 w-72 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-xl">
            <p className="px-3 py-1.5 text-[11px] text-ink-soft">{tr("Cu filtrele curente și filtru pe fiecare coloană în Excel. Fiecare tabel are UID.")}</p>
            {(
              [
                ["main", "Tabel comun (după filtrul de lună)"],
                ["consumers", "Consumatori (Потребители)"],
                ["meters", "Contoare (ИзмерительныеПриборы)"],
                ["readings", "Citiri (Потребления)"],
                ["lines", "Linii de calcul (РасчетСумм)"],
              ] as const
            ).map(([k, l]) => (
              <a key={k} href={exportUrl(k)} download onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")} className="block rounded-lg px-3 py-2 text-sm hover:bg-[var(--color-surface-2)]">{tr(l)}</a>
            ))}
          </div>
        </details>}
      </div>

      <p className="mb-2 text-xs text-ink-soft">
        {tr("Filtrele merg pe fiecare coloană (text: „conține”). La coloanele cu numere poți scrie")} <b>&gt;100</b>, <b>&lt;=0</b>, <b>=45.3</b> {tr("sau un interval")} <b>10-50</b>{tr(". Click pe un rând = toate datele lui din cele 6 tabele 1C. În 1C, UID-ul e al chitanței unei luni, nu al abonatului — la „Toate lunile” același abonat apare o dată pentru fiecare lună (vezi coloana „Data document”).")}
      </p>
      {serverMode && <p className="mb-2 text-xs text-st-progress">{tr("„Toate lunile”: filtrele rulează pe server (cu pauză de tastare), cel mult 500 de rânduri pe pagină.")}</p>}

      {sums && (
        <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-sm" data-onec-summary="">
          <span><b>{total.toLocaleString("ro-RO")}</b> {period === "all" ? tr("rânduri (abonat × lună)") : tr("abonați")}</span>
          <span>{tr("Σ Calculat:")} <b>{money(sums.calculat)}</b></span>
          <span>{tr("Σ Datorie/avans:")} <b>{money(sums.datorieAvans)}</b></span>
          <span>{tr("Σ De achitat:")} <b>{money(sums.deAchitat)}</b></span>
          {loading && <span className="text-ink-soft">{tr("se încarcă…")}</span>}
        </div>
      )}
      {waiting && (
        <p className="mb-2 flex items-center gap-2 text-sm text-ink-soft" data-onec-loading="">
          <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          {tr("Se încarcă tabelul 1C (prima dată durează mai mult; apoi rămâne în browser)…")}
        </p>
      )}
      {error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {tr(error)}
          {!serverMode && <button type="button" onClick={() => void ds.refresh()} className="tap shrink-0 font-semibold underline">{tr("Reîncearcă")}</button>}
        </p>
      )}

      <div ref={box} className="card overflow-auto" style={{ maxHeight: "68vh" }} onScroll={virt ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined} data-onec-scroll="">
        <table className="w-max min-w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-20 bg-[var(--color-surface-2)]">
            <tr>
              {ONEC_COLUMNS.map((c, i) => (
                <th
                  key={c.key}
                  style={{ minWidth: c.w, width: c.w }}
                  title={tr("Câmp 1C: {src}", { src: tr(c.src) })}
                  className={`border-b border-[var(--color-line)] px-2 pt-2 text-left align-bottom ${i === 1 ? "sticky left-0 z-30 bg-[var(--color-surface-2)]" : ""}`}
                >
                  <button type="button" onClick={() => toggleSort(c.key)} className="flex w-full items-center gap-1 pb-1 text-left font-semibold hover:text-brand">
                    <span className="truncate">{tr(c.label)}</span>
                    <span className="shrink-0 text-[10px] text-ink-soft">{sort === c.key ? (dir === "asc" ? "▲" : "▼") : "↕"}</span>
                  </button>
                  <input
                    value={filters[c.key] ?? ""}
                    onChange={(e) => setFilter(c.key, e.target.value)}
                    placeholder={c.type === "num" ? ">100 · 10-50" : tr("Filtru…")}
                    className={`${inputCls} mb-2`}
                    aria-label={`${tr("Filtru")} ${tr(c.label)}`}
                    data-filter={c.key}
                  />
                </th>
              ))}
              <th className="border-b border-[var(--color-line)] px-2 pt-2 text-left align-top font-semibold" style={{ minWidth: 110 }}>{tr("Factură PWA")}</th>
              <th className="border-b border-[var(--color-line)] px-2 pt-2 text-center align-top font-semibold" style={{ minWidth: 50 }}>{tr("Vezi")}</th>
              <th className="border-b border-[var(--color-line)] px-2 pt-2 text-right align-top font-semibold" style={{ minWidth: 100 }}>{tr("Total PWA")}</th>
              <th className="border-b border-[var(--color-line)] px-2 pt-2 text-right align-top font-semibold" style={{ minWidth: 110 }}>{tr("Diferență PWA − 1C")}</th>
            </tr>
          </thead>
          <tbody>
            {virt && start > 0 && <tr aria-hidden="true"><td colSpan={colSpan} style={{ height: start * ROW_H, padding: 0, border: 0 }} /></tr>}
            {pageRows.slice(start, end).map((r) => {
              const id = String(r[0]);
              const token = r[IDX_TOKEN] as string | null;
              const diff = r[IDX_DIFF] as number | null;
              return (
                <tr key={id} data-onec-row={id} onClick={() => setDetailId(id)} className="cursor-pointer hover:bg-brand-soft/40" style={{ height: ROW_H }}>
                  {ONEC_COLUMNS.map((c, i) => {
                    const text = fmt(c, r[HEAD + i]);
                    return (
                      <td
                        key={c.key}
                        className={`border-b border-[var(--color-line)] px-2 ${c.type === "num" ? "text-right tabular-nums" : ""} ${i === 1 ? "sticky left-0 z-10 bg-[var(--color-surface)] font-medium" : ""}`}
                        style={{ maxWidth: Math.max(c.w, 160) }}
                      >
                        <div className="truncate" title={text}>{text}</div>
                      </td>
                    );
                  })}
                  <td className="border-b border-[var(--color-line)] px-2">{r[2]}</td>
                  <td className="border-b border-[var(--color-line)] px-2 text-center">
                    {token && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setPreviewToken(token); }}
                        title={tr("Vezi factura (pop-up, fără să navighezi)")}
                        className="tap rounded-lg border border-[var(--color-line)] px-2 py-0.5 text-xs hover:bg-brand-soft hover:text-brand-strong"
                      >
                        👁
                      </button>
                    )}
                  </td>
                  <td className="border-b border-[var(--color-line)] px-2 text-right tabular-nums">{money(r[IDX_PWA_TOTAL] as number | null)}</td>
                  <td className={`border-b border-[var(--color-line)] px-2 text-right tabular-nums ${diff && Math.abs(diff) > TOLERANCE ? "font-semibold text-st-cancelled" : ""}`}>{money(diff)}</td>
                </tr>
              );
            })}
            {virt && end < pageRows.length && <tr aria-hidden="true"><td colSpan={colSpan} style={{ height: (pageRows.length - end) * ROW_H, padding: 0, border: 0 }} /></tr>}
            {!waiting && !loading && pageRows.length === 0 && (
              <tr><td colSpan={colSpan} className="p-8 text-center text-ink-soft">{tr("Niciun abonat cu filtrele acestea.")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between text-sm" data-onec-pager="">
        <button type="button" disabled={curPage <= 1 || (serverMode && loading)} onClick={() => setPage(curPage - 1)} className="tap card rounded-lg px-3 py-2 disabled:opacity-40">{tr("‹ Anterior")}</button>
        <span className="text-center text-ink-soft">
          {tr("Pagina")} {curPage} {tr("din")} {pages}
          {total > 0 && <><br /><span className="text-xs">{(curPage - 1) * pageSize + 1}–{Math.min(curPage * pageSize, total)} {tr("din")} {total.toLocaleString("ro-RO")}</span></>}
        </span>
        <button type="button" disabled={curPage >= pages || (serverMode && loading)} onClick={() => setPage(curPage + 1)} className="tap card rounded-lg px-3 py-2 disabled:opacity-40">{tr("Următor ›")}</button>
      </div>

      {detailId && <DetailDialog id={detailId} onClose={() => setDetailId(null)} />}
      {previewToken && <InvoicePreviewDialog token={previewToken} onClose={() => setPreviewToken(null)} />}
    </div>
  );
}

/** Pop-up cu factura reală (exact ce vede clientul/PDF-ul), pentru verificare rapidă rând cu rând —
 * randează pagina publică într-un iframe, nu o reimplementare separată, ca să fie mereu identică. */
function InvoicePreviewDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-[var(--color-surface)] shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] px-4 py-2.5">
          <h2 className="text-sm font-semibold">{t("Factură — verificare rapidă")}</h2>
          <div className="flex items-center gap-2">
            <a href={`/invoice/public/${token}`} target="_blank" rel="noreferrer" className="tap rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs hover:bg-[var(--color-surface-2)]">
              {t("Deschide în filă nouă")}
            </a>
            <button type="button" onClick={onClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>✕</button>
          </div>
        </div>
        <iframe src={`/invoice/public/${token}`} title={t("Factură")} className="w-full flex-1 bg-white" />
      </div>
    </div>
  );
}

function MiniTable({ title, rows, cols }: { title: string; rows: Record<string, string | number | null>[] | null; cols: [string, string][] }) {
  const t = useT();
  const list = rows ?? [];
  return (
    <section className="mb-4">
      <h3 className="mb-1 text-sm font-semibold">{title} <span className="font-normal text-ink-soft">({list.length})</span></h3>
      {list.length === 0 ? (
        <p className="text-xs text-ink-soft">{t("— niciun rând în fișierul 1C —")}</p>
      ) : (
        // Doar overflow orizontal aici, fără antet fix (sticky) — un glisor propriu pe verticală,
        // imbricat în cel al ferestrei de detaliu (cum era înainte, cu antet fix pe amândouă),
        // declanșează pe iOS/Safari un bug cunoscut de randare: rândurile se suprapun fantomatic la
        // derulare (exact ce s-a văzut pe telefon). Notă: chiar și fără maxHeight/overflow-y explicit,
        // simplul `overflow-x: auto` face browserul să trateze acest div ca "glisor" și pe verticală
        // (regulă CSS: o axă non-"visible" o transformă și pe cealaltă din "visible" în "auto"), ceea ce
        // ar rupe din nou ancorarea "sticky" la glisorul ferestrei — de-aia headerul NU mai e sticky aici.
        <div className="overflow-x-auto rounded-lg border border-[var(--color-line)]">
          <table className="w-max min-w-full text-xs">
            <thead className="bg-[var(--color-surface-2)]">
              <tr>{cols.map(([k, l]) => <th key={k} className="whitespace-nowrap px-2 py-1 text-left font-semibold">{l}</th>)}</tr>
            </thead>
            <tbody>
              {list.map((r, i) => (
                <tr key={i} className="border-t border-[var(--color-line)]">
                  {cols.map(([k]) => <td key={k} className="whitespace-nowrap px-2 py-1">{r[k] == null || r[k] === "" ? "" : String(r[k])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const t = useT();
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/platitori/tabel?detail=${id}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Eroare."); return j as Detail; })
      .then((j) => alive && setD(j))
      .catch((e: Error) => alive && setErr(t(e.message)));
    return () => { alive = false; };
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-5xl overflow-auto rounded-t-2xl bg-[var(--color-surface)] p-4 shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{d?.nume ?? t("Se încarcă…")}</h2>
            {d && <p className="break-all text-xs text-ink-soft">{t("UID: {uid} · Factură: {v1}", { uid: d.uid, v1: d.invoiceNumber ?? "—" })}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {d?.payerId && <Link href={`/platitori/${d.payerId}`} className="tap rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]">{t("Fișa plătitorului")}</Link>}
            {d?.invoiceId && <Link href={`/invoices/${d.invoiceId}/edit`} className="tap rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-sm hover:bg-[var(--color-surface-2)]">{t("Factura")}</Link>}
            <button type="button" onClick={onClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>✕</button>
          </div>
        </div>
        {err && <p className="text-sm text-st-cancelled">{t(err)}</p>}
        {d && (
          <>
            <MiniTable title={t("Consumatori (Потребители)")} rows={d.consumers} cols={[["perioada", "Perioadă"], ["nume", "Consumator"], ["inn", "IDNO/ИНН"], ["inceput", "Început"], ["sfarsit", "Sfârșit"], ["zona", "Zonă presiune"], ["sector", "Sector"], ["nrPersoane", "Nr. pers."], ["suprafata", "Suprafață"]]} />
            <MiniTable title={t("Contoare (ИзмерительныеПриборы)")} rows={d.meters} cols={[["perioada", "Perioadă"], ["consumator", "Consumator"], ["contor", "Contor"], ["dataInstalare", "Instalat"], ["sigiliu", "Sigiliu"], ["dataScoatere", "Scos"], ["subAbonat", "Sub-abonat"], ["subContract", "Sub-contract"], ["subCont", "Sub-cont"], ["subContor", "Sub-contor"]]} />
            <MiniTable title={t("Citiri (Потребления)")} rows={d.readings} cols={[["consumator", "Consumator"], ["contor", "Contor"], ["sursa", "Sursa"], ["citirePrec", "Citire ant."], ["dataPrec", "Data ant."], ["citire", "Citire"], ["dataCitire", "Data"], ["consum", "Consum"], ["medie", "Medie"], ["consumSubcontoare", "Subcontoare"]]} />
            <MiniTable title={t("Linii de calcul (РасчетСумм)")} rows={d.lines} cols={[["consumator", "Consumator"], ["contor", "Contor"], ["serviciu", "Serviciu"], ["volum", "Volum"], ["tarif", "Tarif"], ["suma", "Sumă"], ["data", "Data"]]} />
          </>
        )}
      </div>
    </div>
  );
}
