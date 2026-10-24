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
import { useInvoiceDataset } from "./useInvoiceDataset";
import { buildPageButtons } from "@/lib/page-buttons";
import { perPageLabel } from "@/lib/payer-notify";
import { INVOICES_PS_COOKIE } from "@/lib/payer-prefs";
import { INVOICE_ALL, INVOICE_DEFAULT_PER_PAGE, INVOICE_PER_PAGE, filterInvoices, type InvoiceListItem, type InvRow } from "@/lib/invoice-list";
import { useT } from "@/lib/i18n/context";

/** Peste atâtea rânduri se desenează doar cele vizibile (virtualizare), ca la plătitori. */
const VIRTUAL_MIN = 80;
const ROW_H = 28;
/** Cât timp lista completă nu e în browser (sau e în modul „server"), serverul dă pagini de cel mult atâtea rânduri. */
const SERVER_MAX_SNAPSHOT_MODE = 200;
const SERVER_MAX_SERVER_MODE = 1000;
/** Lățimile coloanelor tabelului (px): număr, client, emisă, scadență, achitată, sumă, status, acțiuni. */
const COL_W = [150, 230, 92, 92, 92, 105, 105, 270];

type Page = { items: InvRow[]; total: number; totalPages: number };

const fromItem = (i: InvoiceListItem): InvRow => ({
  id: i.id, number: i.number, status: i.status, kind: i.kind, issueMs: Date.parse(i.issueDate), dueMs: i.dueDate ? Date.parse(i.dueDate) : null,
  paidMs: i.paidAt ? Date.parse(i.paidAt) : null, grandTotal: i.grandTotal, currency: i.currency, clientName: i.clientName, publicToken: i.publicToken, _x: null, _h: "",
});

/** Momentul curent (în afara componentei, ca randarea să rămână pură). */
function nowMs(): number {
  return Date.now();
}

const fmtMs = (ms: number | null) => (ms == null ? "—" : fmtDate(new Date(ms)));

