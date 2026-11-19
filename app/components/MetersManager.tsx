"use client";

import DateFilterInput from "./DateFilterInput";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  EMPTY_METER_FILTERS,
  countActiveMeterFilters,
  distinctSources,
  enumLabel,
  filterMeters,
  meterFiltersToParams,
  sanitizeMeterFilters,
  type MeterFilters,
  type MeterRowBase,
} from "@/lib/meters";
import { DEFAULT_PER_PAGE, PER_PAGE_ALL, normalizePerPageClient } from "@/lib/payer-notify";
import { METERS_PP_COOKIE } from "@/lib/payer-prefs";
import { INVOICE_STATUS, INVOICE_STATUS_LIST, type InvoiceStatusKey } from "./invoice-meta";
import { useLocale, useT } from "@/lib/i18n/context";
import FiltersToggle from "./FiltersToggle";
import { useFiltersOpen } from "./useFiltersOpen";
import { dateTag } from "@/lib/i18n/t";
import { useToast } from "./toast";
import MeterDetailDialog from "./MeterDetailDialog";
import ContractExpiry from "./ContractExpiry";
import { METROLOGY_FILTER_OPTIONS } from "@/lib/metrology";
import { ISSUE_KINDS, ISSUE_LABELS } from "@/lib/meter-issues";
import { useMeterDataset } from "./useMeterDataset";
import SectorFilter from "./SectorFilter";
import { addressLocality, distinctBy, distinctSectors } from "@/lib/sector-filter";
import DataTable, { type Col } from "./DataTable";

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

const SERVER_MAX_ROWS = 200; // doar cât timp lista completă nu e încă în browser (răspunsul vine de pe server)

const fmtCache = new Map<string, { num: (n: number) => string; money: (n: number) => string }>();
/** Formatoare de numere create O DATĂ per limbă (nu la fiecare celulă). */
function getFmt(tag: string) {
  let f = fmtCache.get(tag);
  if (!f) {
    const n = new Intl.NumberFormat(tag, { maximumFractionDigits: 3 });
    const m = new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    f = { num: (x) => n.format(x), money: (x) => m.format(x) };
    fmtCache.set(tag, f);
  }
  return f;
}

function queryKey(f: MeterFilters, page: number, perPage: number): string {
  return meterFiltersToParams(sanitizeMeterFilters(f), { page, perPage }).toString();
}

