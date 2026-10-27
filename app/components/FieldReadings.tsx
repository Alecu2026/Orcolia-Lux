"use client";

import Link from "next/link";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_FIELD_FILTERS,
  FAR_METERS,
  JUMP_CONFIRM_M3,
  countActiveFieldFilters,
  fieldFiltersToParams,
  fieldSuspect,
  filterField,
  sanitizeFieldFilters,
  type FieldFilters,
  type FieldRow,
} from "@/lib/meter-readings";
import { DEFAULT_PER_PAGE, NOTIFY_PER_PAGE, normalizePerPageClient, perPageLabel } from "@/lib/payer-notify";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { IconChevronLeft, IconChevronRight, IconX } from "./icons";
import { useToast } from "./toast";
import ReadingForm from "./ReadingForm";
import VirtualList from "./VirtualList";
import { useFieldDataset } from "./useFieldDataset";
import { mapsUrl, type MeterLocationDto } from "@/lib/meter-readings";

const STORAGE_KEY = "filters:/contoare/citiri";
type TextKey = "q" | "street" | "consumMin" | "consumMax";

// Aceleași clase ca filtrele din Contoare / Plătitori: câmpul cu valoare aleasă capătă fundal / chenar colorat.
const fld = (val: string) =>
  `h-8 min-w-0 max-w-full appearance-none sel-arrow rounded-lg border pl-1.5 pr-6 text-[12px] outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;
const txtFld = (val: string) =>
  `h-8 min-w-0 rounded-lg border px-2 text-[12px] outline-none focus:border-brand ${
    val ? "border-brand bg-brand/10 font-semibold text-brand placeholder:font-normal" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;

/** Lățimile coloanelor (px): contor, abonat, adresă, index anterior, data lui, index curent, consum, citit la, citit de, poză, locație, buton. */
const COL_W = [118, 200, 270, 100, 84, 108, 92, 100, 130, 48, 84, 56, 92];
const GRID = COL_W.map((w) => `${w}px`).join(" ");
const GRID_W = COL_W.reduce((x, y) => x + y, 0);
/** La „Necitite” coloanele de citire (index curent, consum, citit la/de, poză, locație) ar fi goale: rămân contor, abonat, adresă, index anterior, data lui și butonul. */
const COL_W_COMPACT = [118, 250, 360, 100, 84, 56, 92];
const GRID_COMPACT = COL_W_COMPACT.map((w) => `${w}px`).join(" ");
const GRID_W_COMPACT = COL_W_COMPACT.reduce((x, y) => x + y, 0);
const VIRTUAL_MIN = 80; // peste atâtea rânduri se desenează doar cele vizibile
const ROW_H = 28; // înălțimea fixă a unui rând (necesară virtualizării) — puțin mai înalt decât la Contoare: se lucrează și pe tabletă
const ROW_BLOCK = 8;
const ROW_OVERSCAN = 40;
const CELL = "truncate border-b border-[var(--color-line)] px-1.5 leading-[27px]";

const fmtCache = new Map<string, { num: (n: number) => string; dt: (ms: number) => string }>();
/** Formatoare create O DATĂ per limbă (nu la fiecare celulă). */
function getFmt(tag: string) {
  let f = fmtCache.get(tag);
  if (!f) {
    const n = new Intl.NumberFormat(tag, { maximumFractionDigits: 3 });
    const d = new Intl.DateTimeFormat(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    f = { num: (x) => n.format(x), dt: (ms) => d.format(ms) };
    fmtCache.set(tag, f);
  }
  return f;
}

const dmy = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join(".") : "");

/**
 * „Citiri teren": persoana responsabilă parcurge contoarele (în ordinea adreselor), scrie indexul lunii curente (m³), locația se ia automat de la telefon,
 * iar poza contorului se poate adăuga pe loc. Tot ce se salvează intră direct în baza de date (nu modifică facturile).
 *
 * Aceeași schemă ca „Contoare” / „Plătitori": toată lista stă în browser (IndexedDB + memorie), filtrele și sortarea sunt instant, tabelul are rânduri
 * virtualizate, paginare numerică și pop-up pentru citire.
 */
export default function FieldReadings({
  openId,
  canViewMeter,
  initialQuery,
}: {
  openId: string | null;
  canViewMeter: boolean;
  /** Parametrii din adresă (?q=…&status=…): link de partajat. */
  initialQuery: Record<string, string | undefined>;
}) {
  const t = useT();
  const toast = useToast();
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag);
  const ds = useFieldDataset();
  const data = ds.data;

  const initialFilters = useMemo(() => sanitizeFieldFilters(initialQuery), [initialQuery]);
  const [filters, setFilters] = useState<FieldFilters>(initialFilters);
  const [draft, setDraft] = useState<Record<TextKey, string>>({ q: initialFilters.q, street: initialFilters.street, consumMin: initialFilters.consumMin, consumMax: initialFilters.consumMax });
  const [page, setPage] = useState(Math.max(1, Math.floor(Number(initialQuery.page)) || 1));
  const [perPage, setPerPage] = useState(normalizePerPageClient(initialQuery.perPage));
  const [selId, setSelId] = useState<string | null>(openId);
  const [ready, setReady] = useState(false);
  const debounce = useRef<Partial<Record<TextKey, ReturnType<typeof setTimeout>>>>({});
  const jumpTo = useRef<string | null>(null);

  // Mod telefon: fiecare contor devine un card. `cardsPref` = alegerea utilizatorului; null = automat (carduri pe ecrane înguste, tabel pe restul).
  const [cardsPref, setCardsPref] = useState<boolean | null>(null);
  const [narrow, setNarrow] = useState(false);
  const cards = cardsPref ?? narrow;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNarrow(window.matchMedia("(max-width: 639px)").matches);
    try {
      const v = localStorage.getItem("field-view");
      if (v === "cards" || v === "table") setCardsPref(v === "cards");
    } catch {}
  }, []);
  function toggleCards() {
    const next = !cards;
    setCardsPref(next);
    try { localStorage.setItem("field-view", next ? "cards" : "table"); } catch {}
  }

  // Restaurează filtrele salvate (doar dacă adresa nu are propriile filtre) — ca la Contoare.
  useEffect(() => {
    const urlEmpty = countActiveFieldFilters(initialFilters) === 0 && !initialFilters.sort && !initialQuery.page && !initialQuery.perPage;
    if (urlEmpty) {
      try {
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { f?: unknown; perPage?: unknown } | null;
        if (saved) {
          const f = sanitizeFieldFilters((saved.f ?? {}) as Record<string, unknown>);
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setFilters(f);
          setDraft({ q: f.q, street: f.street, consumMin: f.consumMin, consumMax: f.consumMax });
          setPerPage(normalizePerPageClient(saved.perPage));
        }
      } catch {}
    }
    setReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Salvează filtrele + sincronizează adresa (link de partajat), fără navigare.
  useEffect(() => {
    if (!ready) return;
    const isDefault = countActiveFieldFilters(filters) === 0 && !filters.sort && perPage === DEFAULT_PER_PAGE;
    try {
      if (isDefault) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, JSON.stringify({ f: filters, perPage }));
    } catch {}
    const usp = fieldFiltersToParams(filters);
    if (page > 1) usp.set("page", String(page));
    if (perPage !== DEFAULT_PER_PAGE) usp.set("perPage", String(perPage));
    // Contorul din adresa de deschidere (?meter=) rămâne în adresă: la o reîncărcare (ex. prima vizită, când se activează service worker-ul și pagina se reia) pop-up-ul lui se redeschide.
    if (openId) usp.set("meter", openId);
    const qs = usp.toString();
    window.history.replaceState(null, "", `/contoare/citiri${qs ? `?${qs}` : ""}`);
  }, [filters, page, perPage, ready, openId]);

  // Controalele se actualizează imediat; lista de ~25.000 de rânduri se recalculează în randarea următoare (amânată), deci un select nu „se agață".
  const listFilters = useDeferredValue(filters);
  const list = useMemo(() => (data ? filterField(data.rows, listFilters) : []), [data, listFilters]);
  const totalPages = Math.max(1, Math.ceil(list.length / perPage));
  const curPage = Math.min(page, totalPages);
  const pageRows = useMemo(() => list.slice((curPage - 1) * perPage, curPage * perPage), [list, curPage, perPage]);

  // „Următorul” dintr-un pop-up poate pica pe altă pagină: după ce lista e calculată, trecem la pagina lui.
  useEffect(() => {
    const id = jumpTo.current;
    if (!id) return;
    const i = list.findIndex((r) => r.id === id);
    if (i < 0) return;
    jumpTo.current = null;
    setPage(Math.floor(i / perPage) + 1);
  }, [list, perPage, selId]);

  const stats = useMemo(() => {
    if (!data) return { total: 0, done: 0, flagged: 0, users: [] as string[], localities: [] as string[] };
    let done = 0;
    let flagged = 0;
    const users = new Set<string>();
    const localities = new Set<string>();
    for (const r of data.rows) {
      if (r.locality) localities.add(r.locality);
      if (r.value != null) {
        done++;
        if (fieldSuspect(r)) flagged++;
        if (r.by) users.add(r.by);
      }
    }
    return { total: data.rows.length, done, flagged, users: [...users].sort((a, b) => a.localeCompare(b)), localities: [...localities].sort((a, b) => a.localeCompare(b)) };
  }, [data]);

  function setFilter(patch: Partial<FieldFilters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }
  function onText(k: TextKey, value: string) {
    setDraft((d) => ({ ...d, [k]: value }));
    clearTimeout(debounce.current[k]);
    debounce.current[k] = setTimeout(() => setFilter({ [k]: value.trim() } as Partial<FieldFilters>), 120);
  }
  function clearAll() {
    Object.values(debounce.current).forEach((h) => clearTimeout(h));
    setFilters(EMPTY_FIELD_FILTERS);
    setDraft({ q: "", street: "", consumMin: "", consumMax: "" });
    setPage(1);
  }
  const onSort = useCallback((next: FieldFilters["sort"]) => {
    setFilters((f) => ({ ...f, sort: next }));
    setPage(1);
  }, []);
  const onOpen = useCallback((r: FieldRow) => setSelId(r.id), [setSelId]);

  const active = countActiveFieldFilters({ ...filters, q: draft.q, street: draft.street, consumMin: draft.consumMin, consumMax: draft.consumMax });
  const selected = selId && data ? (data.rows.find((r) => r.id === selId) ?? null) : null;

  /** Următorul contor necitit după cel dat: în ordinea listei curente (filtre / sortare, fără filtrul de status), apoi de la început; dacă filtrele n-au lăsat niciunul, în toată lista (ordinea adreselor). */
  const nextUnread = useCallback(
    (afterId: string) => {
      if (!data) return null;
      const find = (ordered: FieldRow[]) => {
        const i = ordered.findIndex((r) => r.id === afterId);
        for (let k = i + 1; k < ordered.length; k++) if (ordered[k].value == null && ordered[k].id !== afterId) return ordered[k].id;
        for (let k = 0; k < i; k++) if (ordered[k].value == null) return ordered[k].id;
        return null;
      };
      return find(filterField(data.rows, { ...filters, status: "all" })) ?? find(data.rows);
    },
    [data, filters],
  );

  const from = list.length === 0 ? 0 : (curPage - 1) * perPage + 1;
  const to = Math.min(curPage * perPage, list.length);
  const pageButtons = buildPageButtons(curPage, totalPages);

  const monthLabel = data
    ? (() => {
        const s = new Date(Number(data.period.slice(0, 4)), Number(data.period.slice(5, 7)) - 1, 1).toLocaleDateString(tag, { month: "long", year: "numeric" });
        return s.charAt(0).toUpperCase() + s.slice(1);
      })()
    : "";
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  function exportCsv() {
    const esc = (v: string | number | null | undefined) => {
      const s = v == null ? "" : typeof v === "number" ? String(v).replace(".", ",") : v;
      return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["Nr. contor", "Abonat", "Adresă", "Index anterior (m³)", "Data indexului anterior", "Index curent (m³)", "Consum (m³)", "Citit la", "Citit de", "Poză", "Distanță față de citirea anterioară (m)", "Latitudine contor", "Longitudine contor"].map((h) => esc(t(h)));
    const lines = [head.join(";")];
    for (const r of list) {
      lines.push(
        [
          r.contor, r.name, r.address, r.lastIndex, dmy(r.lastDate), r.value, r.consum,
          r.readAt ? new Date(r.readAt).toLocaleString(tag) : "", r.by, r.photo ? t("da") : "", r.distanceM, r.lat, r.lng,
        ].map(esc).join(";"),
      );
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `citiri-teren-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    toast.success(t("{n} contoare exportate.", { n: nf(list.length) }));
  }

  const onSaved = useCallback(
    (id: string, patch: { value?: number; readAt?: number; photo?: boolean }, by?: string | null, distanceM?: number | null, geo?: boolean, loc?: MeterLocationDto) => {
      ds.patchRow(id, { ...patch, by, distanceM, geo, ...(loc ? { address: loc.address, lat: loc.lat, lng: loc.lng, addrField: loc.addrField } : {}) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ds.patchRow],
  );

  const empty = (
    <div className="p-8 text-center text-[13px] text-ink-soft">
      {!data ? t("se încarcă lista completă…") : filters.status === "unread" && active === 0 ? t("Toate contoarele au fost citite luna aceasta. 🎉") : t("Niciun contor cu filtrele acestea.")}{" "}
      {data && active > 0 && <button type="button" onClick={clearAll} className="font-semibold text-brand underline">{t("Resetează filtrele")}</button>}
    </div>
  );

  return (
    <div>
      {/* ── Progres ───────────────────────────────────────────────────────── */}
      <div className="card mb-3 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm font-semibold">{monthLabel || "…"}</p>
          <p className="text-sm">
            <b className="tabular-nums">{nf(stats.done)}</b> {t("din")} <span className="tabular-nums">{nf(stats.total)}</span> {t("contoare citite")} · <b className="tabular-nums">{pct}%</b>
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>
        {stats.flagged > 0 && (
          <p className="mt-1.5 text-xs text-ink-soft">
            ⚠ {t("{n} citiri de verificat (consum negativ sau neobișnuit de mare, ori citite departe de locația anterioară).", { n: nf(stats.flagged) })}
          </p>
        )}
      </div>

      {/* ── Filtre ────────────────────────────────────────────────────────── */}
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <input
          value={draft.q}
          onChange={(e) => onText("q", e.target.value)}
          placeholder={t("Caută nr. contor, adresă, abonat…")}
          aria-label={t("Căutare")}
          className={`${txtFld(draft.q)} min-w-48 flex-1`}
        />
        <input
          value={draft.street}
          onChange={(e) => onText("street", e.target.value)}
          placeholder={t("Stradă / adresă…")}
          aria-label={t("Adresă")}
          className={`${txtFld(draft.street)} w-40`}
        />
        <div className="flex overflow-hidden rounded-lg border border-[var(--color-line)] text-[12px]" role="tablist">
          {(["unread", "read", "all"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={filters.status === k}
              onClick={() => setFilter({ status: k })}
              className={`tap h-8 px-3 font-medium ${filters.status === k ? "bg-brand text-white" : "bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
            >
              {k === "unread" ? t("Necitite") : k === "read" ? t("Citite") : t("Toate")}
            </button>
          ))}
        </div>
        <select value={filters.check} onChange={(e) => setFilter({ check: e.target.value as FieldFilters["check"], ...(e.target.value ? { status: "read" as const } : {}) })} className={fld(filters.check)} aria-label={t("De verificat")}>
          <option value="">{t("Verificare: toate")}</option>
          <option value="lower">{t("Index mai mic decât cel anterior")}</option>
          <option value="high">{t("Consum neobișnuit de mare")}</option>
          <option value="zero">{t("Consum zero")}</option>
          <option value="far">{t("Citit departe de locația anterioară")}</option>
        </select>
        <select value={filters.photo} onChange={(e) => setFilter({ photo: e.target.value as FieldFilters["photo"] })} className={fld(filters.photo)} aria-label={t("Poză")}>
          <option value="">{t("Poză: toate")}</option>
          <option value="yes">{t("Cu poză")}</option>
          <option value="no">{t("Fără poză")}</option>
        </select>
        <select value={filters.by} onChange={(e) => setFilter({ by: e.target.value })} className={fld(filters.by)} aria-label={t("Citit de")}>
          <option value="">{t("Citit de: toți")}</option>
          {stats.users.map((u) => <option key={u} value={u}>{u}</option>)}
          {filters.by && !stats.users.includes(filters.by) && <option value={filters.by}>{filters.by}</option>}
        </select>
        <select value={filters.locality} onChange={(e) => setFilter({ locality: e.target.value })} className={fld(filters.locality)} aria-label={t("Localitate")}>
          <option value="">{t("Localitate: toate")}</option>
          {stats.localities.map((l) => <option key={l} value={l}>{l}</option>)}
          {filters.locality && !stats.localities.includes(filters.locality) && <option value={filters.locality}>{filters.locality}</option>}
        </select>
        <select value={filters.address} onChange={(e) => setFilter({ address: e.target.value as FieldFilters["address"] })} className={fld(filters.address)} aria-label={t("Adresă contor")}>
          <option value="">{t("Adresă: toate")}</option>
          <option value="has">{t("Cu adresă")}</option>
          <option value="none">{t("Fără adresă")}</option>
        </select>
        <select value={filters.meterLoc} onChange={(e) => setFilter({ meterLoc: e.target.value as FieldFilters["meterLoc"] })} className={fld(filters.meterLoc)} aria-label={t("Locația contorului")} title={t("Contoare cu locația GPS salvată sau încă fără locație")}>
          <option value="">{t("GPS contor: toate")}</option>
          <option value="yes">{t("Cu locația contorului")}</option>
          <option value="no">{t("Fără locația contorului")}</option>
        </select>
        <select value={filters.lastIndex} onChange={(e) => setFilter({ lastIndex: e.target.value as FieldFilters["lastIndex"] })} className={fld(filters.lastIndex)} aria-label={t("Ultimul index")} title={t("Cât de vechi e ultimul index cunoscut")}>
          <option value="">{t("Ultimul index: oricând")}</option>
          <option value="3m">{t("Mai vechi de 3 luni")}</option>
          <option value="6m">{t("Mai vechi de 6 luni")}</option>
          <option value="12m">{t("Mai vechi de 1 an")}</option>
          <option value="none">{t("Fără index anterior")}</option>
        </select>
        <select value={filters.geo} onChange={(e) => setFilter({ geo: e.target.value as FieldFilters["geo"] })} className={fld(filters.geo)} aria-label={t("Locație GPS")}>
          <option value="">{t("Locație GPS: toate")}</option>
          <option value="yes">{t("Cu locație")}</option>
          <option value="no">{t("Fără locație")}</option>
        </select>
        <span className="flex items-center gap-1" title={t("Citit între zilele")}>
          <input type="date" value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} aria-label={t("Citit de la data")} className={txtFld(filters.from)} />
          <span className="text-ink-soft">–</span>
          <input type="date" value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} aria-label={t("Citit până la data")} className={txtFld(filters.to)} />
        </span>
        <span className="flex items-center gap-1" title={t("Consum între (m³)")}>
          <input inputMode="decimal" value={draft.consumMin} onChange={(e) => onText("consumMin", e.target.value)} placeholder={t("Consum de la")} aria-label={t("Consum de la (m³)")} className={txtFld(draft.consumMin) + " w-24"} />
          <span className="text-ink-soft">–</span>
          <input inputMode="decimal" value={draft.consumMax} onChange={(e) => onText("consumMax", e.target.value)} placeholder={t("până la")} aria-label={t("Consum până la (m³)")} className={txtFld(draft.consumMax) + " w-24"} />
        </span>
        <select value={filters.sort} onChange={(e) => setFilter({ sort: e.target.value as FieldFilters["sort"] })} className={fld(filters.sort)} aria-label={t("Sortare")}>
          <option value="">{t("Sortare: ordinea adreselor")}</option>
          <option value="contor">{t("Nr. contor")}</option>
          <option value="name">{t("Abonat (A-Z)")}</option>
          <option value="readDesc">{t("Citite recent")}</option>
          <option value="consumDesc">{t("Consum: descrescător")}</option>
          <option value="consumAsc">{t("Consum: crescător")}</option>
          <option value="lastOld">{t("Ultimul index: cel mai vechi")}</option>
        </select>
        {(active > 0 || filters.sort) && (
          <button type="button" onClick={clearAll} className="tap h-8 rounded-lg border border-[var(--color-line)] px-2 text-[12px] text-ink-soft hover:bg-[var(--color-surface-2)]">
            {t("Resetează filtrele")}{active > 0 ? ` (${active})` : ""}
          </button>
        )}
      </div>

      {/* ── Sumar + rânduri pe pagină ─────────────────────────────────────── */}
      <div className="mb-1 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <span><b>{nf(list.length)}</b> {t("contoare")}{active > 0 ? ` ${t("(filtrat)")}` : ""}</span>
        {list.length > 0 && <span className="text-ink-soft">{t("afișate {from}–{to} din {total}", { from: nf(from), to: nf(to), total: nf(list.length) })}{totalPages > 1 ? ` · ${t("pagina {cur}/{pages}", { cur: curPage, pages: totalPages })}` : ""}</span>}
        {data ? (
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
          disabled={list.length === 0}
          title={t("Descarcă lista filtrată (CSV, se deschide în Excel)")}
          className="tap ml-auto inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[12px] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-40"
        >
          ⬇ {t("Export (cu filtrele)")}
        </button>
        <button
          type="button"
          onClick={toggleCards}
          aria-pressed={cards}
          title={cards ? t("Înapoi la tabel") : t("Afișează contoarele într-o coloană mică; apeși pe unul ca să vezi detaliile (potrivit pentru telefon)")}
          className={`tap h-8 cursor-pointer rounded-lg border px-2 text-[12px] ${cards ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
        >
          {cards ? `▦ ${t("Tabel")}` : `📱 ${t("Mod telefon")}`}
        </button>
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          {t("Afișează")}
          <select
            value={perPage}
            onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
            className={fld(perPage === DEFAULT_PER_PAGE ? "" : "x")}
            aria-label={t("Rânduri pe pagină")}
          >
            {NOTIFY_PER_PAGE.map((n) => <option key={n} value={n}>{perPageLabel(n, t)}</option>)}
          </select>
        </label>
      </div>
      {ds.loading && !data && <div className="mb-2 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}
      {ds.error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {t(ds.error)}
          <button type="button" onClick={() => void ds.refresh()} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
        </p>
      )}

      {/* ── Tabel / carduri ───────────────────────────────────────────────── */}
      {cards ? (
        pageRows.length === 0 ? (
          <div className="card">{empty}</div>
        ) : (
          <FieldCards rows={pageRows} onOpen={onOpen} resetKey={`${curPage}|${perPage}|${listFilters.status}`} />
        )
      ) : (
        <GridTable rows={pageRows} compact={listFilters.status === "unread"} sort={filters.sort} onSort={onSort} onOpen={onOpen} resetKey={`${curPage}|${perPage}|${listFilters.status}|${listFilters.sort}|${listFilters.q}`} empty={pageRows.length === 0 ? empty : null} />
      )}

      {/* ── Paginare numerică ─────────────────────────────────────────────── */}
      {list.length > 0 && totalPages > 1 && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-1">
          <button
            disabled={curPage <= 1}
            onClick={() => setPage(curPage - 1)}
            className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={t("Pagina anterioară")}
          >
            <IconChevronLeft className="size-4" />
          </button>
          {pageButtons.map((b, i) =>
            b === "…" ? (
              <span key={`e${i}`} className="flex h-8 w-6 items-center justify-center text-sm text-ink-soft">…</span>
            ) : (
              <button
                key={b}
                onClick={() => setPage(b)}
                className={`tap h-8 min-w-[32px] rounded-lg px-2 text-xs font-medium ${b === curPage ? "bg-brand text-white" : "border border-[var(--color-line)] text-ink hover:bg-[var(--color-surface-2)]"}`}
              >
                {b}
              </button>
            ),
          )}
          <button
            disabled={curPage >= totalPages}
            onClick={() => setPage(curPage + 1)}
            className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={t("Pagina următoare")}
          >
            <IconChevronRight className="size-4" />
          </button>
        </div>
      )}

      {selected && (
        <ReadingDialog
          key={selected.id}
          row={selected}
          canViewMeter={canViewMeter}
          onClose={() => setSelId(null)}
          onSaved={onSaved}
          onNext={() => {
            const n = nextUnread(selected.id);
            jumpTo.current = n;
            setSelId(n);
          }}
        />
      )}
    </div>
  );
}

/** Starea unui rând, pe scurt: neobișnuit (consum negativ / mare) sau citit departe. */
function suspectLabel(s: "lower" | "high" | "far", t: (k: string, v?: Record<string, string | number>) => string): string {
  return s === "lower" ? t("Indexul este mai mic decât cel anterior.") : s === "high" ? t("Consum neobișnuit de mare.") : t("Citit departe de locația anterioară");
}

/** Un rând al tabelului (grilă CSS, layout izolat: `contain`). Memoizat: la derulare se desenează doar rândurile care intră în fereastră. */
const FieldTr = memo(function FieldTr({ r, onOpen, compact }: { r: FieldRow; onOpen: (r: FieldRow) => void; compact: boolean }) {
  const t = useT();
  const { num, dt } = getFmt(dateTag(useLocale()));
  const sus = r.value != null ? fieldSuspect(r) : null;
  const num_ = `${CELL} text-right tabular-nums`;
  return (
    <div
      role="row"
      data-row=""
      tabIndex={0}
      onClick={() => onOpen(r)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(r)}
      className={`grid cursor-pointer outline-none hover:bg-brand-soft/30 focus-visible:bg-brand-soft/40 ${r.value != null ? "bg-st-done/5" : ""}`}
      style={{ gridTemplateColumns: compact ? GRID_COMPACT : GRID, height: ROW_H, contain: "layout style" }}
    >
      <div role="cell" className={`${CELL} sticky left-0 z-10 bg-[var(--color-surface)] font-mono font-medium`}>{r.contor}</div>
      <div role="cell" className={CELL} title={r.name}>{r.name}</div>
      <div role="cell" className={CELL} title={r.addrField ? `${r.address} · ${t("adresă scrisă din teren")}` : (r.address ?? "")}>{r.address ? <>{r.address}{r.addrField && <span className="ml-1 text-ink-soft" aria-hidden>✎</span>}</> : <Dash />}</div>
      <div role="cell" className={num_}>{r.lastIndex != null ? num(r.lastIndex) : <Dash />}</div>
      <div role="cell" className={CELL}>{r.lastDate ? dmy(r.lastDate) : <Dash />}</div>
      {!compact && (
        <>
        <div role="cell" className={`${num_} ${r.value != null ? "font-bold text-st-done" : ""}`}>{r.value != null ? `✓ ${num(r.value)}` : <Dash />}</div>
        <div role="cell" className={`${num_} ${sus === "lower" || sus === "high" ? "font-semibold text-st-cancelled" : r.consum != null && r.consum > 0 ? "font-semibold" : "text-ink-soft"}`} title={sus === "lower" || sus === "high" ? suspectLabel(sus, t) : undefined}>
          {r.consum != null ? `${sus === "lower" || sus === "high" ? "⚠ " : ""}${num(r.consum)} m³` : <Dash />}
        </div>
        <div role="cell" className={CELL}>{r.readAt ? dt(r.readAt) : <Dash />}</div>
        <div role="cell" className={CELL} title={r.by ?? ""}>{r.by ?? <Dash />}</div>
        <div role="cell" className={`${CELL} text-center`}>{r.photo ? "📷" : <Dash />}</div>
        <div role="cell" className={`${num_} ${sus === "far" ? "font-semibold text-st-cancelled" : "text-ink-soft"}`} title={sus === "far" ? suspectLabel("far", t) : undefined}>
          {r.distanceM != null ? `${sus === "far" ? "⚠ " : ""}${num(r.distanceM)} m` : <Dash />}
        </div>
        </>
      )}
      <div role="cell" className={`${CELL} text-center`} onClick={(e) => e.stopPropagation()}>
        {r.lat != null && r.lng != null ? (
          <a href={mapsUrl(r.lat, r.lng)} target="_blank" rel="noreferrer" title={t("Locația contorului pe hartă")} aria-label={t("Locația contorului pe hartă")} className="hover:opacity-70">📍</a>
        ) : (
          <Dash />
        )}
      </div>
      <div role="cell" className={`${CELL} flex items-center justify-center`}>
        <span className={`inline-flex h-5 items-center rounded-md px-2 text-[11px] font-semibold ${r.value != null ? "border border-[var(--color-line)] text-ink-soft" : "bg-brand text-white"}`}>
          {r.value != null ? t("Corectează") : t("Citește")}
        </span>
      </div>
    </div>
  );
});

function Dash() {
  return <span className="text-ink-soft/60">—</span>;
}

/**
 * Tabelul (antet + rânduri virtualizate). Starea de derulare stă AICI, nu în pagină: la derulare se re-randează doar această componentă (și doar când se
 * trece într-un alt bloc de rânduri), nu filtrele și pop-up-ul. Rândurile sunt memoizate, deci se montează doar cele noi.
 */
const GridTable = memo(function GridTable({
  rows,
  sort,
  onSort,
  onOpen,
  resetKey,
  empty,
  compact,
}: {
  rows: FieldRow[];
  compact: boolean;
  sort: FieldFilters["sort"];
  onSort: (next: FieldFilters["sort"]) => void;
  onOpen: (r: FieldRow) => void;
  /** Se schimbă la alt filtru / altă pagină: tabelul revine sus. */
  resetKey: string;
  empty: React.ReactNode;
}) {
  const t = useT();
  const rowCount = rows.length;
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
    // Starea se schimbă doar când se trece într-un alt bloc de rânduri; între blocuri derularea e doar a browserului (fără randări React).
    const b = Math.floor(e.currentTarget.scrollTop / (ROW_H * ROW_BLOCK));
    setVBlock((cur) => (cur === b ? cur : b));
  }
  const winStart = virtual ? Math.max(0, vBlock * ROW_BLOCK - ROW_OVERSCAN) : 0;
  const winEnd = virtual ? Math.min(rowCount, (vBlock + 1) * ROW_BLOCK + Math.ceil(vH / ROW_H) + ROW_OVERSCAN) : rowCount;
  const winRows = virtual ? rows.slice(winStart, winEnd) : rows;
  const cycle = (up: FieldFilters["sort"], down: FieldFilters["sort"]) => onSort(sort === up ? down : sort === down ? "" : up);
  const arrow = (up: FieldFilters["sort"], down: FieldFilters["sort"]) => (sort === up ? "▲" : sort === down ? "▼" : "↕");

  return (
    <div ref={scrollRef} onScroll={virtual ? onScroll : undefined} className="card mx-auto w-fit max-w-full overflow-auto" style={{ maxHeight: rowCount > 50 ? "max(78vh, 890px)" : undefined, overflowAnchor: "none" }}>
      <div role="table" className="text-[12px]" style={{ width: compact ? GRID_W_COMPACT : GRID_W }}>
        <div role="row" className="sticky top-0 z-20 grid bg-[var(--color-surface-2)]" style={{ gridTemplateColumns: compact ? GRID_COMPACT : GRID }}>
          <HeadCell sticky>
            <button type="button" onClick={() => onSort(sort === "contor" ? "" : "contor")} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
              {t("Nr. contor")} <span className="text-[10px] text-ink-soft">{sort === "contor" ? "▲" : "↕"}</span>
            </button>
          </HeadCell>
          <HeadCell>
            <button type="button" onClick={() => onSort(sort === "name" ? "" : "name")} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
              {t("Abonat")} <span className="text-[10px] text-ink-soft">{sort === "name" ? "▲" : "↕"}</span>
            </button>
          </HeadCell>
          <HeadCell>
            <button type="button" onClick={() => onSort("")} className="inline-flex items-center gap-1 font-semibold hover:text-brand" title={t("Ordinea adreselor")}>
              {t("Adresă")} <span className="text-[10px] text-ink-soft">{sort === "" ? "▲" : "↕"}</span>
            </button>
          </HeadCell>
          <HeadCell right title={t("Ultimul index cunoscut (m³)")}>{t("Index anterior")}</HeadCell>
          <HeadCell>{t("Data")}</HeadCell>
          {!compact && (
            <>
            <HeadCell right title={t("Indexul citit luna aceasta (m³)")}>{t("Index curent")}</HeadCell>
            <HeadCell right title={t("Consum = index curent − index anterior, în metri cubi")}>
              <button type="button" onClick={() => cycle("consumDesc", "consumAsc")} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
                {t("Consum (m³)")} <span className="text-[10px] text-ink-soft">{arrow("consumDesc", "consumAsc")}</span>
              </button>
            </HeadCell>
            <HeadCell>
              <button type="button" onClick={() => onSort(sort === "readDesc" ? "" : "readDesc")} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
                {t("Citit la")} <span className="text-[10px] text-ink-soft">{sort === "readDesc" ? "▼" : "↕"}</span>
              </button>
            </HeadCell>
            <HeadCell>{t("Citit de")}</HeadCell>
            <HeadCell>{t("Poză")}</HeadCell>
            <HeadCell right title={t("Distanța față de locația citirii anterioare")}>{t("Locație")}</HeadCell>
            </>
          )}
          <HeadCell title={t("Locația GPS a contorului (salvată la o citire)")}>GPS</HeadCell>
          <HeadCell>{" "}</HeadCell>
        </div>
        {winStart > 0 && <div aria-hidden style={{ height: winStart * ROW_H }} />}
        {winRows.map((r) => <FieldTr key={r.id} r={r} onOpen={onOpen} compact={compact} />)}
        {winEnd < rowCount && <div aria-hidden style={{ height: (rowCount - winEnd) * ROW_H }} />}
        {empty}
      </div>
    </div>
  );
});

/** Celulă de antet (grilă). */
function HeadCell({ children, right, sticky, title }: { children: React.ReactNode; right?: boolean; sticky?: boolean; title?: string }) {
  return (
    <div
      role="columnheader"
      title={title}
      className={`flex h-8 items-center overflow-hidden whitespace-nowrap border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 font-semibold ${right ? "justify-end text-right" : ""} ${sticky ? "sticky left-0 z-30" : ""}`}
    >
      {children}
    </div>
  );
}

/** Mod telefon: un card pe contor (listă virtualizată peste 80 de rânduri). */
function FieldCards({ rows, onOpen, resetKey }: { rows: FieldRow[]; onOpen: (r: FieldRow) => void; resetKey: string }) {
  const t = useT();
  const { num, dt } = getFmt(dateTag(useLocale()));
  const renderCard = (r: FieldRow) => {
    const sus = r.value != null ? fieldSuspect(r) : null;
    return (
      <button
        key={r.id}
        type="button"
        onClick={() => onOpen(r)}
        className={`tap flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${r.value != null ? "border-st-done/40 bg-st-done/5" : "border-[var(--color-line)] bg-[var(--color-surface)] hover:bg-brand-soft/40"}`}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[15px] font-bold">{r.contor}</span>
          <span className="block truncate text-[13px]">{r.address ?? "—"}</span>
          <span className="block truncate text-[11px] text-ink-soft">{r.name}</span>
        </span>
        <span className="shrink-0 text-right text-[12px]">
          {r.value != null ? (
            <>
              <span className="block text-base font-bold tabular-nums text-st-done">✓ {num(r.value)} m³</span>
              <span className={`block ${sus ? "font-semibold text-st-cancelled" : "text-ink-soft"}`}>
                {sus ? `⚠ ${r.consum != null ? `${num(r.consum)} m³ · ` : ""}` : r.consum != null ? `+${num(r.consum)} m³ · ` : ""}
                {r.readAt ? dt(r.readAt) : ""}
                {r.photo ? " · 📷" : ""}
              </span>
            </>
          ) : (
            <>
              <span className="block text-ink-soft">{t("Anterior")}</span>
              <span className="block font-semibold tabular-nums">{r.lastIndex != null ? `${num(r.lastIndex)} m³` : "—"}</span>
            </>
          )}
        </span>
      </button>
    );
  };
  if (rows.length <= VIRTUAL_MIN) return <div className="flex flex-col gap-1.5">{rows.map(renderCard)}</div>;
  return <VirtualList key={resetKey} count={rows.length} estimate={68} gap={6} itemKey={(i) => rows[i].id} render={(i) => renderCard(rows[i])} />;
}

/** Fereastra de citire a unui contor: formularul de citire într-un pop-up (de jos pe telefon, centrat pe ecran mare). */
function ReadingDialog({
  row,
  canViewMeter,
  onClose,
  onSaved,
  onNext,
}: {
  row: FieldRow;
  canViewMeter: boolean;
  onClose: () => void;
  onSaved: (id: string, patch: { value?: number; readAt?: number; photo?: boolean }, by?: string | null, distanceM?: number | null, geo?: boolean, loc?: MeterLocationDto) => void;
  onNext: () => void;
}) {
  const t = useT();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[94dvh] w-full max-w-md overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-mono text-xl font-bold">{row.contor}</h2>
            <p className="text-xs text-ink-soft">{row.name}</p>
            {row.value != null && row.by && (
              <p className="mt-0.5 text-[11px] text-ink-soft">
                {t("Citit de")} {row.by}
                {row.distanceM != null && row.distanceM > FAR_METERS ? ` · ⚠ ${t("Citit departe de locația anterioară")} (${row.distanceM} m)` : ""}
                {row.consum != null && row.consum > JUMP_CONFIRM_M3 ? ` · ⚠ ${t("Consum neobișnuit de mare.")}` : ""}
              </p>
            )}
          </div>
          <button onClick={onClose} className="tap grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>
            <IconX className="size-4" />
          </button>
        </div>
        <ReadingForm
          meterId={row.id}
          address={row.address}
          addressEditable={!row.address || row.addrField}
          meterLat={row.lat}
          meterLng={row.lng}
          lastIndex={row.lastIndex}
          lastDate={row.lastDate}
          initialValue={row.value}
          onSaved={(patch, reading, loc) => onSaved(row.id, patch, reading.userName, reading.distanceM, reading.lat != null && reading.lng != null, loc)}
          onNext={onNext}
          onClose={onClose}
        />
        {canViewMeter && (
          <Link href={`/contoare/${encodeURIComponent(row.id)}`} className="mt-3 block text-center text-xs text-brand underline">
            {t("Pagina contorului →")}
          </Link>
        )}
      </div>
    </div>
  );
}

/** Butoanele de paginare cu „…" pentru spații mari (aceeași logică ca la Plătitori / Contoare). */
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

