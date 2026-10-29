"use client";

import Link from "next/link";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { deleteRouteAction, moveRouteAction, resolveIssueAction, saveRouteAction } from "@/app/actions/meter-routes";
import { ISSUE_KINDS, ISSUE_LABELS, SERIOUS_ISSUES, type IssueDto, type IssueKind } from "@/lib/meter-issues";
import type { ReaderStat, RouteDto, RouteOptions, RouteStat, RoutesBundle, WindowState } from "@/lib/meter-routes";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { useToast } from "./toast";
import DateFilterInput from "./DateFilterInput";

type Tab = "report" | "routes" | "issues";
type Tr = (k: string, v?: Record<string, string | number>) => string;
type Dir = "asc" | "desc";
type Sort = { key: string; dir: Dir };

const inputCls = "h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 text-sm outline-none focus:border-brand";
const btn = "tap inline-flex h-8 cursor-pointer items-center rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-50";
const btnPrimary = "tap inline-flex h-9 cursor-pointer items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50";
const th = "px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-soft";
const td = "px-2.5 py-2";
const fld = (on: boolean) => `h-8 rounded-lg border px-2 text-xs outline-none focus:border-brand ${on ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`;

const MONTHS_RO = ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"];
const STATE_RANK: Record<WindowState, number> = { before: 0, open: 1, late: 2 };
const POLL_MS = 60_000;
const ISSUE_PAGE = 100;

const stateLabel = (s: WindowState, t: Tr) => (s === "before" ? t("încă nu a început") : s === "open" ? t("în desfășurare") : t("termen depășit"));
const stateCls = (s: WindowState) => (s === "before" ? "text-ink-soft" : s === "open" ? "text-st-progress" : "text-st-cancelled");
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// ── memorie locală: filtrele rămân pe dispozitiv (se păstrează la reîncărcare) ──────────────────────────────────────
function usePersisted<T>(key: string, initial: T): [T, (v: T | ((c: T) => T)) => void] {
  const [v, setV] = useState<T>(initial);
  const ready = useRef(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setV({ ...initial, ...(JSON.parse(raw) as T) });
    } catch {}
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (!ready.current) return;
    try { localStorage.setItem(key, JSON.stringify(v)); } catch {}
  }, [key, v]);
  return [v, setV];
}