export default function MetersManager({
  initial,
  serverFailed = false,
  warming = false,
  canTask = false,
  canEditInvoices = false,
  canRead = false,
  canExport = true,
}: {
  initial: { filters: MeterFilters; page: number; perPage: number; items: MeterRowBase[]; total: number };
  /** Prima listă n-a putut fi citită pe server — arătăm eroarea cu „Reîncearcă" până sosește lista completă în browser. */
  serverFailed?: boolean;
  /** Serverul încă construiește lista (prima construire e lentă): fără eroare, browserul o cere și o afișează când e gata. */
  warming?: boolean;
  /** Are „Sarcini – Creare": rândul are „+" pentru o sarcină nouă (clientul și adresa se completează singure). */
  canTask?: boolean;
  /** Poate edita facturi (invoices.edit) — „Editează” lângă „Vezi” în pop-up. */
  canEditInvoices?: boolean;
  /** Are „Citiri contoare”: în pop-up poate introduce citirea din teren. */
  canRead?: boolean;
  canExport?: boolean;
}) {
  const t = useT();
  const [fOpen, toggleF] = useFiltersOpen("meters");
  const toast = useToast();
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag);
  const { num, money } = getFmt(tag);
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
  const uSectors = useMemo(() => (ds.rows ? distinctSectors(ds.rows) : []), [ds.rows]);
  const uLocs = useMemo(() => (ds.rows ? distinctBy(ds.rows, (r) => addressLocality(r.address)) : []), [ds.rows]);


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
      "Nr. contor", "Abonat", "Cont personal", "Contract", "Adresă", "Consumator", "Status", "Instalat", "Sigiliu", "Scos la", "Citire anterioară (m³)", "Data citirii anterioare",
      "Citire curentă (m³)", "Data citirii", "Consum (m³)", "Sursa citirii", "Apă: volum (m³)", "Apă: sumă (MDL)", "Canal: volum (m³)", "Canal: sumă (MDL)", "Contoare active la abonat", "Factură",
      "Status factură", "De achitat (MDL)", "Telefon", "Email", "Ultima verificare metrologică", "Scadență verificare metrologică", "Neregulă",
    ].map((h) => esc(t(h)));
    const lines = [head.join(";")];
    for (const r of localList) {
      lines.push(
        [
          r.contor, r.name, r.account, r.contract, r.address, r.consumator, r.removedAt ? t("Scos") : t("Activ"), dmy(r.installedAt), r.sigiliu, dmy(r.removedAt), r.prev, dmy(r.prevDate),
          r.curr, dmy(r.currDate), r.consum, enumLabel(r.sursa, t), r.apaVol, r.apaSum, r.canalVol, r.canalSum, r.meterCount, r.invoice?.number,
          r.invoice ? t(INVOICE_STATUS[r.invoice.status as InvoiceStatusKey]?.label ?? r.invoice.status) : "", r.invoice?.grandTotal, r.phone, r.email, dmy(r.metroVerified), dmy(r.metroDue),
          r.issue ? ((ISSUE_KINDS as readonly string[]).includes(r.issue) ? t(ISSUE_LABELS[r.issue as (typeof ISSUE_KINDS)[number]]) : r.issue) : "",
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

  const water = (vol: number | null, sum: number | null) => (vol == null && sum == null ? null : `${vol == null ? "—" : num(vol)} m³ · ${sum == null ? "—" : `${money(sum)} MDL`}`);

  // ── Coloane (ca la Sarcini): se mută, se ascund, se redimensionează și se colorează din „⚙ Coloane”; alegerea rămâne salvată în browser („Resetează” revine la cele de la început). ──
  const dash = <Dash />;
  const columns: Col<MeterRowBase>[] = [
    { key: "contor", label: "Nr. contor", minW: 110, sticky: true, sort: (r) => r.contor, render: (r) => <MeterLink id={r.id} contor={r.contor} /> },
    { key: "name", label: "Abonat", minW: 190, maxW: 260, sort: (r) => r.name, render: (r) => r.name },
    { key: "account", label: "Cont / contract", minW: 95, sort: (r) => r.account ?? r.contract ?? "", render: (r) => r.account ?? r.contract ?? "—" },
    { key: "address", label: "Adresă", minW: 210, maxW: 300, sort: (r) => r.address ?? "", render: (r) => r.address ?? dash },
    { key: "consumator", label: "Consumator", minW: 150, maxW: 220, sort: (r) => r.consumator ?? "", render: (r) => r.consumator ?? dash },
    {
      key: "status", label: "Status", minW: 90, sort: (r) => (r.removedAt ? 1 : 0),
      render: (r) => {
        const issueLabel = r.issue && (ISSUE_KINDS as readonly string[]).includes(r.issue) ? t(ISSUE_LABELS[r.issue as (typeof ISSUE_KINDS)[number]]) : r.issue;
        return (
          <>
            {r.removedAt
              ? <span className="inline-block rounded-full bg-st-cancelled/12 px-1.5 text-[10px] leading-[14px] font-medium text-st-cancelled" title={`${t("Scos la")} ${dmy(r.removedAt)}`}>{t("Scos")}</span>
              : <span className="inline-block rounded-full bg-st-done/12 px-1.5 text-[10px] leading-[14px] font-medium text-st-done">{t("Activ")}</span>}
            {r.issue && <span className="ml-1 inline-block max-w-28 truncate rounded-full bg-st-cancelled/12 px-1.5 align-bottom text-[10px] leading-[14px] font-medium text-st-cancelled" title={issueLabel ?? ""}>⚠ {issueLabel}</span>}
          </>
        );
      },
    },
    { key: "installed", label: "Instalat", minW: 80, sort: (r) => r.installedAt ?? "", render: (r) => (r.installedAt ? dmy(r.installedAt) : dash) },
    { key: "sigiliu", label: "Sigiliu", minW: 85, sort: (r) => r.sigiliu ?? "", render: (r) => r.sigiliu ?? dash },
    {
      key: "metro", label: "Verificare metrologică", minW: 118, sort: (r) => r.metroDue ?? "",
      render: (r) => (r.metroDue
        ? <span className="tabular-nums" title={r.metroVerified ? `${t("Ultima verificare")}: ${dmy(r.metroVerified)}` : t("Data verificării metrologice nu e introdusă")}><ContractExpiry date={r.metroDue} compact /></span>
        : dash),
    },
    { key: "prev", label: "Citire anterioară", minW: 100, right: true, sort: (r) => r.prev, render: (r) => (r.prev != null ? <span title={r.prevDate ? dmy(r.prevDate) : undefined}>{num(r.prev)}</span> : dash) },
    { key: "curr", label: "Citire curentă", minW: 100, right: true, sort: (r) => r.curr, render: (r) => (r.curr != null ? num(r.curr) : dash) },
    { key: "currDate", label: "Data citirii", minW: 85, sort: (r) => r.currDate ?? "", render: (r) => (r.currDate ? dmy(r.currDate) : dash) },
    {
      key: "consum", label: "Consum (m³)", minW: 90, right: true, sort: (r) => r.consum,
      render: (r) => (r.consum != null ? <span className={r.consum > 0 ? "font-semibold" : "text-ink-soft"}>{num(r.consum)} m³</span> : dash),
    },
    { key: "sursa", label: "Sursa citirii", minW: 100, sort: (r) => (r.sursa ? enumLabel(r.sursa, t) : ""), render: (r) => (r.sursa ? enumLabel(r.sursa, t) : dash) },
    { key: "apa", label: "Apă (m³ · MDL)", minW: 150, sort: (r) => r.apaVol, render: (r) => water(r.apaVol, r.apaSum) ?? dash },
    { key: "canal", label: "Canal (m³ · MDL)", minW: 150, sort: (r) => r.canalVol, render: (r) => water(r.canalVol, r.canalSum) ?? dash },
    {
      key: "meterCount", label: "Contoare", minW: 62, right: true, sort: (r) => r.meterCount,
      render: (r) => <span className={r.meterCount > 1 ? "font-semibold text-brand" : "text-ink-soft"} title={r.meterCount > 1 ? t("Abonatul are {n} contoare active", { n: r.meterCount }) : undefined}>{r.meterCount}</span>,
    },
    { key: "invoice", label: "Factură", minW: 115, sort: (r) => r.invoice?.number ?? "", render: (r) => r.invoice?.number ?? dash },
    {
      key: "debt", label: "De achitat", minW: 90, right: true, sort: (r) => r.invoice?.grandTotal ?? null,
      render: (r) => (r.invoice ? <span className={r.invoice.grandTotal > 0 ? "font-semibold" : "text-ink-soft"}>{money(r.invoice.grandTotal)}</span> : dash),
    },
    {
      key: "invStatus", label: "Status factură", minW: 85, sort: (r) => r.invoice?.status ?? "",
      render: (r) => {
        const st = r.invoice ? INVOICE_STATUS[r.invoice.status as InvoiceStatusKey] : null;
        return st ? <span className={`inline-block rounded-full px-1.5 text-[10px] leading-[14px] font-medium ${st.cls}`}>{t(st.label)}</span> : dash;
      },
    },
    { key: "phone", label: "Telefon", minW: 120, sort: (r) => r.phone ?? "", render: (r) => (r.phone ? <span className="tabular-nums">{r.phone}</span> : dash) },
    {
      key: "portal", label: "Portal", minW: 60, sort: (r) => (r.activated ? 1 : 0),
      render: (r) => (r.activated ? <span className="text-st-done" title={t("Cont portal activat")}>✓ {t("activ")}</span> : <span className="text-ink-soft/60" title={t("Cont portal neactivat")}>—</span>),
    },
    ...(canTask
      ? [{
          key: "task", label: "", minW: 34,
          render: (r: MeterRowBase) => (r.clientId
            ? (
              <Link
                href={taskHref(r)}
                prefetch={false}
                title={t("Creează sarcină pentru acest contor (adresa se completează singură)")}
                aria-label={t("Creează sarcină pentru acest contor (adresa se completează singură)")}
                className="grid size-4 place-items-center rounded bg-brand text-[11px] font-bold leading-none text-white hover:bg-brand-strong"
              >
                +
              </Link>
            )
            : null),
        }]
      : []),
  ];


  return (
    <div>
      {/* ── Bară compactă: filtre, stare listă, export — un singur rând (mai mult loc pentru listă) ── */}
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <FiltersToggle open={fOpen} onToggle={toggleF} activeCount={active} />
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
        {canExport && <button
          type="button"
          onClick={exportCsv}
          disabled={!localList || localList.length === 0}
          title={t("Descarcă lista filtrată (CSV, se deschide în Excel)")}
          className="tap ml-auto inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-40"
        >
          ⬇ {t("Export (cu filtrele)")}
        </button>}
      </div>
      <div className={`flex-wrap items-center gap-1.5 ${fOpen ? "mb-1.5 flex" : "hidden"}`}>
        <div className={fOpen ? "contents" : "hidden"}>
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
          {sources.map((s) => <option key={s} value={s}>{enumLabel(s, t)}</option>)}
          {filters.sursa && !sources.includes(filters.sursa) && <option value={filters.sursa}>{enumLabel(filters.sursa, t)}</option>}
        </select>
        <select value={filters.svc} onChange={(e) => setFilter({ svc: e.target.value as MeterFilters["svc"] })} className={fld(filters.svc)} aria-label={t("Serviciu")}>
          <option value="">{t("Serviciu: toate")}</option>
          <option value="water">{t("Doar apă")}</option>
          <option value="sewer">{t("Doar canalizare")}</option>
          <option value="both">{t("Apă + canalizare")}</option>
        </select>
        <select value={filters.estimated} onChange={(e) => setFilter({ estimated: e.target.value as MeterFilters["estimated"] })} className={fld(filters.estimated)} aria-label={t("Citire estimată")}>
          <option value="">{t("Estimare: toate")}</option>
          <option value="yes">{t("Citire estimată (calculată)")}</option>
          <option value="no">{t("Citire reală (nu estimată)")}</option>
        </select>
        <select value={filters.metrology} onChange={(e) => setFilter({ metrology: e.target.value as MeterFilters["metrology"] })} className={fld(filters.metrology)} aria-label={t("Verificare metrologică")}>
          <option value="">{t("Verificare metrologică: toate")}</option>
          {METROLOGY_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
        </select>
        <select value={filters.issue} onChange={(e) => setFilter({ issue: e.target.value as MeterFilters["issue"] })} className={fld(filters.issue)} aria-label={t("Neregulă contor")} data-filter-issue="">
          <option value="">{t("Neregulă: toate")}</option>
          <option value="any">{t("Cu neregulă (orice)")}</option>
          <option value="serious">{t("Cu neregulă gravă")}</option>
          <option value="none">{t("Fără neregulă")}</option>
          {ISSUE_KINDS.map((k) => <option key={k} value={k}>{t(ISSUE_LABELS[k])}</option>)}
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
          <option value="person">{t("Casnic")}</option>
          <option value="company">{t("Non casnic")}</option>
        </select>
        <select value={filters.sector} onChange={(e) => setFilter({ sector: e.target.value as MeterFilters["sector"] })} className={fld(filters.sector)} aria-label={t("Sector")}>
          <option value="">{t("Toate sectoarele")}</option>
          <option value="privat">{t("Sector privat")}</option>
          <option value="comunal">{t("Sector comunal")}</option>
        </select>
        <SectorFilter options={uSectors} value={filters.usector} onChange={(v) => setFilter({ usector: v })} className={(on) => fld(on ? "x" : "")} />
        <SectorFilter kind="locality" options={uLocs} value={filters.uloc} onChange={(v) => setFilter({ uloc: v })} className={(on) => fld(on ? "x" : "")} />
        <select value={filters.account} onChange={(e) => setFilter({ account: e.target.value as MeterFilters["account"] })} className={fld(filters.account)} aria-label={t("Cont portal")}>
          <option value="">{t("Cont portal: toate")}</option>
          <option value="activated">{t("Activat")}</option>
          <option value="pending">{t("Neactivat")}</option>
        </select>
        <span className="flex items-center gap-1">
          <DateFilterInput label={t("De la")} value={filters.installedFrom} onChange={(e) => setFilter({ installedFrom: e.target.value })} title={t("Contor instalat de la data")} aria-label={t("Contor instalat de la data")} className={txtFld(filters.installedFrom)} />
          <span className="text-ink-soft">–</span>
          <DateFilterInput label={t("Până la")} value={filters.installedTo} onChange={(e) => setFilter({ installedTo: e.target.value })} title={t("Contor instalat până la data")} aria-label={t("Contor instalat până la data")} className={txtFld(filters.installedTo)} />
        </span>
        <select value={filters.sort} onChange={(e) => setFilter({ sort: e.target.value as MeterFilters["sort"] })} className={fld(filters.sort)} aria-label={t("Sortare")}>
          <option value="">{t("Sortare: abonat (A-Z)")}</option>
          <option value="contor">{t("Nr. contor")}</option>
          <option value="installDesc">{t("Instalare: recente")}</option>
          <option value="installAsc">{t("Instalare: vechi")}</option>
          <option value="consumDesc">{t("Consum: descrescător")}</option>
          <option value="consumAsc">{t("Consum: crescător")}</option>
          <option value="readDesc">{t("Data citirii: recente")}</option>
          <option value="metroAsc">{t("Verificare metrologică: cele mai apropiate")}</option>
          <option value="debtDesc">{t("Sold: descrescător")}</option>
        </select>
        </div>
        {(active > 0 || filters.sort) && (
          <button type="button" onClick={clearAll} className="tap h-7 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]">
            {t("Resetează filtrele")}{active > 0 ? ` (${active})` : ""}
          </button>
        )}
      </div>

      {loading && <div className="mb-2 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}
      {error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {error}
          <button type="button" onClick={retry} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
        </p>
      )}

      {!localList && view.total > data.items.length && !loading && (
        <p className="mb-1 text-[11px] text-ink-soft">
          {t("Se afișează doar primele {n} rânduri; restul apar când se încarcă lista completă.", { n: nf(data.items.length) })}{" "}
          <button type="button" onClick={retry} className="cursor-pointer font-semibold text-brand underline">{t("Reîncearcă")}</button>
        </p>
      )}
      <DataTable<MeterRowBase>
        storageKey="meters"
        rows={localList ?? data.items}
        columns={columns}
        filters={[]}
        noun={t("contoare")}
        emptyText={ds.rows || error ? t("Niciun contor cu filtrele acestea.") : t("se încarcă lista completă…")}
        pending={localList ? undefined : { total: view.total }}
        onRowClick={(r) => setDetailRow(r)}
        rowClickSkipsControls
        rowClassName={(r) => (r.removedAt ? "text-ink-soft" : "")}
        cardKeys={["contor", "name", "address"]}
      />

      {detailRow && (
        <MeterDetailDialog
          row={detailRow}
          rows={ds.rows}
          canTask={canTask}
          canEditInvoices={canEditInvoices}
          canRead={canRead}
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





/** Numărul contorului ca link: pagina contorului se pregătește în fundal când treci cu mouse-ul / atingi numărul, ca la click să se deschidă instant. */
function MeterLink({ id, contor }: { id: string; contor: string }) {
  const t = useT();
  const [intent, setIntent] = useState(false);
  return (
    <Link
      href={`/contoare/${encodeURIComponent(id)}`}
      prefetch={intent ? true : null}
      onMouseEnter={() => setIntent(true)}
      onTouchStart={() => setIntent(true)}
      onFocus={() => setIntent(true)}
      title={t("Deschide pagina contorului")}
      className="font-mono font-medium hover:text-brand hover:underline"
    >
      {contor}
    </Link>
  );
}
