"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  EMPTY_METER_FILTERS,
  countActiveMeterFilters,
  distinctSources,
  filterMeters,
  meterFiltersToParams,
  sanitizeMeterFilters,
  type MeterFilters,
  type MeterRowBase,
} from "@/lib/meters";
import { DEFAULT_PER_PAGE, NOTIFY_PER_PAGE, PER_PAGE_ALL, normalizePerPageClient, perPageLabel } from "@/lib/payer-notify";
import { METERS_PP_COOKIE } from "@/lib/payer-prefs";
import { INVOICE_STATUS, INVOICE_STATUS_LIST, type InvoiceStatusKey } from "./invoice-meta";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { useToast } from "./toast";
import CompactCard, { CompactField } from "./CompactCard";
import VirtualList from "./VirtualList";
import MeterDetailDialog from "./MeterDetailDialog";
import { useMeterDataset } from "./useMeterDataset";

type Page = { items: MeterRowBase[]; total: number };
type TextKey = "q" | "street";

// Aceleași clase ca filtrele din Plătitori: câmpul cu valoare aleasă capătă fundal/chenar colorat.
const fld = (val: string) =>
  `h-7 min-w-0 max-w-full appearance-none sel-arrow rounded-lg border pl-1.5 pr-6 text-[11px] outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;
const txtFld = (val: string) =>
  `h-7 min-w-0 rounded-lg border px-2 text-[11px] outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand placeholder:font-normal" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;

/** Lățimile coloanelor (px), în ordinea din antet: contor, abonat, cont/contract, adresă, consumator, status, instalat, sigiliu, citire ant., citire curentă,
 * data citirii, consum, sursă, apă, canal, contoare abonat, factură, de achitat, status factură, telefon, portal. */
const COL_W = [115, 190, 95, 210, 150, 62, 80, 85, 82, 86, 80, 70, 100, 125, 125, 62, 85, 90, 72, 100, 52];
const SERVER_MAX_ROWS = 200; // doar cât timp lista completă nu e încă în browser (răspunsul vine de pe server)
const VIRTUAL_MIN = 80; // peste atâtea rânduri se desenează doar cele vizibile
const ROW_H = 24; // înălțimea fixă a unui rând de tabel (necesară virtualizării)

function queryKey(f: MeterFilters, page: number, perPage: number): string {
  return meterFiltersToParams(sanitizeMeterFilters(f), { page, perPage }).toString();
}

