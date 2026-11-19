"use client";

import DateFilterInput from "./DateFilterInput";
import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  EMPTY_FIELD_FILTERS,
  FAR_METERS,
  currentPeriod,
  shiftPeriod,
  countActiveFieldFilters,
  deviationPct,
  fieldConsum,
  fieldFiltersToParams,
  fieldSuspect,
  filterField,
  sanitizeFieldFilters,
  type FieldFilters,
  type FieldRow,
} from "@/lib/meter-readings";
import { ISSUE_LABELS, isIssueKind, SERIOUS_ISSUES } from "@/lib/meter-issues";
import { prepareRoutes, routeOf } from "@/lib/meter-routes";
import { DEFAULT_PER_PAGE, normalizePerPageClient } from "@/lib/payer-notify";
import { useLocale, useT } from "@/lib/i18n/context";
import FiltersToggle from "./FiltersToggle";
import { useFiltersOpen } from "./useFiltersOpen";
import { dateTag } from "@/lib/i18n/t";
import { useToast } from "./toast";
import ReadingForm from "./ReadingForm";
import SendTo1cButton from "./SendTo1cButton";
import EstimatedReportButton from "./EstimatedReportButton";
import { useFieldDataset, usePastField } from "./useFieldDataset";
import { deleteMeterReadingsAction } from "@/app/actions/meter-readings";
import { onQueueSynced, removeQueued, retryQueued, syncNow, useFieldQueue } from "./field-queue";
import { MAX_LOC_ACCURACY, mapsUrl, type MeterLocationDto } from "@/lib/meter-readings";
import { IconChevronLeft, IconChevronRight, IconX } from "./icons";
import DataTable, { type Col } from "./DataTable";

