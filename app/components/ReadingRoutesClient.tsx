"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { deleteRouteAction, moveRouteAction, resolveIssueAction, saveRouteAction } from "@/app/actions/meter-routes";
import { ISSUE_LABELS, SERIOUS_ISSUES, type IssueDto } from "@/lib/meter-issues";
import type { ReaderStat, RouteDto, RouteOptions, RouteReport, RouteStat, WindowState } from "@/lib/meter-routes";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { useToast } from "./toast";

type Tab = "report" | "routes" | "issues";
type Tr = (k: string, v?: Record<string, string | number>) => string;

const inputCls = "h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 text-sm outline-none focus:border-brand";
const btn = "tap inline-flex h-8 cursor-pointer items-center rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-50";
const btnPrimary = "tap inline-flex h-9 cursor-pointer items-center rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50";
const th = "px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-soft";
const td = "px-2.5 py-2";

const MONTHS_RO = ["Ianuarie", "Februarie", "Martie", "Aprilie", "Mai", "Iunie", "Iulie", "August", "Septembrie", "Octombrie", "Noiembrie", "Decembrie"];

const stateLabel = (s: WindowState, t: Tr) => (s === "before" ? t("încă nu a început") : s === "open" ? t("în desfășurare") : t("termen depășit"));
const stateCls = (s: WindowState) => (s === "before" ? "text-ink-soft" : s === "open" ? "text-st-progress" : "text-st-cancelled");

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

export default function ReadingRoutesClient({
  report,
  routes,
  options,
  issues,
  users,
}: {
  report: RouteReport;
  routes: RouteDto[];
  options: RouteOptions;
  issues: IssueDto[];
  users: { id: string; name: string }[];
}) {
  const t = useT();
  const tag = dateTag(useLocale());
  const router = useRouter();
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
          <button type="button" className={btn} onClick={() => router.refresh()}>↻ {t("Reîmprospătează")}</button>
        </div>
      </div>
      {tab === "report" && <ReportTab report={report} tag={tag} />}
      {tab === "routes" && <RoutesTab routes={routes} report={report} options={options} users={users} />}
      {tab === "issues" && <IssuesTab issues={issues} tag={tag} />}
    </div>
  );
}

// ── Planificat vs citit ───────────────────────────────────────────────────────────────────────────────────────────