export default function MetersManager({
  initial,
  serverFailed = false,
  warming = false,
  canTask = false,
}: {
  initial: { filters: MeterFilters; page: number; perPage: number; items: MeterRowBase[]; total: number };
  /** Prima listă n-a putut fi citită pe server — arătăm eroarea cu „Reîncearcă" până sosește lista completă în browser. */
  serverFailed?: boolean;
  /** Serverul încă construiește lista (prima construire e lentă): fără eroare, browserul o cere și o afișează când e gata. */
  warming?: boolean;
  /** Are „Sarcini – Creare": rândul are „+" pentru o sarcină nouă (clientul și adresa se completează singure). */
  canTask?: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag);
  const num = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 3 });
  const money = (n: number) => n.toLocaleString(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dmy = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join(".") : "");
  const STORAGE_KEY = "filters:/contoare";

  // ── Stare: filtrele sunt locale (schimbarea lor e instantanee în UI), datele vin de pe server doar până se încarcă lista completă ──
  const [filters, setFilters] = useState<MeterFilters>(initial.filters);
  const [draft, setDraft] = useState<Record<TextKey, string>>({ q: initial.filters.q, street: initial.filters.street });
  const [page, setPage] = useState(initial.page);
  const [wantPerPage, setPerPage] = useState(initial.perPage); // ce a ales utilizatorul (se salvează); `perPage` = cât desenăm de fapt
  const [data, setData] = useState<Page>({ items: initial.items, total: initial.total });
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(serverFailed ? t("Nu am putut încărca lista de contoare.") : null);
  const [ready, setReady] = useState(false);
  const [detailRow, setDetailRow] = useState<MeterRowBase | null>(null);
  const debounce = useRef<Partial<Record<TextKey, ReturnType<typeof setTimeout>>>>({});
  const abortRef = useRef<AbortController | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  // Mod telefon: fiecare contor devine un card. `cardsPref` = alegerea utilizatorului; null = automat (carduri pe ecrane înguste, tabel pe restul).
  const [cardsPref, setCardsPref] = useState<boolean | null>(null);
  const [narrow, setNarrow] = useState(false);
  const cards = cardsPref ?? narrow;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNarrow(window.matchMedia("(max-width: 639px)").matches);
    try {
      const v = localStorage.getItem("meters-view");
      if (v === "cards" || v === "table") setCardsPref(v === "cards");
    } catch {}
  }, []);
  function toggleCards() {
    const next = !cards;
    setCardsPref(next);
    try { localStorage.setItem("meters-view", next ? "cards" : "table"); } catch {}
  }

  // ── Motor local: toate contoarele în memorie, filtrate/sortate/paginate în JS (instant). Până se încarcă setul, pagina folosește serverul. ──
  const ds = useMeterDataset(ready);
  // Controalele se actualizează imediat; lista de ~25.000 de rânduri se recalculează în randarea următoare (amânată), deci un select nu „se agață".
  const listFilters = useDeferredValue(filters);
  const useLocal = !!ds.rows;
  const perPage = useLocal ? wantPerPage : Math.min(wantPerPage, SERVER_MAX_ROWS);
  const key = queryKey(filters, page, perPage);
  const localList = useMemo(
    () => (ds.rows ? filterMeters(ds.rows, sanitizeMeterFilters(listFilters)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ds.rows, ds.version, listFilters],
  );
  const view: Page = useMemo(
    () => (localList ? { items: localList.slice((page - 1) * perPage, page * perPage), total: localList.length } : data),
    [localList, page, perPage, data],
  );
  // „Toate" ales, dar lista completă încă n-a ajuns: arătăm deja totalul și primele rânduri (restul sunt rânduri goale care se umplu singure).
  const showAll = !useLocal && wantPerPage >= PER_PAGE_ALL && page === 1 && view.total > view.items.length;
  const uiPerPage = showAll ? view.total : perPage;
  const totalPages = Math.max(1, Math.ceil(view.total / uiPerPage));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (localList && page > totalPages) setPage(totalPages);
  }, [localList, page, totalPages]);

  // Restaurează filtrele salvate (doar dacă URL-ul nu are propriile filtre) — ca la Plătitori.
  useEffect(() => {
    const urlEmpty = countActiveMeterFilters(initial.filters) === 0 && !initial.filters.sort && initial.page === 1;
    if (urlEmpty) {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { f?: unknown; perPage?: unknown } | null;
        if (saved) {
          const f = sanitizeMeterFilters((saved.f ?? {}) as Record<string, unknown>);
          const pp = normalizePerPageClient(saved.perPage);
          if (countActiveMeterFilters(f) > 0 || f.sort) {
            // Citire din localStorage după hidratare (serverul nu o poate face) — același tipar ca la Plătitori.
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setFilters(f);
            setDraft({ q: f.q, street: f.street });
          }
          if (pp !== initial.perPage) setPerPage(pp);
        }
      } catch {}
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salvează filtrele + sincronizează URL-ul (link de partajat), fără navigare.
  useEffect(() => {
    if (!ready) return;
    const f = sanitizeMeterFilters(filters);
    const empty = countActiveMeterFilters(f) === 0 && !f.sort;
    try {
      if (empty && wantPerPage === DEFAULT_PER_PAGE) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify({ f, perPage: wantPerPage }));
      document.cookie = `${METERS_PP_COOKIE}=${wantPerPage}; path=/; max-age=31536000; samesite=lax`; // pentru randarea pe server
    } catch {}
    const usp = meterFiltersToParams(f);
    if (page > 1) usp.set("page", String(page));
    if (wantPerPage !== DEFAULT_PER_PAGE) usp.set("perPage", String(wantPerPage));
    const qs = usp.toString();
    window.history.replaceState(null, "", `/contoare${qs ? `?${qs}` : ""}`);
  }, [filters, page, wantPerPage, ready]);

  // Lista de pe server, doar cât timp lista completă nu e încă în browser; o cerere nouă o anulează pe cea veche.
  const freshKey = useRef(
    initial.items.length >= Math.min(initial.total, initial.perPage, SERVER_MAX_ROWS) && !serverFailed && !warming
      ? queryKey(initial.filters, initial.page, Math.min(initial.perPage, SERVER_MAX_ROWS))
      : "",
  );
  useEffect(() => {
    if (!ready || useLocal) return;
    if (key === freshKey.current) return;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    // Lista completă sosește de obicei în câteva zeci de ms: nu pornim imediat o cerere care oricum ar fi anulată.
    const timer = setTimeout(() => {
      setLoading(true);
      setFetchError(null);
      fetch(`/api/contoare/list?${key}`, { signal: ctl.signal })
        .then(async (r) => {
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? "Eroare la încărcare.");
          return j as Page & { page: number };
        })
        .then((j) => {
          freshKey.current = key;
          setData({ items: j.items, total: j.total });
          setLoading(false);
          const pages = Math.max(1, Math.ceil(j.total / perPage));
          if (page > pages) setPage(pages);
        })
        .catch((e: Error) => {
          if (e.name === "AbortError") return;
          setFetchError(t(e.message));
          setLoading(false);
        });
    }, reloadTick === 0 ? 300 : 0);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ready, reloadTick, useLocal]);

  const error = useLocal ? null : (ds.error && !ds.rows ? t(ds.error) : null) ?? fetchError;
  const retry = useCallback(() => {
    freshKey.current = "";
    setReloadTick((n) => n + 1);
    void ds.refresh();
  }, [ds]);

  function setFilter(patch: Partial<MeterFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }

  function onText(k: TextKey, value: string) {
    setDraft((d) => ({ ...d, [k]: value }));
    clearTimeout(debounce.current[k]);
    // Cu lista completă în browser filtrarea e ieftină: aplicăm aproape imediat; pe server (lista încă nu e adusă) păstrăm pauza mai lungă.
    debounce.current[k] = setTimeout(() => setFilter({ [k]: value.trim() } as Partial<MeterFilters>), ds.rows ? 120 : 350);
  }

  function clearAll() {
    Object.values(debounce.current).forEach((h) => clearTimeout(h));
    setFilters(EMPTY_METER_FILTERS);
    setDraft({ q: "", street: "" });
    setPage(1);
  }

  // Filtrele „active" iau în calcul și ce e tastat dar încă neaplicat (debounce) — culoarea reacționează imediat.
  const active = countActiveMeterFilters({ ...filters, q: draft.q, street: draft.street });
  const sources = useMemo(() => (ds.rows ? distinctSources(ds.rows) : []), [ds.rows]);

  // ── Virtualizare: din cele (până la ~25.000) de rânduri ale paginii se desenează doar cele din zona vizibilă ──
  const pageRows = view.items;
  const rowCount = showAll ? view.total : pageRows.length;
  const virtualTable = !cards && rowCount > VIRTUAL_MIN;
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
  // Alt filtru / altă pagină / altă sortare → tabelul revine sus (evenimentul de scroll actualizează poziția).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [filters, page, perPage, cards]);
  function onTableScroll(e: React.UIEvent<HTMLDivElement>) {
    const top = e.currentTarget.scrollTop;
    if (scrollRaf.current) return;
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0;
      setVScroll((s) => (s.top === top ? s : { ...s, top }));
    });
  }
  const winStart = virtualTable ? Math.max(0, Math.floor(vScroll.top / ROW_H) - 12) : 0;
  const winEnd = virtualTable ? Math.min(rowCount, Math.ceil((vScroll.top + vScroll.h) / ROW_H) + 12) : pageRows.length;
  const winRows = virtualTable ? pageRows.slice(winStart, Math.min(winEnd, pageRows.length)) : pageRows;
  /** Carduri (mod telefon): listă virtualizată cu înălțimi variabile (cardurile se desfac la atingere). */
  function renderRows(rows: MeterRowBase[], fn: (r: MeterRowBase) => React.ReactNode) {
    const n = showAll ? view.total : rows.length;
    if (n <= VIRTUAL_MIN) return rows.map(fn);
    return (
      <VirtualList
        count={n}
        itemKey={(i) => (rows[i] ? rows[i].id : `sk-${i}`)}
        render={(i) => (rows[i] ? fn(rows[i]) : <div className="h-11 animate-pulse rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)]" />)}
      />
    );
  }

  const sortToggle = (up: MeterFilters["sort"], down: MeterFilters["sort"]) =>
    setFilter({ sort: filters.sort === up ? down : filters.sort === down ? "" : up });
  const arrow = (up: MeterFilters["sort"], down: MeterFilters["sort"]) => (filters.sort === up ? "▲" : filters.sort === down ? "▼" : "↕");

  const pageButtons = buildPageButtons(page, totalPages);
  const from = view.total === 0 ? 0 : (page - 1) * uiPerPage + 1;
  const to = Math.min(page * uiPerPage, view.total);
  const colCount = COL_W.length + (canTask ? 1 : 0);
  /** Sarcină nouă pentru acest contor: pagina de sarcini deschide fereastra de creare cu clientul ales și adresa lui completată. */
  const taskHref = (r: MeterRowBase) => {
    const sp = new URLSearchParams({
      create: "task",
      client: r.clientId ?? "",
      desc: [`${t("Contor")} ${r.contor}`, r.name, r.account ?? r.contract, r.phone].filter(Boolean).join(" · "),
    });
    return `/tasks?${sp.toString()}`;
  };

  function exportCsv() {
    if (!localList) return;
    const esc = (v: string | number | null | undefined) => {
      const s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : v;
      return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = [
      "Nr. contor", "Abonat", "Cont personal", "Contract", "Adresă", "Consumator", "Status", "Instalat", "Sigiliu", "Scos la", "Citire anterioară", "Data citirii anterioare",
      "Citire curentă", "Data citirii", "Consum", "Sursa citirii", "Apă: volum", "Apă: sumă", "Canal: volum", "Canal: sumă", "Contoare active la abonat", "Factură",
      "Status factură", "De achitat", "Telefon", "Email",
    ].map((h) => esc(t(h)));
    const lines = [head.join(";")];
    for (const r of localList) {
      lines.push(
        [
          r.contor, r.name, r.account, r.contract, r.address, r.consumator, r.removedAt ? t("Scos") : t("Activ"), dmy(r.installedAt), r.sigiliu, dmy(r.removedAt), r.prev, dmy(r.prevDate),
          r.curr, dmy(r.currDate), r.consum, r.sursa, r.apaVol, r.apaSum, r.canalVol, r.canalSum, r.meterCount, r.invoice?.number,
          r.invoice ? t(INVOICE_STATUS[r.invoice.status as InvoiceStatusKey]?.label ?? r.invoice.status) : "", r.invoice?.grandTotal, r.phone, r.email,
        ].map(esc).join(";"),
      );
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `contoare-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast.success(t("{n} contoare exportate.", { n: nf(localList.length) }));
  }

  const statusChip = (r: MeterRowBase) =>
    r.removedAt ? (
      <span className="inline-block rounded-full bg-st-cancelled/12 px-1.5 text-[10px] leading-[14px] font-medium text-st-cancelled" title={`${t("Scos la")} ${dmy(r.removedAt)}`}>{t("Scos")}</span>
    ) : (
      <span className="inline-block rounded-full bg-st-done/12 px-1.5 text-[10px] leading-[14px] font-medium text-st-done">{t("Activ")}</span>
    );
  const water = (vol: number | null, sum: number | null) => (vol == null && sum == null ? null : `${vol == null ? "—" : num(vol)} m³ · ${sum == null ? "—" : money(sum)}`);

  return (
    <div>
      {/* ── Filtre (stil Plătitori: colorate când sunt active) ─────────────────── */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <input
          value={draft.q}
          onChange={(e) => onText("q", e.target.value)}
          placeholder={t("Caută nr. contor, abonat, cont, adresă, telefon…")}
          className={`${txtFld(draft.q)} min-w-48 flex-1`}
          aria-label={t("Căutare")}
        />
        <input
          value={draft.street}
          onChange={(e) => onText("street", e.target.value)}
          placeholder={t("Stradă / adresă…")}
          className={`${txtFld(draft.street)} w-44`}
          aria-label={t("Adresă")}
        />
        <select value={filters.status} onChange={(e) => setFilter({ status: e.target.value as MeterFilters["status"] })} className={fld(filters.status)} aria-label={t("Status contor")}>
          <option value="">{t("Contor: toate")}</option>
          <option value="active">{t("Active")}</option>
          <option value="removed">{t("Scoase")}</option>
        </select>
        <select value={filters.shared} onChange={(e) => setFilter({ shared: e.target.value as MeterFilters["shared"] })} className={fld(filters.shared)} aria-label={t("Contoare multiple")} title={t("Adrese la care sunt mai multe contoare active, sau abonați cu mai multe contoare")}>
          <option value="">{t("Contoare multiple: toate")}</option>
          <option value="address">{t("Mai multe la aceeași adresă")}</option>
          <option value="subscriber">{t("Abonat cu mai multe contoare")}</option>
        </select>
        <select value={filters.reading} onChange={(e) => setFilter({ reading: e.target.value as MeterFilters["reading"] })} className={fld(filters.reading)} aria-label={t("Citire curentă")}>
          <option value="">{t("Citire: toate")}</option>
          <option value="has">{t("Cu citire")}</option>
          <option value="none">{t("Fără citire")}</option>
        </select>
        <select value={filters.consum} onChange={(e) => setFilter({ consum: e.target.value as MeterFilters["consum"] })} className={fld(filters.consum)} aria-label={t("Consum")}>
          <option value="">{t("Consum: toate")}</option>
          <option value="positive">{t("Cu consum")}</option>
          <option value="zero">{t("Consum zero")}</option>
        </select>
        <select value={filters.sursa} onChange={(e) => setFilter({ sursa: e.target.value })} className={fld(filters.sursa)} aria-label={t("Sursa citirii")}>
          <option value="">{t("Sursa citirii: toate")}</option>
          {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          {filters.sursa && !sources.includes(filters.sursa) && <option value={filters.sursa}>{filters.sursa}</option>}
        </select>
        <select value={filters.source} onChange={(e) => setFilter({ source: e.target.value as MeterFilters["source"] })} className={fld(filters.source)} aria-label={t("Sursa datelor")}>
          <option value="">{t("Date: 1C și Axioma")}</option>
          <option value="1c">{t("Doar 1C")}</option>
          <option value="axioma">{t("Doar Axioma (fără contor în 1C)")}</option>
        </select>
        <select value={filters.debt} onChange={(e) => setFilter({ debt: e.target.value as MeterFilters["debt"] })} className={fld(filters.debt)} aria-label={t("Datorie")}>
          <option value="">{t("Sold: toate")}</option>
          <option value="has">{t("Cu datorie")}</option>
          <option value="none">{t("Fără datorie")}</option>
        </select>
        <select value={filters.invoiceStatus} onChange={(e) => setFilter({ invoiceStatus: e.target.value })} className={fld(filters.invoiceStatus)} aria-label={t("Status factură")}>
          <option value="">{t("Status factură")}</option>
          {INVOICE_STATUS_LIST.map((s) => <option key={s} value={s}>{t(INVOICE_STATUS[s].label)}</option>)}
        </select>
        <select value={filters.kind} onChange={(e) => setFilter({ kind: e.target.value as MeterFilters["kind"] })} className={fld(filters.kind)} aria-label={t("Tip plătitor")}>
          <option value="">{t("Tip: toți")}</option>
          <option value="person">{t("Persoane fizice")}</option>
          <option value="company">{t("Firme / instituții")}</option>
        </select>
        <select value={filters.sector} onChange={(e) => setFilter({ sector: e.target.value as MeterFilters["sector"] })} className={fld(filters.sector)} aria-label={t("Sector")}>
          <option value="">{t("Toate sectoarele")}</option>
          <option value="privat">{t("Sector privat")}</option>
          <option value="comunal">{t("Sector comunal")}</option>
        </select>
        <select value={filters.account} onChange={(e) => setFilter({ account: e.target.value as MeterFilters["account"] })} className={fld(filters.account)} aria-label={t("Cont portal")}>
          <option value="">{t("Cont portal: toate")}</option>
          <option value="activated">{t("Activat")}</option>
          <option value="pending">{t("Neactivat")}</option>
        </select>
        <span className="flex items-center gap-1">
          <input type="date" value={filters.installedFrom} onChange={(e) => setFilter({ installedFrom: e.target.value })} title={t("Contor instalat de la data")} aria-label={t("Contor instalat de la data")} className={txtFld(filters.installedFrom)} />
          <span className="text-ink-soft">–</span>
          <input type="date" value={filters.installedTo} onChange={(e) => setFilter({ installedTo: e.target.value })} title={t("Contor instalat până la data")} aria-label={t("Contor instalat până la data")} className={txtFld(filters.installedTo)} />
        </span>
        <select value={filters.sort} onChange={(e) => setFilter({ sort: e.target.value as MeterFilters["sort"] })} className={fld(filters.sort)} aria-label={t("Sortare")}>
          <option value="">{t("Sortare: abonat (A-Z)")}</option>
          <option value="contor">{t("Nr. contor")}</option>
          <option value="installDesc">{t("Instalare: recente")}</option>
          <option value="installAsc">{t("Instalare: vechi")}</option>
          <option value="consumDesc">{t("Consum: descrescător")}</option>
          <option value="consumAsc">{t("Consum: crescător")}</option>
          <option value="readDesc">{t("Data citirii: recente")}</option>
          <option value="debtDesc">{t("Sold: descrescător")}</option>
        </select>
        {(active > 0 || filters.sort) && (
          <button type="button" onClick={clearAll} className="tap h-7 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]">
            {t("Resetează filtrele")}{active > 0 ? ` (${active})` : ""}
          </button>
        )}
      </div>

      {/* ── Sumar + rânduri pe pagină ─────────────────────────────────────── */}
      <div className="mb-1 mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
        <span><b>{nf(view.total)}</b> {t("contoare")}{active > 0 ? ` ${t("(filtrat)")}` : ""}</span>
        {view.total > 0 && <span className="text-ink-soft">{t("afișate {from}–{to} din {total}", { from: nf(from), to: nf(to), total: nf(view.total) })}{totalPages > 1 ? ` · ${t("pagina {cur}/{pages}", { cur: page, pages: totalPages })}` : ""}</span>}
        {loading && <span className="text-ink-soft">{t("se încarcă…")}</span>}
        {ds.rows ? (
          <button
            type="button"
            onClick={() => void ds.refresh()}
            disabled={ds.loading}
            title={t("Lista e ținută în memorie și filtrată instant în browser. Apasă ca să o reîncarci de pe server.")}
            className="tap cursor-pointer text-ink-soft hover:text-brand disabled:cursor-default"
          >
            ⚡ {t("local")}{ds.loading ? ` · ${t("se reîmprospătează…")}` : ""} ↻
          </button>
        ) : ds.loading ? (
          <span className="text-ink-soft">{t("se încarcă lista completă…")}</span>
        ) : null}
        <button
          type="button"
          onClick={exportCsv}
          disabled={!localList || localList.length === 0}
          title={t("Descarcă lista filtrată (CSV, se deschide în Excel)")}
          className="tap ml-auto inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-40"
        >
          ⬇ {t("Export (cu filtrele)")}
        </button>
        <button
          type="button"
          onClick={toggleCards}
          aria-pressed={cards}
          title={cards ? t("Înapoi la tabel") : t("Afișează contoarele într-o coloană mică; apeși pe unul ca să vezi detaliile (potrivit pentru telefon)")}
          className={`tap h-7 cursor-pointer rounded-lg border px-2 text-[11px] ${cards ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
        >
          {cards ? `▦ ${t("Tabel")}` : `📱 ${t("Mod telefon")}`}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          {t("Afișează")}
          <select
            value={wantPerPage}
            onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
            className={fld(wantPerPage === DEFAULT_PER_PAGE ? "" : "x")}
            aria-label={t("Rânduri pe pagină")}
          >
            {NOTIFY_PER_PAGE.map((n) => <option key={n} value={n}>{perPageLabel(n, t)}</option>)}
          </select>
        </label>
      </div>
      {loading && <div className="mb-2 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}
      {error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {error}
          <button type="button" onClick={retry} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
        </p>
      )}

      {/* ── Tabel (stil 1C) ───────────────────────────────────────────────── */}
      {cards ? (
        <div className={`flex flex-col gap-1.5 transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}>
          {renderRows(pageRows, (r) => {
            const st = r.invoice ? INVOICE_STATUS[r.invoice.status as InvoiceStatusKey] : null;
            return (
              <CompactCard
                key={r.id}
                avatar={r.contor.trim().charAt(0).toUpperCase()}
                title={<span className="font-mono">{r.contor}</span>}
                subtitle={
                  <>
                    <span className="truncate">{r.name}</span>
                    {statusChip(r)}
                  </>
                }
                trailing={r.consum != null ? <span className="tabular-nums font-semibold">{num(r.consum)}</span> : undefined}
              >
                <dl>
                  <CompactField label={t("Cont / contract")}>{r.account ?? r.contract ?? <Dash />}</CompactField>
                  <CompactField label={t("Adresă")}>{r.address ?? <Dash />}</CompactField>
                  <CompactField label={t("Consumator")}>{r.consumator ?? <Dash />}</CompactField>
                  <CompactField label={t("Instalat")}>{r.installedAt ? dmy(r.installedAt) : <Dash />}</CompactField>
                  <CompactField label={t("Sigiliu")}>{r.sigiliu ?? <Dash />}</CompactField>
                  <CompactField label={t("Citire anterioară")}>{r.prev != null ? `${num(r.prev)}${r.prevDate ? ` (${dmy(r.prevDate)})` : ""}` : <Dash />}</CompactField>
                  <CompactField label={t("Citire curentă")}>{r.curr != null ? `${num(r.curr)}${r.currDate ? ` (${dmy(r.currDate)})` : ""}` : <Dash />}</CompactField>
                  <CompactField label={t("Consum")}>{r.consum != null ? num(r.consum) : <Dash />}</CompactField>
                  <CompactField label={t("Sursa citirii")}>{r.sursa ?? <Dash />}</CompactField>
                  <CompactField label={t("Apă")}>{water(r.apaVol, r.apaSum) ?? <Dash />}</CompactField>
                  <CompactField label={t("Canal")}>{water(r.canalVol, r.canalSum) ?? <Dash />}</CompactField>
                  <CompactField label={t("Contoare active la abonat")}>{r.meterCount}</CompactField>
                  <CompactField label={t("Factură")}>
                    {r.invoice ? <>{r.invoice.number} {st && <span className={`ml-1 inline-block rounded-full px-1.5 text-[10px] font-medium ${st.cls}`}>{t(st.label)}</span>}</> : <Dash />}
                  </CompactField>
                  <CompactField label={t("De achitat")}>{r.invoice ? <span className="tabular-nums font-semibold">{money(r.invoice.grandTotal)}</span> : <Dash />}</CompactField>
                  <CompactField label={t("Telefon")}>{r.phone ?? <Dash />}</CompactField>
                </dl>
                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-line)]/60 px-2.5 py-1.5">
                  <button type="button" onClick={() => setDetailRow(r)} className="tap h-7 cursor-pointer rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong">{t("Fișa contorului")}</button>
                  {canTask && r.clientId && (
                    <Link href={taskHref(r)} prefetch={false} className="tap inline-flex h-7 items-center rounded-lg border border-[var(--color-line)] px-3 text-[11px] font-medium hover:bg-brand-soft">
                      + {t("Sarcină")}
                    </Link>
                  )}
                </div>
              </CompactCard>
            );
          })}
          {pageRows.length === 0 && !loading && (
            <div className="card p-8 text-center text-ink-soft">
              {ds.rows || error ? t("Niciun contor cu filtrele acestea.") : t("se încarcă lista completă…")}{" "}
              {active > 0 && <button type="button" onClick={clearAll} className="font-semibold text-brand underline">{t("Resetează filtrele")}</button>}
            </div>
          )}
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={virtualTable ? onTableScroll : undefined}
          className={`card overflow-auto transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}
          style={{ maxHeight: rowCount > 50 ? "max(78vh, 890px)" : undefined }}
        >
          <table className="min-w-full table-fixed border-separate border-spacing-0 text-[11px] leading-[14px]" style={{ width: COL_W.reduce((a, b) => a + b, 0) + (canTask ? 28 : 0) }}>
            <colgroup>
              {COL_W.map((w, i) => <col key={i} style={{ width: w }} />)}
              {canTask && <col style={{ width: 28 }} />}
            </colgroup>
            <thead className="sticky top-0 z-20 bg-[var(--color-surface-2)]">
              <tr>
                <Th sticky="left-0" minW={105}>
                  <button type="button" onClick={() => setFilter({ sort: filters.sort === "contor" ? "" : "contor" })} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
                    {t("Nr. contor")} <span className="text-[10px] text-ink-soft">{filters.sort === "contor" ? "▲" : "↕"}</span>
                  </button>
                </Th>
                <Th minW={160}>
                  <button type="button" onClick={() => setFilter({ sort: "" })} className="font-semibold hover:text-brand">{t("Abonat")}</button>
                </Th>
                <Th minW={90}>{t("Cont / contract")}</Th>
                <Th minW={170}>{t("Adresă")}</Th>
                <Th minW={120}>{t("Consumator")}</Th>
                <Th minW={55}>{t("Status")}</Th>
                <Th minW={75}>
                  <button type="button" onClick={() => sortToggle("installDesc", "installAsc")} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
                    {t("Instalat")} <span className="text-[10px] text-ink-soft">{arrow("installDesc", "installAsc")}</span>
                  </button>
                </Th>
                <Th minW={75}>{t("Sigiliu")}</Th>
                <Th minW={75} right>{t("Citire ant.")}</Th>
                <Th minW={80} right>{t("Citire curentă")}</Th>
                <Th minW={75}>
                  <button type="button" onClick={() => setFilter({ sort: filters.sort === "readDesc" ? "" : "readDesc" })} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
                    {t("Data citirii")} <span className="text-[10px] text-ink-soft">{filters.sort === "readDesc" ? "▼" : "↕"}</span>
                  </button>
                </Th>
                <Th minW={65} right>
                  <button type="button" onClick={() => sortToggle("consumDesc", "consumAsc")} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
                    {t("Consum")} <span className="text-[10px] text-ink-soft">{arrow("consumDesc", "consumAsc")}</span>
                  </button>
                </Th>
                <Th minW={90}>{t("Sursa citirii")}</Th>
                <Th minW={115}>{t("Apă")}</Th>
                <Th minW={115}>{t("Canal")}</Th>
                <Th minW={55} right>{t("Contoare")}</Th>
                <Th minW={80}>{t("Factură")}</Th>
                <Th minW={80} right>
                  <button type="button" onClick={() => setFilter({ sort: filters.sort === "debtDesc" ? "" : "debtDesc" })} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
                    {t("De achitat")} <span className="text-[10px] text-ink-soft">{filters.sort === "debtDesc" ? "▼" : "↕"}</span>
                  </button>
                </Th>
                <Th minW={65}>{t("Status factură")}</Th>
                <Th minW={90}>{t("Telefon")}</Th>
                <Th minW={48}>{t("Portal")}</Th>
                {canTask && <Th minW={28}> </Th>}
              </tr>
            </thead>
            <tbody>
              {winStart > 0 && (
                <tr aria-hidden>
                  <td colSpan={colCount} style={{ height: winStart * ROW_H, padding: 0, border: 0 }} />
                </tr>
              )}
              {winRows.map((r) => {
                const st = r.invoice ? INVOICE_STATUS[r.invoice.status as InvoiceStatusKey] : null;
                const a = water(r.apaVol, r.apaSum);
                const c = water(r.canalVol, r.canalSum);
                return (
                  <tr key={r.id} onClick={() => setDetailRow(r)} style={{ height: ROW_H }} className={`cursor-pointer hover:bg-brand-soft/30 ${r.removedAt ? "text-ink-soft" : ""}`}>
                    <td className="sticky left-0 z-10 border-b border-[var(--color-line)] bg-[var(--color-surface)] px-1.5 py-px font-mono font-medium" style={{ maxWidth: 130 }}>
                      <div className="truncate hover:text-brand" title={r.contor}>{r.contor}</div>
                    </td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px" style={{ maxWidth: 200 }}>
                      <div className="truncate" title={r.name}>{r.name}</div>
                    </td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px">{r.account ?? r.contract ?? "—"}</td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px" style={{ maxWidth: 220 }}>
                      <div className="truncate" title={r.address ?? ""}>{r.address ?? <Dash />}</div>
                    </td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px" style={{ maxWidth: 160 }}>
                      <div className="truncate" title={r.consumator ?? ""}>{r.consumator ?? <Dash />}</div>
                    </td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px">{statusChip(r)}</td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px whitespace-nowrap">{r.installedAt ? dmy(r.installedAt) : <Dash />}</td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px"><div className="truncate" title={r.sigiliu ?? ""}>{r.sigiliu ?? <Dash />}</div></td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px text-right tabular-nums" title={r.prevDate ? dmy(r.prevDate) : undefined}>{r.prev != null ? num(r.prev) : <Dash />}</td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px text-right tabular-nums">{r.curr != null ? num(r.curr) : <Dash />}</td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px whitespace-nowrap">{r.currDate ? dmy(r.currDate) : <Dash />}</td>
                    <td className={`border-b border-[var(--color-line)] px-1.5 py-px text-right tabular-nums ${r.consum != null && r.consum > 0 ? "font-semibold" : "text-ink-soft"}`}>{r.consum != null ? num(r.consum) : <Dash />}</td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px"><div className="truncate" title={r.sursa ?? ""}>{r.sursa ?? <Dash />}</div></td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px whitespace-nowrap tabular-nums">{a ?? <Dash />}</td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px whitespace-nowrap tabular-nums">{c ?? <Dash />}</td>
                    <td className={`border-b border-[var(--color-line)] px-1.5 py-px text-right tabular-nums ${r.meterCount > 1 ? "font-semibold text-brand" : "text-ink-soft"}`} title={r.meterCount > 1 ? t("Abonatul are {n} contoare active", { n: r.meterCount }) : undefined}>{r.meterCount}</td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px">{r.invoice?.number ?? <Dash />}</td>
                    <td className={`border-b border-[var(--color-line)] px-1.5 py-px text-right tabular-nums ${r.invoice && r.invoice.grandTotal > 0 ? "font-semibold" : "text-ink-soft"}`}>{r.invoice ? money(r.invoice.grandTotal) : <Dash />}</td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px">
                      {st ? <span className={`inline-block rounded-full px-1.5 text-[10px] leading-[14px] font-medium ${st.cls}`}>{t(st.label)}</span> : <Dash />}
                    </td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px tabular-nums">{r.phone ?? <Dash />}</td>
                    <td className="border-b border-[var(--color-line)] px-1.5 py-px" title={r.activated ? t("Cont portal activat") : t("Cont portal neactivat")}>
                      {r.activated ? <span className="text-st-done">✓ {t("activ")}</span> : <span className="text-ink-soft/60">—</span>}
                    </td>
                    {canTask && (
                      <td className="border-b border-[var(--color-line)] px-1.5 py-px" onClick={(e) => e.stopPropagation()}>
                        {r.clientId && (
                          <Link
                            href={taskHref(r)}
                            prefetch={false}
                            title={t("Creează sarcină pentru acest contor (adresa se completează singură)")}
                            aria-label={t("Creează sarcină pentru acest contor (adresa se completează singură)")}
                            className="grid size-4 place-items-center rounded bg-brand text-[11px] font-bold leading-none text-white hover:bg-brand-strong"
                          >
                            +
                          </Link>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {winEnd > pageRows.length && winStart < winEnd &&
                Array.from({ length: winEnd - Math.max(winStart, pageRows.length) }, (_, k) => (
                  <tr key={`sk-${Math.max(winStart, pageRows.length) + k}`} aria-hidden style={{ height: ROW_H }}>
                    <td colSpan={colCount} className="border-b border-[var(--color-line)] px-2 text-ink-soft/40">…</td>
                  </tr>
                ))}
              {winEnd < rowCount && (
                <tr aria-hidden>
                  <td colSpan={colCount} style={{ height: (rowCount - winEnd) * ROW_H, padding: 0, border: 0 }} />
                </tr>
              )}
              {pageRows.length === 0 && !loading && (
                <tr>
                  <td colSpan={colCount} className="p-8 text-center text-ink-soft">
                    {ds.rows || error ? t("Niciun contor cu filtrele acestea.") : t("se încarcă lista completă…")}{" "}
                    {active > 0 && <button type="button" onClick={clearAll} className="font-semibold text-brand underline">{t("Resetează filtrele")}</button>}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Paginare numerică ─────────────────────────────────────────────── */}
      {view.total > 0 && totalPages > 1 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="tap grid size-7 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={t("Pagina anterioară")}
          >
            <IconChevronLeft className="size-4" />
          </button>
          {pageButtons.map((b, i) =>
            b === "…" ? (
              <span key={`e${i}`} className="flex h-7 w-6 items-center justify-center text-sm text-ink-soft">…</span>
            ) : (
              <button
                key={b}
                onClick={() => setPage(b)}
                className={`tap h-7 min-w-[28px] rounded-lg px-2 text-xs font-medium ${
                  b === page ? "bg-brand text-white" : "border border-[var(--color-line)] text-ink hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {b}
              </button>
            ),
          )}
          <button
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
            className="tap grid size-7 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={t("Pagina următoare")}
          >
            <IconChevronRight className="size-4" />
          </button>
        </div>
      )}

      {detailRow && (
        <MeterDetailDialog
          row={detailRow}
          rows={ds.rows}
          canTask={canTask}
          taskHref={taskHref}
          onSelect={(r) => setDetailRow(r)}
          onClose={() => setDetailRow(null)}
        />
      )}
    </div>
  );
}

function Dash() {
  return <span className="text-ink-soft/60">—</span>;
}

function Th({ children, minW, right, sticky }: { children: React.ReactNode; minW: number; right?: boolean; sticky?: string }) {
  return (
    <th
      style={{ minWidth: minW }}
      className={`border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 py-1 font-semibold ${right ? "text-right" : "text-left"} ${sticky ? `sticky ${sticky} z-30` : ""}`}
    >
      {children}
    </th>
  );
}

/** Butoanele de paginare cu „…" pentru spații mari (aceeași logică ca la Plătitori). */
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