/** Pachetul paginii: pornește de la ce a calculat serverul la deschidere; apoi se reîmprospătează la 60 s (cerere condiționată, 304 dacă nu s-a schimbat nimic) și la „Reîmprospătează” / după modificări — fără să reia pagina. */
function useRoutesBundle(initial: RoutesBundle) {
  const [data, setData] = useState(initial);
  const [loading, setLoading] = useState(false);
  const etag = useRef<string | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(async (fresh = false) => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/rute-citiri${fresh ? "?fresh=1" : ""}`, { headers: !fresh && etag.current ? { "If-None-Match": etag.current } : undefined, cache: "no-store" });
        if (res.status === 304) return;
        if (!res.ok) return;
        etag.current = res.headers.get("etag");
        setData((await res.json()) as RoutesBundle);
      } catch {
        /* rămân datele afișate */
      } finally {
        setLoading(false);
        inflight.current = null;
      }
    })();
    inflight.current = p;
    return p;
  }, []);
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") void refresh(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [refresh]);
  return { data, loading, refresh };
}

function Bar({ read, planned, due }: { read: number; planned: number; due?: number }) {
  const pct = planned ? Math.min(100, Math.round((read / planned) * 100)) : 0;
  const duePct = planned && due != null ? Math.min(100, Math.round((due / planned) * 100)) : null;
  return (
    <div className="flex min-w-[110px] items-center gap-2">
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div className={`h-full rounded-full ${planned && read >= planned ? "bg-st-done" : "bg-brand"}`} style={{ width: `${pct}%` }} />
        {duePct != null && duePct > 0 && duePct < 100 && <div className="absolute top-0 h-full w-0.5 bg-ink/60" style={{ left: `${duePct}%` }} title="plan" />}
      </div>
      <span className="w-9 text-right text-xs tabular-nums">{pct}%</span>
    </div>
  );
}

function SortTh({ label, k, sort, onSort, right }: { label: string; k: string; sort: Sort; onSort: (s: Sort) => void; right?: boolean }) {
  const on = sort.key === k;
  return (
    <th className={`${th} ${right ? "text-right" : ""}`} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort({ key: k, dir: on && sort.dir === "asc" ? "desc" : "asc" })} className={`cursor-pointer uppercase tracking-wide hover:text-brand ${on ? "text-brand" : ""}`}>
        {label}{on ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
      </button>
    </th>
  );
}

function cmp<T>(a: T, b: T, get: (x: T) => number | string | null, dir: Dir): number {
  const x = get(a), y = get(b);
  // lipsa valorii (null) ajunge la sfârșit, indiferent de direcție
  if (x == null && y == null) return 0;
  if (x == null) return 1;
  if (y == null) return -1;
  const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ro", { numeric: true });
  return dir === "asc" ? r : -r;
}

export default function ReadingRoutesClient({ initial }: { initial: RoutesBundle }) {
  const t = useT();
  const tag = dateTag(useLocale());
  const { data, loading, refresh } = useRoutesBundle(initial);
  const { report, routes, issues, users } = data;
  const [tab, setTab] = useState<Tab>("report");
  const openIssues = issues.filter((i) => !i.resolvedAt).length;
  const tabs: { k: Tab; label: string; badge?: number }[] = [
    { k: "report", label: t("Planificat vs citit") },
    { k: "routes", label: t("Rute"), badge: routes.length },
    { k: "issues", label: t("Nereguli contoare"), badge: openIssues },
  ];
  const [month, year] = [Number(report.period.slice(5)) - 1, report.period.slice(0, 4)];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div role="tablist" className="flex overflow-hidden rounded-lg border border-[var(--color-line)] text-sm">
          {tabs.map((x) => (
            <button
              key={x.k}
              type="button"
              role="tab"
              aria-selected={tab === x.k}
              onClick={() => setTab(x.k)}
              className={`tap h-9 px-4 font-medium ${tab === x.k ? "bg-brand text-white" : "bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
            >
              {x.label}
              {x.badge ? <span className={`ml-1.5 rounded-full px-1.5 text-[11px] ${tab === x.k ? "bg-white/25" : "bg-[var(--color-surface-2)]"}`}>{x.badge}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-ink-soft">
          <span>
            {t(MONTHS_RO[month] ?? "")} {year} · {t("ziua {d} din {n}", { d: report.day, n: report.daysInMonth })}
          </span>
          <button type="button" className={btn} disabled={loading} onClick={() => void refresh(true)}>↻ {loading ? t("Se încarcă…") : t("Reîmprospătează")}</button>
        </div>
      </div>
      {tab === "report" && <ReportTab data={data} tag={tag} />}
      {tab === "routes" && <RoutesTab data={data} onChanged={() => refresh(true)} />}
      {tab === "issues" && <IssuesTab issues={issues} users={users} tag={tag} onChanged={() => refresh(true)} />}
    </div>
  );
}

// ── Planificat vs citit ───────────────────────────────────────────────────────────────────────────────────────────

type ReportF = { q: string; reader: string; state: "" | WindowState; progress: "" | "lt25" | "lt50" | "lt75" | "lt100" | "done"; unread: boolean; behind: boolean; issues: boolean };
const EMPTY_REPORT_F: ReportF = { q: "", reader: "", state: "", progress: "", unread: false, behind: false, issues: false };
const reportActive = (f: ReportF) => (f.q ? 1 : 0) + (f.reader ? 1 : 0) + (f.state ? 1 : 0) + (f.progress ? 1 : 0) + (f.unread ? 1 : 0) + (f.behind ? 1 : 0) + (f.issues ? 1 : 0);

function ReportTab({ data, tag }: { data: RoutesBundle; tag: string }) {
  const t = useT();
  const { report, users } = data;
  const nf = (n: number) => n.toLocaleString(tag);
  const [f, setF] = usePersisted<ReportF>("rr-report-f-v1", EMPTY_REPORT_F);
  const [routeSort, setRouteSort] = usePersisted<Sort>("rr-route-sort-v1", { key: "name", dir: "asc" });
  const [readerSort, setReaderSort] = usePersisted<Sort>("rr-reader-sort-v1", { key: "name", dir: "asc" });
  const dq = useDeferredValue(f.q);
  const tm = (ms: number | null) => (ms == null ? "—" : new Date(ms).toLocaleString(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));

  const pctR = (r: RouteStat) => (r.planned ? (r.readByReader + r.readByOthers) / r.planned : null);
  const behindR = (r: RouteStat) => r.dueToday > 0 && r.readByReader + r.readByOthers < r.dueToday;

  const routes = useMemo(() => {
    const q = norm(dq).split(/\s+/).filter(Boolean);
    const out = report.routes.filter((r) => {
      if (q.length && !q.every((w) => norm(`${r.name} ${r.readerName ?? ""}`).includes(w))) return false;
      if (f.reader === "none" ? r.readerId : f.reader ? r.readerId !== f.reader : false) return false;
      if (f.state && r.state !== f.state) return false;
      const p = pctR(r);
      if (f.progress === "done" ? !(r.planned > 0 && r.unread <= 0) : f.progress ? !(p != null && p < Number(f.progress.slice(2)) / 100) : false) return false;
      if (f.unread && r.unread <= 0) return false;
      if (f.behind && !behindR(r)) return false;
      if (f.issues && r.issues <= 0) return false;
      return true;
    });
    const get: Record<string, (r: RouteStat) => number | string | null> = {
      name: (r) => r.name, reader: (r) => r.readerName, state: (r) => STATE_RANK[r.state], planned: (r) => r.planned, read: (r) => r.readByReader + r.readByOthers,
      unread: (r) => r.unread, pct: (r) => pctR(r), issues: (r) => r.issues, lastAt: (r) => r.lastAt, window: (r) => r.startDay,
    };
    return [...out].sort((a, b) => cmp(a, b, get[routeSort.key] ?? get.name, routeSort.dir));
  }, [report.routes, dq, f, routeSort]);

  const readers = useMemo(() => {
    const q = norm(dq).split(/\s+/).filter(Boolean);
    const out = report.readers.filter((r) => {
      if (q.length && !q.every((w) => norm(r.readerId ? r.readerName : t("Fără cititor")).includes(w))) return false;
      if (f.reader === "none" ? r.readerId : f.reader ? r.readerId !== f.reader : false) return false;
      if (f.unread && r.unread <= 0) return false;
      if (f.behind && !(r.dueToday > 0 && r.readByReader < r.dueToday)) return false;
      return true;
    });
    const pct = (r: ReaderStat) => (r.planned ? (r.readByReader + r.readByOthers) / r.planned : null);
    const get: Record<string, (r: ReaderStat) => number | string | null> = {
      name: (r) => (r.readerId ? r.readerName : "￿"), routes: (r) => r.routes, planned: (r) => r.planned, byReader: (r) => r.readByReader, byOthers: (r) => r.readByOthers,
      unread: (r) => r.unread, pct, elsewhere: (r) => r.readElsewhere, lastAt: (r) => r.lastAt,
    };
    return [...out].sort((a, b) => cmp(a, b, get[readerSort.key] ?? get.name, readerSort.dir));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.readers, dq, f, readerSort]);

  // totaluri pe rutele filtrate
  const planned = routes.reduce((s, r) => s + r.planned, 0);
  const read = routes.reduce((s, r) => s + r.readByReader + r.readByOthers, 0);
  const due = routes.reduce((s, r) => s + r.dueToday, 0);
  const late = routes.filter((r) => r.state === "late").reduce((s, r) => s + r.unread, 0);
  const nActive = reportActive(f);
  const readerOptions = useMemo(() => users.filter((u) => report.routes.some((r) => r.readerId === u.id) || report.readers.some((r) => r.readerId === u.id)), [users, report]);

  function exportCsv() {
    const esc = (v: string | number | null | undefined) => {
      const s = v == null ? "" : String(v);
      return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      [t("Cititor"), t("Rute"), t("Planificat"), t("Citite de el"), t("Citite de alții"), t("Rămase"), t("Ar fi trebuit până azi"), t("Citite în afara rutelor"), t("Prima citire"), t("Ultima citire")].map(esc).join(";"),
      ...readers.map((r) => [r.readerName || t("Fără cititor"), r.routes, r.planned, r.readByReader, r.readByOthers, r.unread, r.dueToday, r.readElsewhere, tm(r.firstAt), tm(r.lastAt)].map(esc).join(";")),
      "",
      [t("Rută"), t("Cititor"), t("Fereastra (zile)"), t("Stare"), t("Planificat"), t("Citite de cititor"), t("Citite de alții"), t("Rămase"), t("Nereguli"), t("Ultima citire")].map(esc).join(";"),
      ...routes.map((r) => [r.name, r.readerName ?? t("Fără cititor"), `${r.startDay}–${r.endDay}`, stateLabel(r.state, t), r.planned, r.readByReader, r.readByOthers, r.unread, r.issues, tm(r.lastAt)].map(esc).join(";")),
    ];
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `planificat-vs-citit-${report.period}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  if (report.routes.length === 0) {
    return <div className="card p-6 text-center text-sm text-ink-soft">{t("Nu există rute active. Creează prima rută în fila „Rute” ca să vezi comparația planificat / citit.")}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={t("Caută rută sau cititor…")} aria-label={t("Caută rută sau cititor…")} className={`min-w-44 flex-1 px-2.5 ${fld(!!f.q)}`} />
        <select value={f.reader} onChange={(e) => setF({ ...f, reader: e.target.value })} className={fld(!!f.reader)} aria-label={t("Cititor")}>
          <option value="">{t("Cititor: toți")}</option>
          <option value="none">{t("Fără cititor")}</option>
          {readerOptions.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value as ReportF["state"] })} className={fld(!!f.state)} aria-label={t("Stare")}>
          <option value="">{t("Stare: toate")}</option>
          <option value="before">{t("încă nu a început")}</option>
          <option value="open">{t("în desfășurare")}</option>
          <option value="late">{t("termen depășit")}</option>
        </select>
        <select value={f.progress} onChange={(e) => setF({ ...f, progress: e.target.value as ReportF["progress"] })} className={fld(!!f.progress)} aria-label={t("Progres")}>
          <option value="">{t("Progres: toate")}</option>
          <option value="lt25">{t("sub 25%")}</option>
          <option value="lt50">{t("sub 50%")}</option>
          <option value="lt75">{t("sub 75%")}</option>
          <option value="lt100">{t("sub 100% (neterminate)")}</option>
          <option value="done">{t("terminate (100%)")}</option>
        </select>
        {([["unread", "Cu contoare rămase"], ["behind", "În urma planului"], ["issues", "Cu nereguli"]] as const).map(([k, label]) => (
          <label key={k} className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs ${f[k] ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)]"}`}>
            <input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} className="size-3.5 accent-[var(--color-brand)]" />
            {t(label)}
          </label>
        ))}
        {nActive > 0 && <button type="button" className={btn} onClick={() => setF(EMPTY_REPORT_F)}>{t("Resetează filtrele")} ({nActive})</button>}
        <span className="text-[11px] text-ink-soft">{t("{n} din {total} rute", { n: routes.length, total: report.routes.length })}</span>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("Planificate (pe rute)")} value={nf(planned)} />
        <Stat label={t("Citite")} value={`${nf(read)} · ${planned ? Math.round((read / planned) * 100) : 0}%`} tone={read >= due ? "ok" : "warn"} sub={t("până azi ar fi trebuit {n}", { n: nf(due) })} />
        <Stat label={t("Necitite după termen")} value={nf(late)} tone={late > 0 ? "bad" : "ok"} />
        <Stat label={t("Contoare fără rută")} value={nf(report.noRoute.total)} sub={report.noRoute.read ? t("{n} citite", { n: nf(report.noRoute.read) }) : undefined} tone={report.noRoute.total > 0 ? "warn" : "ok"} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-2">
          <h2 className="text-sm font-semibold">{t("Pe cititor")} <span className="font-normal text-ink-soft">({readers.length})</span></h2>
          <button type="button" className={btn} onClick={exportCsv}>⬇ {t("Export CSV")}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <SortTh label={t("Cititor")} k="name" sort={readerSort} onSort={setReaderSort} />
                <SortTh label={t("Rute")} k="routes" sort={readerSort} onSort={setReaderSort} right />
                <SortTh label={t("Planificat")} k="planned" sort={readerSort} onSort={setReaderSort} right />
                <SortTh label={t("Citite de el")} k="byReader" sort={readerSort} onSort={setReaderSort} right />
                <SortTh label={t("Citite de alții")} k="byOthers" sort={readerSort} onSort={setReaderSort} right />
                <SortTh label={t("Rămase")} k="unread" sort={readerSort} onSort={setReaderSort} right />
                <SortTh label={t("Progres față de plan")} k="pct" sort={readerSort} onSort={setReaderSort} />
                <SortTh label={t("În afara rutelor")} k="elsewhere" sort={readerSort} onSort={setReaderSort} right />
                <SortTh label={t("Prima / ultima citire")} k="lastAt" sort={readerSort} onSort={setReaderSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {readers.map((r) => (
                <ReaderRow key={r.readerId ?? "none"} r={r} tm={tm} nf={nf} />
              ))}
              {readers.length === 0 && <tr><td colSpan={9} className="p-4 text-center text-xs text-ink-soft">{t("Niciun cititor pentru aceste filtre.")}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <h2 className="border-b border-[var(--color-line)] px-3 py-2 text-sm font-semibold">{t("Pe rută")} <span className="font-normal text-ink-soft">({routes.length})</span></h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <SortTh label={t("Rută")} k="name" sort={routeSort} onSort={setRouteSort} />
                <SortTh label={t("Cititor")} k="reader" sort={routeSort} onSort={setRouteSort} />
                <SortTh label={t("Fereastra")} k="window" sort={routeSort} onSort={setRouteSort} />
                <SortTh label={t("Stare")} k="state" sort={routeSort} onSort={setRouteSort} />
                <SortTh label={t("Planificat")} k="planned" sort={routeSort} onSort={setRouteSort} right />
                <SortTh label={t("Citite")} k="read" sort={routeSort} onSort={setRouteSort} right />
                <SortTh label={t("Rămase")} k="unread" sort={routeSort} onSort={setRouteSort} right />
                <SortTh label={t("Progres")} k="pct" sort={routeSort} onSort={setRouteSort} />
                <SortTh label={t("Nereguli")} k="issues" sort={routeSort} onSort={setRouteSort} right />
                <SortTh label={t("Ultima citire")} k="lastAt" sort={routeSort} onSort={setRouteSort} />
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {routes.map((r) => (
                <RouteRow key={r.routeId} r={r} nf={nf} tm={tm} />
              ))}
              {routes.length === 0 && <tr><td colSpan={11} className="p-4 text-center text-xs text-ink-soft">{t("Nicio rută pentru aceste filtre.")}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="border-t border-[var(--color-line)] px-3 py-2 text-[11px] text-ink-soft">
          {t("Linia verticală din bară = cât ar fi trebuit citit până azi dacă se citește uniform în fereastra rutei. Un contor aparține primei rute (în ordinea din fila „Rute”) ale cărei reguli i se potrivesc.")}
        </p>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "ok" | "warn" | "bad" }) {
  const cls = tone === "bad" ? "text-st-cancelled" : tone === "warn" ? "text-st-progress" : "";
  return (
    <div className="card px-3 py-2">
      <p className="text-[11px] text-ink-soft">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${cls}`}>{value}</p>
      {sub && <p className="text-[11px] text-ink-soft">{sub}</p>}
    </div>
  );
}

function ReaderRow({ r, tm, nf }: { r: ReaderStat; tm: (ms: number | null) => string; nf: (n: number) => string }) {
  const t = useT();
  const read = r.readByReader;
  const behind = r.dueToday > 0 && read < r.dueToday;
  return (
    <tr className={behind ? "bg-st-progress/5" : ""}>
      <td className={`${td} font-medium`}>{r.readerId ? r.readerName : <span className="text-ink-soft">{t("Fără cititor")}</span>}</td>
      <td className={`${td} text-right tabular-nums`}>{r.routes || "—"}</td>
      <td className={`${td} text-right tabular-nums`}>{nf(r.planned)}</td>
      <td className={`${td} text-right font-semibold tabular-nums`}>{nf(r.readByReader)}</td>
      <td className={`${td} text-right tabular-nums text-ink-soft`}>{nf(r.readByOthers)}</td>
      <td className={`${td} text-right tabular-nums ${r.unread > 0 && behind ? "font-semibold text-st-cancelled" : ""}`}>{nf(r.unread)}</td>
      <td className={td}>{r.planned ? <Bar read={r.readByReader + r.readByOthers} planned={r.planned} due={r.dueToday} /> : <span className="text-ink-soft">—</span>}</td>
      <td className={`${td} text-right tabular-nums text-ink-soft`}>{r.readElsewhere ? nf(r.readElsewhere) : "—"}</td>
      <td className={`${td} whitespace-nowrap text-xs text-ink-soft`}>{r.firstAt ? `${tm(r.firstAt)} → ${tm(r.lastAt)}` : "—"}</td>
    </tr>
  );
}

function RouteRow({ r, nf, tm }: { r: RouteStat; nf: (n: number) => string; tm: (ms: number | null) => string }) {
  const t = useT();
  const read = r.readByReader + r.readByOthers;
  const late = r.state === "late" && r.unread > 0;
  return (
    <tr className={late ? "bg-st-cancelled/5" : r.state === "open" && read < r.dueToday ? "bg-st-progress/5" : ""}>
      <td className={`${td} font-medium`}>{r.name}</td>
      <td className={td}>{r.readerName ?? <span className="text-ink-soft">{t("Fără cititor")}</span>}</td>
      <td className={`${td} whitespace-nowrap tabular-nums`}>{t("zilele {a}–{b}", { a: r.startDay, b: r.endDay })}</td>
      <td className={`${td} text-xs font-medium ${stateCls(r.state)}`}>{stateLabel(r.state, t)}</td>
      <td className={`${td} text-right tabular-nums`}>{nf(r.planned)}</td>
      <td className={`${td} text-right tabular-nums`}>
        <b>{nf(read)}</b>
        {r.readByOthers > 0 && <span className="block text-[11px] text-ink-soft">{t("din care de alții: {n}", { n: nf(r.readByOthers) })}</span>}
      </td>
      <td className={`${td} text-right tabular-nums ${late ? "font-semibold text-st-cancelled" : ""}`}>{nf(r.unread)}</td>
      <td className={td}><Bar read={read} planned={r.planned} due={r.dueToday} /></td>
      <td className={`${td} text-right tabular-nums ${r.issues ? "font-semibold text-st-cancelled" : "text-ink-soft"}`}>{r.issues ? `⚑ ${r.issues}` : "—"}</td>
      <td className={`${td} whitespace-nowrap text-xs text-ink-soft`}>{tm(r.lastAt)}</td>
      <td className={`${td} text-right`}>
        {r.unread > 0 && <Link href={`/contoare/citiri?route=${r.routeId}&status=unread`} className="text-xs font-medium text-brand hover:underline">🔎 {t("Necitite")}</Link>}
      </td>
    </tr>
  );
}

// ── Rute ──────────────────────────────────────────────────────────────────────────────────────────────────────────

type RoutesF = { q: string; reader: string; active: "" | "1" | "0"; state: "" | WindowState; sector: string; locality: string; min: string; max: string };
const EMPTY_ROUTES_F: RoutesF = { q: "", reader: "", active: "", state: "", sector: "", locality: "", min: "", max: "" };
const routesActive = (f: RoutesF) => (f.q ? 1 : 0) + (f.reader ? 1 : 0) + (f.active ? 1 : 0) + (f.state ? 1 : 0) + (f.sector ? 1 : 0) + (f.locality ? 1 : 0) + (f.min || f.max ? 1 : 0);

function RoutesTab({ data, onChanged }: { data: RoutesBundle; onChanged: () => Promise<void> }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const { routes, report, users } = data;
  const [editing, setEditing] = useState<RouteDto | "new" | null>(null);
  const [f, setF] = usePersisted<RoutesF>("rr-routes-f-v1", EMPTY_ROUTES_F);
  const [sort, setSort] = usePersisted<Sort>("rr-routes-sort-v1", { key: "order", dir: "asc" });
  const dq = useDeferredValue(f.q);
  const stat = useMemo(() => new Map(report.routes.map((r) => [r.routeId, r])), [report]);
  const userName = useCallback((id: string | null) => users.find((u) => u.id === id)?.name ?? null, [users]);
  const today = report.day;
  const stateOf = (r: RouteDto): WindowState => (today < r.startDay ? "before" : today <= r.endDay ? "open" : "late");

  const sectorOpts = useMemo(() => [...new Set(routes.flatMap((r) => r.sectors))].sort((a, b) => a.localeCompare(b, "ro", { numeric: true })), [routes]);
  const localityOpts = useMemo(() => [...new Set(routes.flatMap((r) => r.localities))].sort((a, b) => a.localeCompare(b, "ro")), [routes]);
  const readerOpts = useMemo(() => users.filter((u) => routes.some((r) => r.readerId === u.id)), [users, routes]);

  const shown = useMemo(() => {
    const q = norm(dq).split(/\s+/).filter(Boolean);
    const min = f.min === "" ? null : Number(f.min);
    const max = f.max === "" ? null : Number(f.max);
    const out = routes.filter((r) => {
      if (q.length) {
        const hay = norm(`${r.name} ${userName(r.readerId) ?? ""} ${r.sectors.join(" ")} ${r.localities.join(" ")} ${r.streets.join(" ")}`);
        if (!q.every((w) => hay.includes(w))) return false;
      }
      if (f.reader === "none" ? r.readerId : f.reader ? r.readerId !== f.reader : false) return false;
      if (f.active === "1" ? !r.active : f.active === "0" ? r.active : false) return false;
      if (f.state && !(r.active && stateOf(r) === f.state)) return false;
      if (f.sector && !r.sectors.includes(f.sector)) return false;
      if (f.locality && !r.localities.includes(f.locality)) return false;
      const planned = r.active ? stat.get(r.id)?.planned ?? 0 : 0;
      if (min != null && Number.isFinite(min) && planned < min) return false;
      if (max != null && Number.isFinite(max) && planned > max) return false;
      return true;
    });
    const get: Record<string, (r: RouteDto) => number | string | null> = {
      order: (r) => r.order, name: (r) => r.name, reader: (r) => userName(r.readerId), window: (r) => r.startDay, meters: (r) => (r.active ? stat.get(r.id)?.planned ?? 0 : null),
    };
    return [...out].sort((a, b) => cmp(a, b, get[sort.key] ?? get.order, sort.dir));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes, dq, f, sort, stat, userName, today]);

  const nActive = routesActive(f);
  // ordinea rutelor contează (prima rută potrivită câștigă): se mută doar în lista completă, în ordinea ei
  const reordering = nActive > 0 || sort.key !== "order" || sort.dir !== "asc";

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(t(r.error ?? "Nu am putut salva."));
      else {
        if (okMsg) toast.success(okMsg);
        await onChanged();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-3xl text-xs text-ink-soft">
          {t("O rută = un set de contoare (după datele din 1C: sectorul „Участок”, localitatea, strada), un cititor și fereastra din lună în care se citește. Un contor aparține primei rute din listă ale cărei reguli i se potrivesc — ordinea contează.")}
        </p>
        <button type="button" className={btnPrimary} onClick={() => setEditing("new")}>+ {t("Rută nouă")}</button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder={t("Caută în rute (nume, cititor, regulă)…")} aria-label={t("Caută în rute (nume, cititor, regulă)…")} className={`min-w-44 flex-1 px-2.5 ${fld(!!f.q)}`} />
        <select value={f.reader} onChange={(e) => setF({ ...f, reader: e.target.value })} className={fld(!!f.reader)} aria-label={t("Cititor")}>
          <option value="">{t("Cititor: toți")}</option>
          <option value="none">{t("Fără cititor")}</option>
          {readerOpts.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <select value={f.active} onChange={(e) => setF({ ...f, active: e.target.value as RoutesF["active"] })} className={fld(!!f.active)} aria-label={t("Activă")}>
          <option value="">{t("Active și inactive")}</option>
          <option value="1">{t("Doar active")}</option>
          <option value="0">{t("Doar inactive")}</option>
        </select>
        <select value={f.state} onChange={(e) => setF({ ...f, state: e.target.value as RoutesF["state"] })} className={fld(!!f.state)} aria-label={t("Stare")}>
          <option value="">{t("Fereastra: toate")}</option>
          <option value="before">{t("încă nu a început")}</option>
          <option value="open">{t("în desfășurare")}</option>
          <option value="late">{t("termen depășit")}</option>
        </select>
        {sectorOpts.length > 0 && (
          <select value={f.sector} onChange={(e) => setF({ ...f, sector: e.target.value })} className={fld(!!f.sector)} aria-label={t("Sector")}>
            <option value="">{t("Sector: toate")}</option>
            {sectorOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {localityOpts.length > 0 && (
          <select value={f.locality} onChange={(e) => setF({ ...f, locality: e.target.value })} className={fld(!!f.locality)} aria-label={t("Localitate")}>
            <option value="">{t("Localitate: toate")}</option>
            {localityOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <span className="flex items-center gap-1 text-[11px] text-ink-soft">
          {t("Contoare")}
          <input type="number" min={0} value={f.min} onChange={(e) => setF({ ...f, min: e.target.value })} placeholder={t("de la")} aria-label={t("Contoare de la")} className={`w-20 ${fld(!!f.min)}`} />
          –
          <input type="number" min={0} value={f.max} onChange={(e) => setF({ ...f, max: e.target.value })} placeholder={t("până la")} aria-label={t("Contoare până la")} className={`w-20 ${fld(!!f.max)}`} />
        </span>
        <select value={`${sort.key}:${sort.dir}`} onChange={(e) => { const [key, dir] = e.target.value.split(":"); setSort({ key, dir: dir as Dir }); }} className={fld(reordering && sort.key !== "order")} aria-label={t("Sortare")}>
          <option value="order:asc">{t("Ordinea rutelor")}</option>
          <option value="name:asc">{t("Nume A–Z")}</option>
          <option value="name:desc">{t("Nume Z–A")}</option>
          <option value="meters:desc">{t("Contoare: multe → puține")}</option>
          <option value="meters:asc">{t("Contoare: puține → multe")}</option>
          <option value="window:asc">{t("Fereastra: devreme → târziu")}</option>
        </select>
        {nActive > 0 && <button type="button" className={btn} onClick={() => setF(EMPTY_ROUTES_F)}>{t("Resetează filtrele")} ({nActive})</button>}
        <span className="text-[11px] text-ink-soft">{t("{n} din {total} rute", { n: shown.length, total: routes.length })}</span>
      </div>

      {routes.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-soft">{t("Nicio rută încă.")}</div>
      ) : shown.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-soft">{t("Nicio rută pentru aceste filtre.")}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <SortTh label="#" k="order" sort={sort} onSort={setSort} />
                <SortTh label={t("Rută")} k="name" sort={sort} onSort={setSort} />
                <th className={th}>{t("Reguli (1C)")}</th>
                <SortTh label={t("Cititor")} k="reader" sort={sort} onSort={setSort} />
                <SortTh label={t("Fereastra")} k="window" sort={sort} onSort={setSort} />
                <SortTh label={t("Contoare")} k="meters" sort={sort} onSort={setSort} right />
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {shown.map((r) => {
                const i = routes.findIndex((x) => x.id === r.id);
                return (
                  <tr key={r.id} className={r.active ? "" : "opacity-55"}>
                    <td className={`${td} tabular-nums text-ink-soft`}>{i + 1}</td>
                    <td className={`${td} font-medium`}>
                      {r.name}
                      {!r.active && <span className="ml-2 rounded bg-[var(--color-surface-2)] px-1.5 text-[11px] text-ink-soft">{t("inactivă")}</span>}
                    </td>
                    <td className={`${td} text-xs`}>
                      {r.sectors.length > 0 && <div><span className="text-ink-soft">{t("Sector")}:</span> {r.sectors.join(", ")}</div>}
                      {r.localities.length > 0 && <div><span className="text-ink-soft">{t("Localitate")}:</span> {r.localities.join(", ")}</div>}
                      {r.streets.length > 0 && <div><span className="text-ink-soft">{t("Stradă")}:</span> {r.streets.slice(0, 6).join(", ")}{r.streets.length > 6 ? ` +${r.streets.length - 6}` : ""}</div>}
                    </td>
                    <td className={td}>{userName(r.readerId) ?? <span className="text-ink-soft">—</span>}</td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{t("zilele {a}–{b}", { a: r.startDay, b: r.endDay })}</td>
                    <td className={`${td} text-right tabular-nums`}>{r.active ? (stat.get(r.id)?.planned ?? 0) : "—"}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <button type="button" className={btn} disabled={pending || reordering || i === 0} title={reordering ? t("Ordinea se schimbă doar în lista completă, nefiltrată") : undefined} onClick={() => run(() => moveRouteAction(r.id, "up"))} aria-label={t("Mută mai sus")}>↑</button>{" "}
                      <button type="button" className={btn} disabled={pending || reordering || i === routes.length - 1} title={reordering ? t("Ordinea se schimbă doar în lista completă, nefiltrată") : undefined} onClick={() => run(() => moveRouteAction(r.id, "down"))} aria-label={t("Mută mai jos")}>↓</button>{" "}
                      <button type="button" className={btn} onClick={() => setEditing(r)}>{t("Editează")}</button>{" "}
                      <button
                        type="button"
                        className={`${btn} text-st-cancelled`}
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(t("Ștergi ruta „{name}”? Contoarele ei vor deveni fără rută.", { name: r.name }))) run(() => deleteRouteAction(r.id), t("Ruta a fost ștearsă."));
                        }}
                      >
                        {t("Șterge")}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <RouteDialog
          route={editing === "new" ? null : editing}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void onChanged();
          }}
        />
      )}
    </div>
  );
}

/** Valorile pentru reguli (străzi, localități — mii) se cer abia la deschiderea ferestrei și se păstrează în pagină. */
let optionsMemo: { at: number; value: RouteOptions } | null = null;

function RouteDialog({ route, users, onClose, onSaved }: { route: RouteDto | null; users: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const [options, setOptions] = useState<RouteOptions | null>(optionsMemo && Date.now() - optionsMemo.at < 60_000 ? optionsMemo.value : null);
  useEffect(() => {
    if (options) return;
    let alive = true;
    fetch("/api/rute-citiri?part=options", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<RouteOptions>) : null))
      .then((o) => {
        if (!alive || !o) return;
        optionsMemo = { at: Date.now(), value: o };
        setOptions(o);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [options]);
  const [name, setName] = useState(route?.name ?? "");
  const [readerId, setReaderId] = useState(route?.readerId ?? "");
  const [startDay, setStartDay] = useState(String(route?.startDay ?? 1));
  const [endDay, setEndDay] = useState(String(route?.endDay ?? 28));
  const [active, setActive] = useState(route?.active ?? true);
  const [sectors, setSectors] = useState<string[]>(route?.sectors ?? []);
  const [localities, setLocalities] = useState<string[]>(route?.localities ?? []);
  const [streets, setStreets] = useState<string[]>(route?.streets ?? []);
  const [street, setStreet] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const addStreet = () => {
    const v = street.trim();
    if (v && !streets.some((s) => s.toLowerCase() === v.toLowerCase())) setStreets([...streets, v]);
    setStreet("");
  };

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      const pend = street.trim() ? [...streets, street.trim()] : streets;
      const r = await saveRouteAction({ id: route?.id, name, readerId: readerId || null, startDay: Number(startDay), endDay: Number(endDay), active, sectors, localities, streets: pend });
      if (!r.ok) {
        setErr(t(r.error));
        return;
      }
      toast.success(t("Ruta a fost salvată."));
      onSaved();
    } catch {
      setErr(t("Nu am putut salva."));
    } finally {
      setBusy(false);
    }
  }

  const checkList = (items: { value: string; count: number }[], sel: string[], set: (v: string[]) => void) => (
    <div className="max-h-40 overflow-auto rounded-lg border border-[var(--color-line)] p-1.5">
      {items.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-[var(--color-surface-2)]">
          <input type="checkbox" checked={sel.includes(o.value)} onChange={() => toggle(sel, set, o.value)} />
          <span className="min-w-0 flex-1 truncate">{o.value}</span>
          <span className="text-xs tabular-nums text-ink-soft">{o.count}</span>
        </label>
      ))}
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[94dvh] w-full max-w-xl overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <h2 className="mb-3 text-lg font-bold">{route ? t("Editează ruta") : t("Rută nouă")}</h2>
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-ink-soft">
            {t("Nume")}
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={`${inputCls} mt-1`} placeholder={t("ex. Cahul – Centru")} autoFocus />
          </label>
          <label className="block text-xs font-semibold text-ink-soft">
            {t("Cititor")}
            <select value={readerId} onChange={(e) => setReaderId(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">{t("— fără cititor —")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-semibold text-ink-soft">
              {t("Citește de la ziua")}
              <input type="number" min={1} max={31} value={startDay} onChange={(e) => setStartDay(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs font-semibold text-ink-soft">
              {t("până la ziua")}
              <input type="number" min={1} max={31} value={endDay} onChange={(e) => setEndDay(e.target.value)} className={`${inputCls} mt-1`} />
            </label>
          </div>

          <div>
            <p className="mb-1 text-xs font-semibold text-ink-soft">{t("Contoarele rutei (reguli din datele 1C; regulile diferite se combină cu „și”)")}</p>
            {!options ? (
              <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs text-ink-soft">{t("Se încarcă sectoarele, localitățile și străzile…")}</p>
            ) : (
              <>
                <p className="mb-1 mt-2 text-xs text-ink-soft">{t("Sector (Участок din 1C)")}</p>
                {options.sectors.length === 0 ? (
                  <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs text-ink-soft">{t("În 1C nu e completat sectorul („Участок”) pentru niciun abonat. Folosește localitatea și strada.")}</p>
                ) : (
                  checkList(options.sectors, sectors, setSectors)
                )}
                <p className="mb-1 mt-3 text-xs text-ink-soft">{t("Localitate (din adresa 1C)")}</p>
                {checkList(options.localities, localities, setLocalities)}
              </>
            )}
            <p className="mb-1 mt-3 text-xs text-ink-soft">{t("Stradă (fragment din adresă)")}</p>
            <div className="flex gap-2">
              <input
                value={street}
                onChange={(e) => setStreet(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addStreet();
                  }
                }}
                list="route-streets"
                className={inputCls}
                placeholder={t("ex. str. Independenței")}
                maxLength={120}
              />
              <datalist id="route-streets">
                {(options?.streets ?? []).map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
              <button type="button" className={btn} onClick={addStreet}>{t("Adaugă")}</button>
            </div>
            {streets.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {streets.map((s) => (
                  <span key={s} className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-xs font-medium text-brand">
                    {s}
                    <button type="button" aria-label={t("Șterge")} onClick={() => setStreets(streets.filter((x) => x !== s))} className="cursor-pointer text-sm leading-none">×</button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {t("Rută activă")}
          </label>
        </div>
        {err && <p className="mt-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={btn} onClick={onClose}>{t("Anulează")}</button>
          <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>{busy ? t("Se salvează…") : t("Salvează")}</button>
        </div>
      </div>
    </div>
  );
}

// ── Nereguli ──────────────────────────────────────────────────────────────────────────────────────────────────────

type IssuesF = { q: string; status: "open" | "resolved" | "all"; kind: "" | IssueKind; serious: boolean; by: string; from: string; to: string; sort: "new" | "old" | "contor" };
const EMPTY_ISSUES_F: IssuesF = { q: "", status: "open", kind: "", serious: false, by: "", from: "", to: "", sort: "new" };
const issuesActive = (f: IssuesF) => (f.q ? 1 : 0) + (f.status !== "open" ? 1 : 0) + (f.kind ? 1 : 0) + (f.serious ? 1 : 0) + (f.by ? 1 : 0) + (f.from || f.to ? 1 : 0) + (f.sort !== "new" ? 1 : 0);
const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Europe/Bucharest" });

function IssuesTab({ issues, users, tag, onChanged }: { issues: IssueDto[]; users: { id: string; name: string }[]; tag: string; onChanged: () => Promise<void> }) {
  const t = useT();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [f, setF] = usePersisted<IssuesF>("rr-issues-f-v1", EMPTY_ISSUES_F);
  const [limit, setLimit] = useState(ISSUE_PAGE);
  const dq = useDeferredValue(f.q);
  const dt = (iso: string) => new Date(iso).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" });
  void users;
  // cine a raportat (din nereguli, ca să apară doar numele care există în listă)
  const reporters = useMemo(() => [...new Set(issues.map((i) => i.userName).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ro")), [issues]);
  const kindsPresent = useMemo(() => ISSUE_KINDS.filter((k) => issues.some((i) => i.kind === k)), [issues]);

  const list = useMemo(() => {
    const q = norm(dq).split(/\s+/).filter(Boolean);
    const out = issues.filter((i) => {
      if (f.status === "open" ? i.resolvedAt : f.status === "resolved" ? !i.resolvedAt : false) return false;
      if (f.kind && i.kind !== f.kind) return false;
      if (f.serious && !SERIOUS_ISSUES.includes(i.kind)) return false;
      if (f.by && i.userName !== f.by) return false;
      const d = dayOf(i.reportedAt);
      if (f.from && d < f.from) return false;
      if (f.to && d > f.to) return false;
      if (q.length) {
        const hay = norm(`${i.contor} ${t(ISSUE_LABELS[i.kind])} ${i.note ?? ""} ${i.userName} ${i.resolvedNote ?? ""} ${i.resolvedName ?? ""}`);
        if (!q.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    return f.sort === "old" ? [...out].sort((a, b) => a.reportedAt.localeCompare(b.reportedAt)) : f.sort === "contor" ? [...out].sort((a, b) => a.contor.localeCompare(b.contor, "ro", { numeric: true })) : [...out].sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, dq, f]);
  const visible = list.slice(0, limit);
  const nActive = issuesActive(f);

  function resolve(i: IssueDto) {
    const note = window.prompt(t("Cum a fost rezolvată neregula? (opțional)"), "");
    if (note === null) return;
    start(async () => {
      const r = await resolveIssueAction(i.id, note);
      if (!r.ok) toast.error(t(r.error ?? "Nu am putut salva."));
      else {
        toast.success(t("Neregula a fost marcată ca rezolvată."));
        await onChanged();
      }
    });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <input value={f.q} onChange={(e) => { setF({ ...f, q: e.target.value }); setLimit(ISSUE_PAGE); }} placeholder={t("Caută (contor, observații, cine a raportat)…")} aria-label={t("Caută (contor, observații, cine a raportat)…")} className={`min-w-44 flex-1 px-2.5 ${fld(!!f.q)}`} />
        <select value={f.status} onChange={(e) => { setF({ ...f, status: e.target.value as IssuesF["status"] }); setLimit(ISSUE_PAGE); }} className={fld(f.status !== "open")} aria-label={t("Stare")}>
          <option value="open">{t("Deschise")}</option>
          <option value="resolved">{t("Rezolvate")}</option>
          <option value="all">{t("Toate")}</option>
        </select>
        <select value={f.kind} onChange={(e) => { setF({ ...f, kind: e.target.value as IssuesF["kind"] }); setLimit(ISSUE_PAGE); }} className={fld(!!f.kind)} aria-label={t("Neregulă")}>
          <option value="">{t("Neregulă: toate")}</option>
          {kindsPresent.map((k) => <option key={k} value={k}>{t(ISSUE_LABELS[k])}</option>)}
        </select>
        <select value={f.by} onChange={(e) => { setF({ ...f, by: e.target.value }); setLimit(ISSUE_PAGE); }} className={fld(!!f.by)} aria-label={t("Raportată de")}>
          <option value="">{t("Raportată de: toți")}</option>
          {reporters.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <DateFilterInput label={t("De la data")} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} className={fld(!!f.from)} aria-label={t("De la data")} />
        <DateFilterInput label={t("Până la data")} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} className={fld(!!f.to)} aria-label={t("Până la data")} />
        <label className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2 text-xs ${f.serious ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)]"}`}>
          <input type="checkbox" checked={f.serious} onChange={(e) => setF({ ...f, serious: e.target.checked })} className="size-3.5 accent-[var(--color-brand)]" />
          {t("Doar cele grave")}
        </label>
        <select value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value as IssuesF["sort"] })} className={fld(f.sort !== "new")} aria-label={t("Sortare")}>
          <option value="new">{t("Cele mai noi întâi")}</option>
          <option value="old">{t("Cele mai vechi întâi")}</option>
          <option value="contor">{t("După contor")}</option>
        </select>
        {nActive > 0 && <button type="button" className={btn} onClick={() => { setF(EMPTY_ISSUES_F); setLimit(ISSUE_PAGE); }}>{t("Resetează filtrele")} ({nActive})</button>}
        <span className="text-[11px] text-ink-soft">{t("{n} din {total} nereguli", { n: list.length, total: issues.length })}</span>
      </div>
      {list.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-soft">{nActive === 0 ? t("Nicio neregulă deschisă.") : t("Nicio neregulă pentru aceste filtre.")}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <th className={th}>{t("Contor")}</th>
                <th className={th}>{t("Neregulă")}</th>
                <th className={th}>{t("Observații")}</th>
                <th className={th}>{t("Raportată")}</th>
                <th className={th}>{t("Stare")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {visible.map((i) => (
                <tr key={i.id}>
                  <td className={`${td} font-mono font-medium`}>
                    <Link href={`/contoare/${encodeURIComponent(i.meterId)}`} className="text-brand hover:underline">{i.contor}</Link>
                  </td>
                  <td className={`${td} font-semibold ${SERIOUS_ISSUES.includes(i.kind) ? "text-st-cancelled" : "text-st-progress"}`}>⚑ {t(ISSUE_LABELS[i.kind])}</td>
                  <td className={`${td} max-w-xs text-[13px]`}>{i.note ?? <span className="text-ink-soft">—</span>}</td>
                  <td className={`${td} whitespace-nowrap text-xs text-ink-soft`}>{dt(i.reportedAt)}<span className="block">{i.userName}</span></td>
                  <td className={`${td} text-xs`}>
                    {i.resolvedAt ? (
                      <span className="text-st-done">✓ {dt(i.resolvedAt)}{i.resolvedName ? ` · ${i.resolvedName}` : ""}{i.resolvedNote ? ` — ${i.resolvedNote}` : ""}</span>
                    ) : (
                      <span className="font-medium text-st-cancelled">{t("deschisă")}</span>
                    )}
                  </td>
                  <td className={`${td} text-right`}>
                    {!i.resolvedAt && (
                      <button type="button" className={btn} disabled={pending} onClick={() => resolve(i)}>{t("Marchează rezolvată")}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > visible.length && (
            <div className="border-t border-[var(--color-line)] p-2 text-center">
              <button type="button" className={btn} onClick={() => setLimit((n) => n + ISSUE_PAGE)}>{t("Arată încă {n}", { n: Math.min(ISSUE_PAGE, list.length - visible.length) })}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