function ReportTab({ report, tag }: { report: RouteReport; tag: string }) {
  const t = useT();
  const nf = (n: number) => n.toLocaleString(tag);
  const planned = report.routes.reduce((s, r) => s + r.planned, 0);
  const read = report.routes.reduce((s, r) => s + r.readByReader + r.readByOthers, 0);
  const due = report.routes.reduce((s, r) => s + r.dueToday, 0);
  const late = report.routes.filter((r) => r.state === "late").reduce((s, r) => s + r.unread, 0);
  const tm = (ms: number | null) => (ms == null ? "—" : new Date(ms).toLocaleString(tag, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }));

  function exportCsv() {
    const esc = (v: string | number | null | undefined) => {
      const s = v == null ? "" : String(v);
      return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      [t("Cititor"), t("Rute"), t("Planificat"), t("Citite de el"), t("Citite de alții"), t("Rămase"), t("Ar fi trebuit până azi"), t("Citite în afara rutelor"), t("Prima citire"), t("Ultima citire")].map(esc).join(";"),
      ...report.readers.map((r) => [r.readerName || t("Fără cititor"), r.routes, r.planned, r.readByReader, r.readByOthers, r.unread, r.dueToday, r.readElsewhere, tm(r.firstAt), tm(r.lastAt)].map(esc).join(";")),
      "",
      [t("Rută"), t("Cititor"), t("Fereastra (zile)"), t("Stare"), t("Planificat"), t("Citite de cititor"), t("Citite de alții"), t("Rămase"), t("Nereguli")].map(esc).join(";"),
      ...report.routes.map((r) => [r.name, r.readerName ?? t("Fără cititor"), `${r.startDay}–${r.endDay}`, stateLabel(r.state, t), r.planned, r.readByReader, r.readByOthers, r.unread, r.issues].map(esc).join(";")),
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
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={t("Planificate (pe rute)")} value={nf(planned)} />
        <Stat label={t("Citite")} value={`${nf(read)} · ${planned ? Math.round((read / planned) * 100) : 0}%`} tone={read >= due ? "ok" : "warn"} sub={t("până azi ar fi trebuit {n}", { n: nf(due) })} />
        <Stat label={t("Necitite după termen")} value={nf(late)} tone={late > 0 ? "bad" : "ok"} />
        <Stat label={t("Contoare fără rută")} value={nf(report.noRoute.total)} sub={report.noRoute.read ? t("{n} citite", { n: nf(report.noRoute.read) }) : undefined} tone={report.noRoute.total > 0 ? "warn" : "ok"} />
      </div>

      <div className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-[var(--color-line)] px-3 py-2">
          <h2 className="text-sm font-semibold">{t("Pe cititor")}</h2>
          <button type="button" className={btn} onClick={exportCsv}>⬇ {t("Export CSV")}</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <th className={th}>{t("Cititor")}</th>
                <th className={`${th} text-right`}>{t("Rute")}</th>
                <th className={`${th} text-right`}>{t("Planificat")}</th>
                <th className={`${th} text-right`}>{t("Citite de el")}</th>
                <th className={`${th} text-right`}>{t("Citite de alții")}</th>
                <th className={`${th} text-right`}>{t("Rămase")}</th>
                <th className={th}>{t("Progres față de plan")}</th>
                <th className={`${th} text-right`}>{t("În afara rutelor")}</th>
                <th className={th}>{t("Prima / ultima citire")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {report.readers.map((r) => (
                <ReaderRow key={r.readerId ?? "none"} r={r} tm={tm} nf={nf} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card overflow-hidden">
        <h2 className="border-b border-[var(--color-line)] px-3 py-2 text-sm font-semibold">{t("Pe rută")}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <th className={th}>{t("Rută")}</th>
                <th className={th}>{t("Cititor")}</th>
                <th className={th}>{t("Fereastra")}</th>
                <th className={th}>{t("Stare")}</th>
                <th className={`${th} text-right`}>{t("Planificat")}</th>
                <th className={`${th} text-right`}>{t("Citite")}</th>
                <th className={`${th} text-right`}>{t("Rămase")}</th>
                <th className={th}>{t("Progres")}</th>
                <th className={`${th} text-right`}>{t("Nereguli")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {report.routes.map((r) => (
                <RouteRow key={r.routeId} r={r} nf={nf} />
              ))}
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

function RouteRow({ r, nf }: { r: RouteStat; nf: (n: number) => string }) {
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
    </tr>
  );
}

// ── Rute ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function RoutesTab({ routes, report, options, users }: { routes: RouteDto[]; report: RouteReport; options: RouteOptions; users: { id: string; name: string }[] }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState<RouteDto | "new" | null>(null);
  const stat = useMemo(() => new Map(report.routes.map((r) => [r.routeId, r])), [report]);
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(t(r.error ?? "Nu am putut salva."));
      else {
        if (okMsg) toast.success(okMsg);
        router.refresh();
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
      {routes.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-soft">{t("Nicio rută încă.")}</div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[var(--color-line)]">
                <th className={th}>#</th>
                <th className={th}>{t("Rută")}</th>
                <th className={th}>{t("Reguli (1C)")}</th>
                <th className={th}>{t("Cititor")}</th>
                <th className={th}>{t("Fereastra")}</th>
                <th className={`${th} text-right`}>{t("Contoare")}</th>
                <th className={th} />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {routes.map((r, i) => (
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
                    <button type="button" className={btn} disabled={pending || i === 0} onClick={() => run(() => moveRouteAction(r.id, "up"))} aria-label={t("Mută mai sus")}>↑</button>{" "}
                    <button type="button" className={btn} disabled={pending || i === routes.length - 1} onClick={() => run(() => moveRouteAction(r.id, "down"))} aria-label={t("Mută mai jos")}>↓</button>{" "}
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
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <RouteDialog
          route={editing === "new" ? null : editing}
          options={options}
          users={users}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function RouteDialog({ route, options, users, onClose, onSaved }: { route: RouteDto | null; options: RouteOptions; users: { id: string; name: string }[]; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
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
            <p className="mb-1 mt-2 text-xs text-ink-soft">{t("Sector (Участок din 1C)")}</p>
            {options.sectors.length === 0 ? (
              <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs text-ink-soft">{t("În 1C nu e completat sectorul („Участок”) pentru niciun abonat. Folosește localitatea și strada.")}</p>
            ) : (
              checkList(options.sectors, sectors, setSectors)
            )}
            <p className="mb-1 mt-3 text-xs text-ink-soft">{t("Localitate (din adresa 1C)")}</p>
            {checkList(options.localities, localities, setLocalities)}
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
                {options.streets.map((s) => (
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

function IssuesTab({ issues, tag }: { issues: IssueDto[]; tag: string }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? issues : issues.filter((i) => !i.resolvedAt);
  const dt = (iso: string) => new Date(iso).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" });

  function resolve(i: IssueDto) {
    const note = window.prompt(t("Cum a fost rezolvată neregula? (opțional)"), "");
    if (note === null) return;
    start(async () => {
      const r = await resolveIssueAction(i.id, note);
      if (!r.ok) toast.error(t(r.error ?? "Nu am putut salva."));
      else {
        toast.success(t("Neregula a fost marcată ca rezolvată."));
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
        {t("Arată și cele rezolvate")}
      </label>
      {list.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-soft">{t("Nicio neregulă deschisă.")}</div>
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
              {list.map((i) => (
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
        </div>
      )}
    </div>
  );
}