export default function InvoicesList({
  initial,
  mode: initialMode,
  origin,
  canImportApaCanal = false,
}: {
  initial: { items: InvoiceListItem[]; page: number; total: number; totalPages: number; perPage: number; status: string; q: string };
  /** "snapshot": toate facturile se pot ține în browser; "server": prea multe, pagini de pe server. */
  mode: "snapshot" | "server";
  origin: string;
  canImportApaCanal?: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const m = useMessages();

  // ── Filtrele sunt locale (schimbarea lor e instantanee în UI); adresa se sincronizează fără navigare ──
  const [status, setStatus] = useState(initial.status);
  const [q, setQ] = useState(initial.q);
  const [search, setSearch] = useState(initial.q);
  const [page, setPage] = useState(initial.page);
  const [wantPerPage, setWantPerPage] = useState(initial.perPage);
  const [goto, setGoto] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── Motor local (toate facturile în browser) sau pagini de pe server ──
  const ds = useInvoiceDataset(true);
  const mode = ds.mode ?? initialMode;
  const useLocal = !!ds.rows;
  const perPage = useLocal ? wantPerPage : Math.min(wantPerPage, mode === "server" ? SERVER_MAX_SERVER_MODE : SERVER_MAX_SNAPSHOT_MODE);
  // Controalele se actualizează imediat; lista (zeci de mii de rânduri) se recalculează în randarea următoare (amânată).
  const listFilters = useDeferredValue({ status, q });
  const localList = useMemo(
    () => (ds.rows ? filterInvoices(ds.rows, listFilters) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ds.rows, ds.version, listFilters],
  );

  const [data, setData] = useState<Page>(() => ({ items: initial.items.map(fromItem), total: initial.total, totalPages: initial.totalPages }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cache = useRef(new Map<string, Page>());
  const abortRef = useRef<AbortController | null>(null);
  const key = `${status}|${q.trim().toLowerCase()}|${page}|${perPage}`;
  // Pagina primită de la server are cel mult 100 de rânduri (vezi page.tsx); pentru alt număr de rânduri aducem pagina potrivită.
  const initialKey = useRef(`${initial.status}|${initial.q.trim().toLowerCase()}|${initial.page}|${Math.min(initial.perPage, 100)}`);
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
    const sp = new URLSearchParams({ status, q, page: String(page), ps: String(perPage) });
    // Cât timp lista completă încă se încarcă local (IndexedDB / rețea), nu pornim imediat o cerere de pagină care oricum ar fi anulată peste câteva zeci de ms.
    const wait = mode === "snapshot" && !ds.rows && reloadTick === 0 ? 350 : 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
    setLoading(true);
    fetch(`/api/invoices/list?${sp}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? m.common.error);
        return j as { items: InvoiceListItem[]; total: number; totalPages: number; page: number };
      })
      .then((j) => {
        const next: Page = { items: j.items.map(fromItem), total: j.total, totalPages: j.totalPages };
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

  const view: Page = useMemo(
    () => (localList ? { items: localList.slice((page - 1) * perPage, page * perPage), total: localList.length, totalPages: Math.max(1, Math.ceil(localList.length / perPage)) } : data),
    [localList, page, perPage, data],
  );
  const totalPages = Math.max(1, Math.ceil(view.total / perPage));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localList && page > totalPages) setPage(totalPages);
  }, [localList, page, totalPages]);
  const rows = view.items;

  // Adresa (link de partajat) fără navigare; alegerea „câte pe pagină" se ține și într-un cookie, pentru randarea pe server.
  useEffect(() => {
    const sp = new URLSearchParams();
    if (status) sp.set("status", status);
    if (q) sp.set("q", q);
    if (page > 1) sp.set("page", String(page));
    if (wantPerPage !== INVOICE_DEFAULT_PER_PAGE) sp.set("ps", String(wantPerPage));
    window.history.replaceState(null, "", `/invoices${sp.toString() ? `?${sp}` : ""}`);
    try { document.cookie = `${INVOICES_PS_COOKIE}=${wantPerPage}; path=/; max-age=31536000; samesite=lax`; } catch {}
  }, [status, q, page, wantPerPage]);

  function onSearch(v: string) {
    setSearch(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => { setQ(v.trim()); setPage(1); }, ds.rows ? 120 : 300);
  }
  function setStatusFilter(s: string) { setStatus(s); setPage(1); }
  function resetFilters() {
    if (debounce.current) clearTimeout(debounce.current);
    setSearch(""); setQ(""); setStatus(""); setPage(1);
  }

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
  }, [status, q, page, perPage, cards]);
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
        <select
          value={status}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={`h-7 appearance-none sel-arrow rounded-lg border pl-1.5 pr-6 text-[11px] outline-none focus:border-brand ${
            status ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)]"
          }`}
          aria-label={t("Status")}
        >
          <option value="">Status: {m.invoices.filterAll.toLowerCase()}</option>
          {INVOICE_STATUS_LIST.map((s) => (
            <option key={s} value={s}>{INVOICE_STATUS[s].label}</option>
          ))}
        </select>
        {(status || q || search) && (
          <button
            type="button"
            onClick={resetFilters}
            className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            {t("Resetează filtrele")}
          </button>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {canImportApaCanal && (
            <ApaCanalJsonImport className="tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-medium text-ink-soft hover:bg-[var(--color-surface-2)]" />
          )}
          <Link
            href="/invoices/new"
            className="tap inline-flex h-7 cursor-pointer items-center rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong"
          >
            {m.invoices.new}
          </Link>
        </div>
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-x-3 text-xs">
        <span>
          <b>{view.total.toLocaleString("ro-RO")}</b> facturi
          {view.total > 0 && <span className="text-ink-soft"> · afișate {from.toLocaleString("ro-RO")}–{to.toLocaleString("ro-RO")} · pagina {page}/{totalPages}</span>}
        </span>
        <span className="text-ink-soft">{t("Σ pagină:")} <b className="tabular-nums text-ink">{money(pageTotal, rows[0]?.currency ?? "MDL")}</b></span>
        {loading && <span className="text-ink-soft">{t("se încarcă…")}</span>}
        {ds.rows && <span className="text-ink-soft" title={t("Lista e ținută în memorie și filtrată instant în browser.")}>{t("⚡ local")}</span>}
        <button
          type="button"
          onClick={toggleCards}
          aria-pressed={cards}
          title={cards ? "Înapoi la tabel" : "Afișează facturile într-o coloană mică; apeși pe una ca să vezi detaliile (potrivit pentru telefon)"}
          className={`tap ml-auto h-7 cursor-pointer rounded-lg border px-2 text-[11px] ${cards ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
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
            {INVOICE_PER_PAGE.map((n) => <option key={n} value={n}>{perPageLabel(n === INVOICE_ALL ? 25_000 : n)}</option>)}
          </select>
        </label>
      </div>
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
                    <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium ${st.cls}`}>{st.label}</span>
                  </>
                }
                trailing={<span className="font-semibold tabular-nums">{money(r.grandTotal, r.currency)}</span>}
              >
                <dl>
                  {r.kind === "APA_CANAL" && <CompactField label={t("Tip")}><span className="rounded bg-sky-100 px-1 text-[10px] font-semibold text-sky-700">Apă-Canal</span></CompactField>}
                  <CompactField label={t("Emisă")}>{fmtMs(r.issueMs)}</CompactField>
                  <CompactField label={t("Scadență")}>
                    <span className={late ? "font-semibold text-st-cancelled" : ""}>{fmtMs(r.dueMs)}{late ? " · depășită" : ""}</span>
                  </CompactField>
                  <CompactField label={t("Achitată")}>
                    {r.status === "PAID" ? (
                      r.paidMs ? <span className="text-st-done">{fmtMs(r.paidMs)}</span> : <span className="text-ink-soft/70">{t("? (data nu s-a înregistrat)")}</span>
                    ) : <span className="text-ink-soft/60">—</span>}
                  </CompactField>
                  <CompactField label={t("Status")}>
                    <select
                      value={r.status}
                      onChange={(e) => changeStatus(r.id, e.target.value as InvoiceStatusKey)}
                      className={`h-6 cursor-pointer rounded-full border-0 px-2 text-[12px] font-medium outline-none ${st.cls}`}
                      aria-label={`Status ${r.number}`}
                    >
                      {INVOICE_STATUS_LIST.map((x) => (
                        <option key={x} value={x}>{INVOICE_STATUS[x].label}</option>
                      ))}
                    </select>
                  </CompactField>
                </dl>
                <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)]/60 px-2.5 py-1.5">
                  <InvoiceViewButton token={r.publicToken} title={`${r.number}${r.clientName ? ` · ${r.clientName}` : ""}`} className={cardBtn} />
                  <Link href={`/invoices/${r.id}/edit`} className={cardBtn}>{m.common.edit}</Link>
                  <button type="button" onClick={() => copyLink(r.publicToken)} className={cardBtn}>
                    {copied === r.publicToken ? m.invoices.copied : m.invoices.copyLink}
                  </button>
                  <a href={`/invoice/public/${r.publicToken}`} target="_blank" rel="noopener noreferrer" className={cardBtn}>
                    {m.invoices.publicPdf} ↗
                  </a>
                  <button type="button" onClick={() => remove(r.id)} className={`${cardBtn} text-st-cancelled`} title={m.common.delete} aria-label={m.common.delete}>
                    <IconTrash className="size-3.5" />
                  </button>
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
              <Th>{t("Număr")}</Th>
              <Th>{t("Client")}</Th>
              <Th>{t("Emisă")}</Th>
              <Th>{t("Scadență")}</Th>
              <Th>{t("Achitată")}</Th>
              <Th right>{t("Sumă")}</Th>
              <Th>{t("Status")}</Th>
              <Th>{t("Acțiuni")}</Th>
            </tr>
          </thead>
          <tbody>
            {winStart > 0 && (
              <tr aria-hidden>
                <td colSpan={8} style={{ height: winStart * ROW_H, padding: 0, border: 0 }} />
              </tr>
            )}
            {winRows.map((r) => {
              const st = INVOICE_STATUS[r.status];
              const late = r.status !== "PAID" && r.status !== "CANCELLED" && isPast(r.dueMs);
              const cell = "border-b border-[var(--color-line)] px-1.5 py-[2px]";
              return (
                <tr key={r.id} style={{ height: ROW_H }} className="hover:bg-brand-soft/30">
                  <td className={`${cell} whitespace-nowrap font-semibold`}>
                    {r.number}
                    {r.kind === "APA_CANAL" && (
                      <span className="ml-1.5 rounded bg-sky-100 px-1 text-[9px] font-semibold text-sky-700">Apă-Canal</span>
                    )}
                  </td>
                  <td className={cell}>
                    <div className="truncate" title={r.clientName ?? ""}>{r.clientName ?? <span className="text-ink-soft/60">{m.invoices.noClient}</span>}</div>
                  </td>
                  <td className={`${cell} whitespace-nowrap`}>{fmtMs(r.issueMs)}</td>
                  <td className={`${cell} whitespace-nowrap ${late ? "font-semibold text-st-cancelled" : ""}`} title={late ? "Scadența a trecut" : undefined}>{fmtMs(r.dueMs)}</td>
                  <td className={`${cell} whitespace-nowrap`}>
                    {r.status === "PAID" ? (
                      r.paidMs ? <span className="text-st-done">{fmtMs(r.paidMs)}</span> : <span className="text-ink-soft/70" title={t("Marcată plătită, dar data nu s-a înregistrat")}>?</span>
                    ) : <span className="text-ink-soft/60">—</span>}
                  </td>
                  <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums`}>{money(r.grandTotal, r.currency)}</td>
                  <td className={cell}>
                    <select
                      value={r.status}
                      onChange={(e) => changeStatus(r.id, e.target.value as InvoiceStatusKey)}
                      className={`h-[18px] cursor-pointer rounded-full border-0 px-1.5 text-[10px] font-medium outline-none ${st.cls}`}
                      aria-label={`Status ${r.number}`}
                    >
                      {INVOICE_STATUS_LIST.map((s) => (
                        <option key={s} value={s}>{INVOICE_STATUS[s].label}</option>
                      ))}
                    </select>
                  </td>
                  <td className={cell}>
                    <div className="flex items-center gap-1">
                      <InvoiceViewButton token={r.publicToken} title={`${r.number}${r.clientName ? ` · ${r.clientName}` : ""}`} className={btn} />
                      <Link href={`/invoices/${r.id}/edit`} className={btn}>{m.common.edit}</Link>
                      <button type="button" onClick={() => copyLink(r.publicToken)} className={btn}>
                        {copied === r.publicToken ? m.invoices.copied : m.invoices.copyLink}
                      </button>
                      <a href={`/invoice/public/${r.publicToken}`} target="_blank" rel="noopener noreferrer" className={btn}>
                        {m.invoices.publicPdf} ↗
                      </a>
                      <button type="button" onClick={() => remove(r.id)} className={`${btn} text-st-cancelled`} title={m.common.delete} aria-label={m.common.delete}>
                        <IconTrash className="size-3" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {winEnd < rows.length && (
              <tr aria-hidden>
                <td colSpan={8} style={{ height: (rows.length - winEnd) * ROW_H, padding: 0, border: 0 }} />
              </tr>
            )}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={8} className="p-8 text-center text-ink-soft">{m.invoices.noInvoices}</td></tr>
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
            Mergi la
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

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-1 font-semibold ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}