const STORAGE_KEY = "filters:/contoare/citiri";
const ALL_ROUTES_KEY = "field-all-routes";
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
/** Bara de stare a coadei de pe telefon: fără internet, citiri în așteptare / respinse, lista cozii cu „Retrimite” și „Șterge”. */
function QueueBanner({ q, loadedAt, tag }: { q: ReturnType<typeof useFieldQueue>; loadedAt: number | null; tag: string }) {
  const t = useT();
  const waiting = q.items.filter((i) => i.state === "wait").length;
  const failed = q.items.filter((i) => i.state === "error").length;
  if (q.online && q.items.length === 0) return null;
  const time = (ms: number) => new Date(ms).toLocaleTimeString(tag, { hour: "2-digit", minute: "2-digit" });
  return (
    <div className={`card mb-3 p-3 text-sm ${!q.online ? "border-st-progress/50 bg-st-progress/10" : ""}`} role="status">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {!q.online && <span className="font-semibold">📴 {t("Fără internet")} — {t("citirile se salvează pe telefon și pleacă singure când revine conexiunea.")}</span>}
        {waiting > 0 && (
          <span>
            ⏳ <b className="tabular-nums">{waiting}</b> {t("citiri în așteptare")}
            {q.syncing ? ` · ${t("se trimit…")}` : ""}
          </span>
        )}
        {failed > 0 && (
          <span className="text-st-cancelled">
            ⚠ <b className="tabular-nums">{failed}</b> {t("respinse de server")}
          </span>
        )}
        {loadedAt && <span className="text-xs text-ink-soft">{t("Lista descărcată la {time}", { time: time(loadedAt) })}</span>}
        {waiting > 0 && (
          <button type="button" onClick={() => void syncNow()} disabled={!q.online || q.syncing} className="tap ml-auto h-8 cursor-pointer rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-50">
            {t("Trimite acum")}
          </button>
        )}
      </div>
      {q.items.length > 0 && (
        <details className="mt-2" open={failed > 0}>
          <summary className="cursor-pointer text-xs font-semibold text-brand">{t("Vezi citirile din coadă")}</summary>
          <ul className="mt-1.5 divide-y divide-[var(--color-line)] text-[13px]">
            {q.items.map((i) => (
              <li key={i.cid} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5">
                <span className="font-mono font-semibold">{i.contor}</span>
                <span className="min-w-0 flex-1 truncate text-ink-soft">{i.name}</span>
                {i.value != null ? <span className="tabular-nums font-semibold">{i.value.toLocaleString(tag, { maximumFractionDigits: 3 })} m³</span> : <span className="text-xs text-ink-soft">{t("fără index")}</span>}
                {i.issueKind && isIssueKind(i.issueKind) && <span className="rounded bg-st-cancelled/10 px-1.5 text-[11px] font-semibold text-st-cancelled">⚑ {t(ISSUE_LABELS[i.issueKind])}</span>}
                <span className="text-xs text-ink-soft">{time(i.readAt)}{i.photo ? " · 📷" : ""}</span>
                {i.state === "wait" && !i.error && <span className="rounded bg-st-progress/15 px-1.5 text-[11px] font-semibold text-st-progress">{t("În așteptare")}</span>}
                {i.error && <span className="w-full text-xs text-st-cancelled">{i.state === "error" ? `${t("Respinsă")}: ` : ""}{i.error}</span>}
                <span className="ml-auto flex gap-1">
                  {i.state === "error" && (
                    <button type="button" onClick={() => void retryQueued(i.cid)} className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-xs hover:bg-[var(--color-surface-2)]">{t("Retrimite")}</button>
                  )}
                  <button
                    type="button"
                    onClick={() => { if (window.confirm(t("Ștergi această citire din coadă? Nu va mai fi trimisă."))) void removeQueued(i.cid); }}
                    className="tap h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-xs text-st-cancelled hover:bg-[var(--color-surface-2)]"
                  >
                    {t("Șterge")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function FieldReadings({
  openId,
  canViewMeter,
  canExport = true,
  canDelete = false,
  initialQuery,
  meId,
}: {
  openId: string | null;
  canViewMeter: boolean;
  canExport?: boolean;
  /** Poate șterge citiri (citiri de test / greșite): „Rute de citire, planificat vs citit…” (meters.manage). */
  canDelete?: boolean;
  /** Utilizatorul curent: „Rutele mele” = rutele atribuite lui. */
  meId: string;
  /** Parametrii din adresă (?q=…&status=…): link de partajat. */
  initialQuery: Record<string, string | undefined>;
}) {
  const t = useT();
  const toast = useToast();
  const [fOpen, toggleF] = useFiltersOpen("field-readings");
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag);
  const curPeriod = currentPeriod();
  /** Luna afișată: gol = luna curentă (se pot face citiri); altfel o lună anterioară (doar vizualizare / ștergere / trimitere către 1C). */
  const [month, setMonth] = useState<string>(() => (/^\d{4}-(0[1-9]|1[0-2])$/.test(initialQuery.month ?? "") && (initialQuery.month as string) < curPeriod ? (initialQuery.month as string) : ""));
  const viewing = month && month < curPeriod ? month : null;
  const cur = useFieldDataset();
  const past = usePastField(viewing);
  // „ds” = sursa listei afișate: luna curentă (cache local, actualizări) sau luna anterioară aleasă
  const ds = viewing ? { ...cur, data: past.data, routes: past.routes, loading: past.loading, error: past.error, loadedAt: past.loadedAt, refresh: past.refresh } : cur;
  const data = ds.data;
  const q = useFieldQueue();
  const patchRow = cur.patchRow;
  // citirile trimise cu succes din coadă: rândul se actualizează cu ce a salvat serverul
  useEffect(
    () =>
      onQueueSynced((item, res) => {
        if (res.issue) patchRow(item.meterId, { issue: res.issue.resolvedAt ? null : res.issue.kind });
        const rd = res.reading;
        const loc = res.location;
        if (!rd || !loc) return;
        patchRow(item.meterId, {
          value: rd.value,
          readAt: new Date(rd.readAt).getTime(),
          photo: !!rd.photoUrl,
          by: rd.userName,
          portal: false,
          distanceM: rd.distanceM,
          avg: rd.avgConsum,
          geo: rd.lat != null && rd.lng != null,
          // la o retrimitere (citire deja salvată) serverul nu știe adresa: nu o ștergem din rând
          ...(loc.address != null ? { address: loc.address, addrField: loc.addrField } : {}),
          lat: loc.lat,
          lng: loc.lng,
          locAcc: loc.accuracy,
        });
      }),
    [patchRow],
  );
  /** Lista de afișat: citirile din coada de pe telefon se văd peste lista descărcată (⏳ în așteptare / ⚠ respinse). */
  const routes = ds.routes;
  const myRoutes = useMemo(() => routes.filter((r) => r.readerId === meId), [routes, meId]);
  const mineIds = useMemo(() => new Set(myRoutes.map((r) => r.id)), [myRoutes]);
  /** Fiecare contor primește ruta lui (prima rută ale cărei reguli i se potrivesc: sector 1C / localitate / stradă). */
  const routed = useMemo(() => {
    if (!data) return [];
    if (routes.length === 0) return data.rows;
    const prepared = prepareRoutes(routes);
    return data.rows.map((r): FieldRow => ({ ...r, route: routeOf({ sector: r.sector, address: r.address }, prepared) }));
  }, [data, routes]);
  const rowsAll = useMemo(() => {
    if (viewing || q.items.length === 0) return routed; // coada de pe telefon ține doar de luna curentă
    const by = new Map(q.items.map((i) => [i.meterId, i]));
    return routed.map((r): FieldRow => {
      const it = by.get(r.id);
      if (!it) return r;
      const issue = it.issueKind ?? r.issue;
      if (it.value == null) return { ...r, issue };
      return { ...r, issue, value: it.value, readAt: it.readAt, photo: !!it.photo, by: t("Tu"), portal: false, distanceM: null, consum: fieldConsum(it.value, r.lastIndex), geo: it.lat != null, pending: it.state === "error" ? "error" : "wait" };
    });
  }, [routed, q.items, t, viewing]);

  const initialFilters = useMemo(() => sanitizeFieldFilters(initialQuery), [initialQuery]);
  const [filters, setFilters] = useState<FieldFilters>(initialFilters);
  const [draft, setDraft] = useState<Record<TextKey, string>>({ q: initialFilters.q, street: initialFilters.street, consumMin: initialFilters.consumMin, consumMax: initialFilters.consumMax });
  const [page, setPage] = useState(Math.max(1, Math.floor(Number(initialQuery.page)) || 1));
  const [perPage, setPerPage] = useState(normalizePerPageClient(initialQuery.perPage));
  const [selId, setSelId] = useState<string | null>(openId);
  const [ready, setReady] = useState(false);
  /** „Toate rutele”: bifat = vezi toate rutele; debifat (implicit) = doar rutele atribuite lui. Fără rute atribuite nu există restricție. */
  const [allRoutes, setAllRoutes] = useState(false);
  const debounce = useRef<Partial<Record<TextKey, ReturnType<typeof setTimeout>>>>({});
  const jumpTo = useRef<string | null>(null);


  // Restaurează filtrele salvate (doar dacă adresa nu are propriile filtre) — ca la Contoare.
  useEffect(() => {
    const urlEmpty = countActiveFieldFilters(initialFilters) === 0 && !initialFilters.sort && !initialQuery.page && !initialQuery.perPage;
    if (urlEmpty) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (localStorage.getItem(ALL_ROUTES_KEY) === "1") setAllRoutes(true);
        const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { f?: unknown; perPage?: unknown } | null;
        if (saved) {
          const f = sanitizeFieldFilters((saved.f ?? {}) as Record<string, unknown>);
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
    if (viewing) usp.set("month", viewing);
    const qs = usp.toString();
    window.history.replaceState(null, "", `/contoare/citiri${qs ? `?${qs}` : ""}`);
  }, [filters, page, perPage, ready, openId, viewing]);

  // Controalele se actualizează imediat; lista de ~25.000 de rânduri se recalculează în randarea următoare (amânată), deci un select nu „se agață".
  const listFilters = useDeferredValue(filters);
  // Cititorul cu rute atribuite vede DOAR contoarele rutelor lui; cu „Toate rutele” bifat le vede pe toate.
  const restricted = myRoutes.length > 0 && !allRoutes;
  const visibleRows = useMemo(() => (restricted ? rowsAll.filter((r) => !!r.route && mineIds.has(r.route)) : rowsAll), [restricted, rowsAll, mineIds]);
  const effFilters = useMemo(() => (restricted ? { ...listFilters, route: mineIds.has(listFilters.route) ? listFilters.route : "mine" } : listFilters), [restricted, listFilters, mineIds]);
  const list = useMemo(() => (data ? filterField(visibleRows, effFilters, mineIds) : []), [data, visibleRows, effFilters, mineIds]);

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
    for (const r of visibleRows) {
      if (r.locality) localities.add(r.locality);
      if (r.value != null) {
        done++;
        if (fieldSuspect(r)) flagged++;
        if (r.by) users.add(r.by);
      }
    }
    return { total: visibleRows.length, done, flagged, users: [...users].sort((a, b) => a.localeCompare(b)), localities: [...localities].sort((a, b) => a.localeCompare(b)) };
  }, [data, visibleRows]);

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
  const onOpen = useCallback((r: FieldRow) => setSelId(r.id), [setSelId]);

  const active = countActiveFieldFilters({ ...filters, q: draft.q, street: draft.street, consumMin: draft.consumMin, consumMax: draft.consumMax });
  const selected = selId && data ? (rowsAll.find((r) => r.id === selId) ?? null) : null;

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
      return find(filterField(visibleRows, { ...effFilters, ...(restricted ? {} : { route: filters.route }), status: "all" }, mineIds)) ?? find(visibleRows);
    },
    [data, visibleRows, effFilters, filters.route, restricted, mineIds],
  );


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
    const head = ["Nr. contor", "Abonat", "Adresă", "Index anterior (m³)", "Data indexului anterior", "Index curent (m³)", "Consum (m³)", "Citit la", "Citit de", "Poză", "Distanță față de citirea anterioară (m)", "Latitudine contor", "Longitudine contor", "Stare", "Sector 1C", "Rută", "Neregulă", "Consum mediu lunar (m³)", "Abatere față de medie (%)"].map((h) => esc(t(h)));
    const lines = [head.join(";")];
    for (const r of list) {
      lines.push(
        [
          r.contor, r.name, r.address, r.lastIndex, dmy(r.lastDate), r.value, r.consum,
          r.readAt ? new Date(r.readAt).toLocaleString(tag) : "", r.by, r.photo ? t("da") : "", r.distanceM, r.lat, r.lng,
          r.value == null ? "" : r.pending === "wait" ? t("În așteptare (pe telefon)") : r.pending === "error" ? t("Respinsă") : t("Trimis"),
          r.sector, routes.find((x) => x.id === r.route)?.name ?? "", r.issue && isIssueKind(r.issue) ? t(ISSUE_LABELS[r.issue]) : "",
          r.avg, r.avg != null && r.consum != null ? deviationPct(r.consum, r.avg) : "",
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

  /** Ultimele 18 luni, pentru selectorul din antet. */
  const monthOptions = Array.from({ length: 18 }, (_, i) => {
    const p = shiftPeriod(curPeriod, i);
    const s = new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1).toLocaleDateString(tag, { month: "long", year: "numeric" });
    return { value: p, label: s.charAt(0).toUpperCase() + s.slice(1) };
  });

  /** Trece la o altă lună. Pe o lună anterioară se arată citirile (filtrul „Citite”); la luna curentă filtrul rămâne cum era. */
  function pickMonth(p: string) {
    if (p >= curPeriod) {
      setMonth("");
    } else {
      setMonth(p);
      setFilters((f) => ({ ...f, status: f.status === "unread" ? "read" : f.status, from: "", to: "" }));
    }
    setPage(1);
  }

  /** Ce trimite butonul „Trimite către 1C”: ca la export, doar contoarele din lista filtrată (cu citiri) și luna afișată. */
  const sendScope = {
    ids: list.filter((r) => r.value != null && !r.pending).map((r) => r.id),
    period: data?.period ?? curPeriod,
    meters: list.length,
    // implicit doar lista filtrată când s-au pus filtre, s-a ales „Citite / Toate” sau altă lună; pe lista implicită (necitite) — toate citirile
    filtered: active > 0 || filters.status !== "unread" || !!viewing,
  };

  const [deleting, setDeleting] = useState(false);
  /** Citirile care se pot șterge din lista filtrată: cele salvate pe server (nu din coada de pe telefon) și nu automate LoRaWAN. */
  const deletable = useMemo(() => (canDelete ? list.filter((r) => r.value != null && !r.pending && !r.autoRead) : []), [canDelete, list]);

  /** Șterge citirile lunii pentru contoarele date (pe bucăți), apoi golește rândurile din listă. Întoarce true dacă s-a șters ceva. */
  async function deleteFor(ids: string[]): Promise<boolean> {
    setDeleting(true);
    let deleted = 0;
    let sent1c = 0;
    let failed: string | null = null;
    try {
      for (let i = 0; i < ids.length; i += 1000) {
        const chunk = ids.slice(i, i + 1000);
        const res = await deleteMeterReadingsAction(chunk, viewing);
        if (!res.ok) { failed = res.error; break; }
        deleted += res.deleted;
        sent1c += res.sent1c;
        if (!viewing) cur.clearReadings(chunk);
      }
    } catch {
      failed = "Nu am putut șterge citirile. Încearcă din nou.";
    } finally {
      setDeleting(false);
    }
    if (deleted > 0) {
      toast.success(sent1c > 0 ? t("{n} citiri șterse. {m} fuseseră deja trimise către 1C: corectează-le și acolo.", { n: nf(deleted), m: nf(sent1c) }) : t("{n} citiri șterse.", { n: nf(deleted) }));
      void ds.refresh(); // luna anterioară: lista se reia de pe server; luna curentă: se verifică lista
    }
    if (failed) toast.error(t(failed));
    return deleted > 0;
  }

  async function deleteOne(r: FieldRow) {
    if (r.value == null) return;
    if (!window.confirm(t("Ștergi citirea {value} m³ a contorului {contor}? Contorul va redeveni necitit. Dacă a fost deja trimisă către 1C, trebuie corectată și acolo.", { value: nf(r.value), contor: r.contor }))) return;
    if (await deleteFor([r.id])) setSelId(null);
  }

  async function deleteShown() {
    const n = deletable.length;
    if (n === 0) return;
    if (!window.confirm(t("Ștergi {n} citiri (toate cele afișate cu filtrele curente, din toate paginile)? Contoarele vor redeveni necitite. Acțiunea nu se poate anula.", { n: nf(n) }))) return;
    const typed = window.prompt(t("Pentru confirmare scrie numărul de citiri ({n}):", { n: nf(n) }));
    if (typed == null || typed.replace(/\D/g, "") !== String(n)) {
      if (typed != null) toast.error(t("Numărul nu corespunde: nu s-a șters nimic."));
      return;
    }
    await deleteFor(deletable.map((r) => r.id));
  }

  const onSaved = useCallback(
    (id: string, patch: { value?: number; readAt?: number; photo?: boolean }, by?: string | null, distanceM?: number | null, geo?: boolean, loc?: MeterLocationDto, avg?: number | null) => {
      ds.patchRow(id, { ...patch, by, distanceM, geo, ...(avg !== undefined ? { avg } : {}), ...(loc ? { address: loc.address, lat: loc.lat, lng: loc.lng, addrField: loc.addrField, locAcc: loc.accuracy } : {}) });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ds.patchRow],
  );

  const emptyText = !data ? t("se încarcă lista completă…") : filters.status === "unread" && active === 0 ? t("Toate contoarele au fost citite luna aceasta. 🎉") : t("Niciun contor cu filtrele acestea.");

  // ── Coloane (ca la Sarcini): se mută, se ascund, se redimensionează și se colorează din „⚙ Coloane”; alegerea rămâne salvată în browser („Resetează” revine la cele de la început). ──
  const { num, dt } = getFmt(tag);
  const dash = <Dash />;
  const columns: Col<FieldRow>[] = [
    {
      key: "contor", label: "Nr. contor", minW: 110, sticky: true, sort: (r) => r.contor,
      render: (r) => <span className="font-mono font-medium">{r.issue && isIssueKind(r.issue) && <span className={`mr-0.5 ${SERIOUS_ISSUES.includes(r.issue) ? "text-st-cancelled" : "text-st-progress"}`} title={t(ISSUE_LABELS[r.issue])}>⚑</span>}{r.contor}</span>,
    },
    { key: "name", label: "Abonat", minW: 180, maxW: 260, sort: (r) => r.name, render: (r) => r.name },
    {
      key: "address", label: "Adresă", minW: 230, maxW: 340, sort: (r) => r.address ?? "",
      render: (r) => (r.address ? <span title={r.addrField ? `${r.address} · ${t("adresă scrisă din teren")}` : r.address}>{r.address}{r.addrField && <span className="ml-1 text-ink-soft" aria-hidden>✎</span>}</span> : dash),
    },
    {
      key: "lastIndex", label: "Index anterior", minW: 95, right: true, sort: (r) => r.lastIndex,
      render: (r) => (r.lastIndex != null ? <span title={r.estimated ? t("Index estimat (calculat), nu citit — merită citit și verificat") : undefined}>{r.estimated && <span className="mr-0.5 font-semibold text-st-progress" aria-hidden>≈</span>}{num(r.lastIndex)}</span> : dash),
    },
    { key: "lastDate", label: "Data", minW: 80, sort: (r) => r.lastDate ?? "", render: (r) => (r.lastDate ? dmy(r.lastDate) : dash) },
    {
      key: "value", label: "Index curent", minW: 100, right: true, sort: (r) => r.value,
      render: (r) => (r.value != null ? <span className="font-bold text-st-done">{r.pending === "wait" ? "⏳" : r.pending === "error" ? "⚠" : "✓"} {num(r.value)}</span> : dash),
    },
    {
      key: "consum", label: "Consum (m³)", minW: 95, right: true, sort: (r) => r.consum,
      render: (r) => {
        if (r.consum == null) return dash;
        const sus = r.value != null ? fieldSuspect(r) : null;
        const bad = sus === "lower" || sus === "high" || sus === "low";
        return (
          <span className={bad ? "font-semibold text-st-cancelled" : r.consum > 0 ? "font-semibold" : "text-ink-soft"} title={bad && sus ? suspectLabel(sus, t, r, num) : r.avg != null ? t("Media lunară: {a} m³", { a: num(r.avg) }) : undefined}>
            {bad ? "⚠ " : ""}{num(r.consum)} m³
          </span>
        );
      },
    },
    { key: "readAt", label: "Citit la", minW: 120, sort: (r) => r.readAt ?? null, render: (r) => (r.readAt ? dt(r.readAt) : dash) },
    {
      key: "by", label: "Citit de", minW: 130, maxW: 200, sort: (r) => r.by ?? "",
      render: (r) => (r.by
        ? <span title={r.by}>{r.auto && <span title={t("Contor LoRaWAN")} className="mr-1 rounded bg-brand/15 px-1 text-[10px] font-semibold text-brand">📡</span>}{r.portal && <span title={t("Trimisă de plătitor din portal")} className="mr-1 rounded bg-brand/15 px-1 text-[10px] font-semibold text-brand">🌐</span>}{r.by}</span>
        : dash),
    },
    { key: "photo", label: "Poză", minW: 50, sort: (r) => (r.photo ? 1 : 0), render: (r) => (r.photo ? "📷" : dash) },
    {
      key: "distance", label: "Locație", minW: 84, right: true, sort: (r) => r.distanceM,
      render: (r) => {
        if (r.distanceM == null) return dash;
        const far = r.value != null && fieldSuspect(r) === "far";
        return <span className={far ? "font-semibold text-st-cancelled" : "text-ink-soft"} title={far ? suspectLabel("far", t) : undefined}>{far ? "⚠ " : ""}{num(r.distanceM)} m</span>;
      },
    },
    {
      key: "gps", label: "GPS", minW: 56,
      render: (r) => (r.lat != null && r.lng != null
        ? (
          <a
            href={mapsUrl(r.lat, r.lng)}
            target="_blank"
            rel="noreferrer"
            title={r.locAcc != null && r.locAcc > MAX_LOC_ACCURACY ? `${t("Locația contorului pe hartă")} · ${t("precizie slabă")} (±${Math.round(r.locAcc)} m)` : r.locAcc != null ? `${t("Locația contorului pe hartă")} (±${Math.round(r.locAcc)} m)` : t("Locația contorului pe hartă")}
            aria-label={t("Locația contorului pe hartă")}
            className={r.locAcc != null && r.locAcc > MAX_LOC_ACCURACY ? "opacity-50 hover:opacity-80" : "hover:opacity-70"}
          >
            {r.locAcc != null && r.locAcc > MAX_LOC_ACCURACY ? "⚠" : "📍"}
          </a>
        )
        : dash),
    },
    {
      key: "act", label: "", minW: 92,
      render: (r) => (
        <button
          type="button"
          onClick={() => onOpen(r)}
          className={`tap inline-flex h-5 cursor-pointer items-center rounded-md px-2 text-[11px] font-semibold ${r.value != null ? "border border-[var(--color-line)] text-ink-soft" : "bg-brand text-white"}`}
        >
          {r.value != null ? t("Corectează") : t("Citește")}
        </button>
      ),
    },
  ];

  return (
    <div>
      <QueueBanner q={q} loadedAt={ds.loadedAt} tag={tag} />

      {/* ── Progres ───────────────────────────────────────────────────────── */}
      <div className="card mb-3 p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={() => pickMonth(shiftPeriod(data?.period ?? curPeriod, 1))} className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Luna anterioară")} title={t("Luna anterioară")}>
              <IconChevronLeft className="size-4" />
            </button>
            <select value={viewing ?? curPeriod} onChange={(e) => pickMonth(e.target.value)} className="h-8 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-sm font-semibold outline-none focus:border-brand" aria-label={t("Luna citirilor")}>
              {monthOptions.map((o) => <option key={o.value} value={o.value}>{o.label}{o.value === curPeriod ? ` · ${t("luna curentă")}` : ""}</option>)}
            </select>
            <button type="button" onClick={() => pickMonth(shiftPeriod(data?.period ?? curPeriod, -1))} disabled={!viewing} className="tap grid size-8 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-30" aria-label={t("Luna următoare")} title={t("Luna următoare")}>
              <IconChevronRight className="size-4" />
            </button>
            {viewing && <button type="button" onClick={() => pickMonth(curPeriod)} className="tap h-8 rounded-lg bg-brand px-3 text-[12px] font-semibold text-white hover:bg-brand-strong">{t("Înapoi la luna curentă")}</button>}
          </div>
          <p className="text-sm">
            <b className="tabular-nums">{nf(stats.done)}</b> {t("din")} <span className="tabular-nums">{nf(stats.total)}</span> {t("contoare citite")} · <b className="tabular-nums">{pct}%</b>
          </p>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>
        {stats.flagged > 0 && (
          <p className="mt-1.5 text-xs text-ink-soft">
            ⚠ {t("{n} citiri de verificat (consum negativ, peste sau sub media contorului, ori citite departe de locația anterioară).", { n: nf(stats.flagged) })}
          </p>
        )}
      </div>

      {viewing && (
        <p className="mb-2 rounded-lg border border-st-progress/40 bg-st-progress/10 px-3 py-2 text-xs">
          {t("Vezi citirile din {luna}. Pentru luna aceasta nu se mai pot face citiri; poți exporta, trimite către 1C sau (cu drept) șterge citirile ei.", { luna: monthLabel })}
        </p>
      )}

      {/* ── Bară compactă: filtre, stare listă, acțiuni — un singur rând (mai mult loc pentru listă) ── */}
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <FiltersToggle open={fOpen} onToggle={toggleF} activeCount={active} />
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
        <span className="ml-auto inline-flex items-center gap-1.5">
          <EstimatedReportButton />
          {canExport && <SendTo1cButton scope={sendScope} />}
          {canDelete && deletable.length > 0 && (filters.status === "read" || active > 0) && (
            <button
              type="button"
              onClick={() => void deleteShown()}
              disabled={deleting}
              title={t("Șterge toate citirile afișate cu filtrele curente (citiri de test sau greșite)")}
              className="tap inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-st-cancelled/50 bg-[var(--color-surface)] px-2 text-[12px] font-medium text-st-cancelled hover:bg-st-cancelled/10 disabled:cursor-default disabled:opacity-50"
            >
              🗑 {deleting ? "…" : t("Șterge citirile afișate ({n})", { n: nf(deletable.length) })}
            </button>
          )}
        </span>
        {canExport && <button
          type="button"
          onClick={exportCsv}
          disabled={list.length === 0}
          title={t("Descarcă lista filtrată (CSV, se deschide în Excel)")}
          className="tap inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-[12px] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:cursor-default disabled:opacity-40"
        >
          ⬇ {t("Export (cu filtrele)")}
        </button>}
      </div>
      <div className={`flex-wrap items-center gap-1.5 ${fOpen ? "mb-1.5 flex" : "hidden"}`}>
        <div className={fOpen ? "contents" : "hidden"}>
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
          <option value="low">{t("Consum neobișnuit de mic față de medie")}</option>
          <option value="zero">{t("Consum zero")}</option>
          <option value="far">{t("Citit departe de locația anterioară")}</option>
        </select>
        <select value={filters.estimated} onChange={(e) => setFilter({ estimated: e.target.value as FieldFilters["estimated"] })} className={fld(filters.estimated)} aria-label={t("Citire estimată")}>
          <option value="">{t("Estimare: toate")}</option>
          <option value="yes">{t("Index estimat (calculat) — de verificat")}</option>
          <option value="no">{t("Index citit (nu estimat)")}</option>
        </select>
        <select value={filters.source} onChange={(e) => setFilter({ source: e.target.value as FieldFilters["source"] })} className={fld(filters.source)} aria-label={t("Sursa citirii")}>
          <option value="">{t("Sursa: toate")}</option>
          <option value="portal">{t("🌐 Din portal (plătitor)")}</option>
          <option value="field">{t("Cititor (în teren)")}</option>
          <option value="lorawan">{t("📡 LoRaWAN (automat)")}</option>
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
        {routes.length > myRoutes.length && myRoutes.length > 0 && (
          <label className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-[12px] ${allRoutes ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"}`} title={t("Bifat: vezi contoarele tuturor rutelor. Debifat: doar rutele atribuite ție.")}>
            <input
              type="checkbox"
              checked={allRoutes}
              onChange={(e) => {
                setAllRoutes(e.target.checked);
                try { localStorage.setItem(ALL_ROUTES_KEY, e.target.checked ? "1" : "0"); } catch {}
                setFilter({ route: "" });
              }}
              className="size-3 accent-[var(--color-brand)]"
            />
            {t("Toate rutele")}
          </label>
        )}
        {routes.length > 0 && (

          <select value={restricted ? (mineIds.has(filters.route) ? filters.route : "") : filters.route} onChange={(e) => setFilter({ route: e.target.value })} className={fld(restricted ? (mineIds.has(filters.route) ? filters.route : "") : filters.route)} aria-label={t("Ruta de citire")}>
            {restricted ? (
              myRoutes.length === 1 ? (
                // o singură rută: filtrul arată titlul ei (cititorul vede mereu pe ce rută lucrează)
                <option value="">{myRoutes[0].name}</option>
              ) : (
                <>
                  <option value="">{t("Rutele mele")}</option>
                  {myRoutes.map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </>
              )
            ) : (
              <>
                <option value="">{t("Rută: toate")}</option>
                {myRoutes.length > 0 && <option value="mine">{myRoutes.length === 1 ? t("Ruta mea") : t("Rutele mele")}</option>}
                {routes.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
                <option value="none">{t("Fără rută")}</option>
              </>
            )}
          </select>
        )}
        <select value={filters.issue} onChange={(e) => setFilter({ issue: e.target.value as FieldFilters["issue"] })} className={fld(filters.issue)} aria-label={t("Starea contorului")}>
          <option value="">{t("Stare contor: toate")}</option>
          <option value="any">{t("Cu neregulă deschisă")}</option>
          <option value="serious">{t("Nereguli grave (fraudă, defect, curgere inversă)")}</option>
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
          <DateFilterInput label={t("De la")} value={filters.from} onChange={(e) => setFilter({ from: e.target.value })} aria-label={t("Citit de la data")} className={txtFld(filters.from)} />
          <span className="text-ink-soft">–</span>
          <DateFilterInput label={t("Până la")} value={filters.to} onChange={(e) => setFilter({ to: e.target.value })} aria-label={t("Citit până la data")} className={txtFld(filters.to)} />
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
        </div>
        {(active > 0 || filters.sort) && (
          <button type="button" onClick={clearAll} className="tap h-8 rounded-lg border border-[var(--color-line)] px-2 text-[12px] text-ink-soft hover:bg-[var(--color-surface-2)]">
            {t("Resetează filtrele")}{active > 0 ? ` (${active})` : ""}
          </button>
        )}
      </div>

      {!data && !q.online && <div className="card mb-2 p-6 text-center text-ink-soft">{t("Fără internet, iar lista nu e descărcată pe acest telefon. Deschide pagina o dată cu internet ca să o descarci.")}</div>}
      {ds.loading && !data && <div className="mb-2 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}
      {ds.error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {t(ds.error)}
          <button type="button" onClick={() => void ds.refresh()} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
        </p>
      )}

      <DataTable<FieldRow>
        storageKey="field-readings"
        rows={list}
        columns={columns}
        filters={[]}
        noun={t("contoare")}
        emptyText={emptyText}
        onRowClick={onOpen}
        rowClickSkipsControls
        rowColor={(r) => (r.pending === "wait" ? "var(--color-st-progress)" : r.pending === "error" ? "var(--color-st-cancelled)" : r.value != null ? "var(--color-st-done)" : null)}
        cardRender={(r) => <FieldCard key={r.id} r={r} onOpen={onOpen} />}
      />

      {selected && (
        <ReadingDialog
          key={selected.id}
          row={selected}
          readOnly={!!viewing}
          periodLabel={monthLabel}
          canViewMeter={canViewMeter}
          onClose={() => setSelId(null)}
          onSaved={onSaved}
          onIssue={(kind) => patchRow(selected.id, { issue: kind })}
          onDelete={canDelete && selected.value != null && !selected.pending && !selected.autoRead ? () => void deleteOne(selected) : undefined}
          deleting={deleting}
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

/** Starea unui rând, pe scurt: neobișnuit (consum negativ / peste sau sub medie) sau citit departe; la avertismentele față de medie, abaterea în % și media. */
function suspectLabel(s: "lower" | "high" | "low" | "far", t: (k: string, v?: Record<string, string | number>) => string, r?: FieldRow, num?: (n: number) => string): string {
  if (s === "lower") return t("Indexul este mai mic decât cel anterior.");
  if (s === "far") return t("Citit departe de locația anterioară");
  const base = s === "high" ? t("Consum neobișnuit de mare.") : t("Consum neobișnuit de mic față de medie.");
  const pct = r && r.avg != null && r.consum != null ? deviationPct(r.consum, r.avg) : null;
  return pct != null && r?.avg != null && num ? `${base} ${t("{p}% față de media lunară ({a} m³)", { p: `${pct > 0 ? "+" : ""}${pct}`, a: num(r.avg) })}` : base;
}


function Dash() {
  return <span className="text-ink-soft/60">—</span>;
}




/** Fereastra de citire a unui contor: formularul de citire într-un pop-up (de jos pe telefon, centrat pe ecran mare). */
function ReadingDialog({
  row,
  canViewMeter,
  onClose,
  onSaved,
  onNext,
  onIssue,
  onDelete,
  deleting,
  readOnly,
  periodLabel,
}: {
  row: FieldRow;
  /** Luna afișată e una anterioară: fără formular de citire (citirile se fac doar pe luna curentă). */
  readOnly: boolean;
  periodLabel: string;
  /** Șterge citirea lunii (doar cine are dreptul și doar dacă există o citire salvată). */
  onDelete?: () => void;
  deleting: boolean;
  onIssue: (kind: string) => void;
  canViewMeter: boolean;
  onClose: () => void;
  onSaved: (id: string, patch: { value?: number; readAt?: number; photo?: boolean }, by?: string | null, distanceM?: number | null, geo?: boolean, loc?: MeterLocationDto, avg?: number | null) => void;
  onNext: () => void;
}) {
  const t = useT();
  const locale = useLocale();
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
                {t("Citit de")} {row.by}{row.portal ? ` · ${t("Trimisă de plătitor din portal")}` : ""}
                {row.distanceM != null && row.distanceM > FAR_METERS ? ` · ⚠ ${t("Citit departe de locația anterioară")} (${row.distanceM} m)` : ""}
                {(() => {
                  const s = fieldSuspect(row);
                  return s === "high" || s === "low" ? ` · ⚠ ${suspectLabel(s, t, row, (n) => n.toLocaleString(dateTag(locale), { maximumFractionDigits: 3 }))}` : "";
                })()}
              </p>
            )}
          </div>
          <button onClick={onClose} className="tap grid size-9 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>
            <IconX className="size-4" />
          </button>
        </div>
        {readOnly ? (
          <div className="rounded-xl border border-[var(--color-line)] p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{periodLabel}</p>
            {row.value != null ? (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                <dt className="text-ink-soft">{t("Index")}</dt>
                <dd className="font-mono font-semibold">{row.value.toLocaleString(dateTag(locale), { maximumFractionDigits: 3 })} m³</dd>
                {row.readAt != null && (<><dt className="text-ink-soft">{t("Citit la")}</dt><dd>{new Date(row.readAt).toLocaleString(dateTag(locale))}</dd></>)}
                {row.by && (<><dt className="text-ink-soft">{t("Citit de")}</dt><dd>{row.by}{row.portal ? ` · ${t("Trimisă de plătitor din portal")}` : ""}</dd></>)}
                {row.consum != null && (<><dt className="text-ink-soft">{t("Consum")}</dt><dd>{row.consum.toLocaleString(dateTag(locale), { maximumFractionDigits: 3 })} m³</dd></>)}
                <dt className="text-ink-soft">{t("Poză")}</dt>
                <dd>{row.photo ? t("da") : "—"}</dd>
              </dl>
            ) : (
              <p className="mt-2 text-ink-soft">{t("Nicio citire în această lună.")}</p>
            )}
          </div>
        ) : (
        <ReadingForm
          meterId={row.id}
          contor={row.contor}
          meterName={row.name}
          address={row.address}
          addressEditable={!row.address || row.addrField}
          meterLat={row.lat}
          meterLng={row.lng}
          meterAcc={row.locAcc}
          lastIndex={row.lastIndex}
          lastDate={row.lastDate}
          lastEstimated={row.estimated}
          initialValue={row.value}
          onSaved={(patch, reading, loc) => onSaved(row.id, patch, reading.userName, reading.distanceM, reading.lat != null && reading.lng != null, loc, reading.avgConsum)}
          onNext={onNext}
          onClose={onClose}
          openIssue={row.issue}
          onIssue={onIssue}
          auto={row.auto}
        />
        )}
        {onDelete && (
          <button type="button" onClick={onDelete} disabled={deleting} className="tap mt-3 h-9 w-full cursor-pointer rounded-xl border border-st-cancelled/50 text-sm font-medium text-st-cancelled hover:bg-st-cancelled/10 disabled:opacity-50">
            🗑 {deleting ? "…" : t("Șterge citirea")}
          </button>
        )}
        {canViewMeter && (
          <Link href={`/contoare/${encodeURIComponent(row.id)}`} className="mt-3 block text-center text-xs text-brand underline">
            {t("Pagina contorului →")}
          </Link>
        )}
      </div>
    </div>
  );
}




/** Mod telefon: cardul unui contor (mare, ușor de atins în teren). */
function FieldCard({ r, onOpen }: { r: FieldRow; onOpen: (r: FieldRow) => void }) {
  const t = useT();
  const { num, dt } = getFmt(dateTag(useLocale()));
  const sus = r.value != null ? fieldSuspect(r) : null;
  return (
    <button
      type="button"
      onClick={() => onOpen(r)}
      className={`tap flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${r.pending === "wait" ? "border-st-progress/50 bg-st-progress/10" : r.pending === "error" ? "border-st-cancelled/50 bg-st-cancelled/5" : r.value != null ? "border-st-done/40 bg-st-done/5" : "border-[var(--color-line)] bg-[var(--color-surface)] hover:bg-brand-soft/40"}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[15px] font-bold">{r.issue && isIssueKind(r.issue) && <span className={`mr-1 ${SERIOUS_ISSUES.includes(r.issue) ? "text-st-cancelled" : "text-st-progress"}`} title={t(ISSUE_LABELS[r.issue])}>⚑</span>}{r.contor}</span>
        <span className="block truncate text-[13px]">{r.address ?? "—"}</span>
        <span className="block truncate text-[11px] text-ink-soft">{r.name}</span>
      </span>
      <span className="shrink-0 text-right text-[12px]">
        {r.value != null ? (
          <>
            <span className={`block text-base font-bold tabular-nums ${r.pending === "wait" ? "text-st-progress" : r.pending === "error" ? "text-st-cancelled" : "text-st-done"}`}>{r.pending === "wait" ? "⏳" : r.pending === "error" ? "⚠" : "✓"} {num(r.value)} m³</span>
            <span className={`block ${sus ? "font-semibold text-st-cancelled" : "text-ink-soft"}`}>
              {sus ? `⚠ ${r.consum != null ? `${num(r.consum)} m³ · ` : ""}` : r.consum != null ? `+${num(r.consum)} m³ · ` : ""}
              {r.readAt ? dt(r.readAt) : ""}
              {r.photo ? " · 📷" : ""}
            </span>
          </>
        ) : (
          <>
            <span className="block text-ink-soft">{t("Anterior")}</span>
            <span className="block font-semibold tabular-nums" title={r.estimated ? t("Index estimat (calculat), nu citit — merită citit și verificat") : undefined}>{r.lastIndex != null ? `${r.estimated ? "≈ " : ""}${num(r.lastIndex)} m³` : "—"}</span>
          </>
        )}
      </span>
    </button>
  );
}
