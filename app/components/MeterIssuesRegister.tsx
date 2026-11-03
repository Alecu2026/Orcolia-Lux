"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { resolveIssueAction } from "@/app/actions/meter-routes";
import { countActiveIssueFilters, countIssues, EMPTY_ISSUE_FILTERS, filterIssues, type IssueFilters, type IssueRow } from "@/lib/meter-issue-register";
import { ISSUE_LABELS, ISSUE_KINDS, SERIOUS_ISSUES, type IssueDto, type IssueRegisterRow } from "@/lib/meter-issues";
import { DEFAULT_PER_PAGE, NOTIFY_PER_PAGE, PER_PAGE_ALL, normalizePerPageClient, perPageLabel } from "@/lib/payer-notify";
import { ISSUES_PP_COOKIE } from "@/lib/payer-prefs";
import { useT } from "@/lib/i18n/context";
import { IconChevronLeft, IconChevronRight } from "./icons";
import { useToast } from "./toast";
import { useIssueDataset } from "./useIssueDataset";
import IssueEditDialog from "./IssueEditDialog";
import IssueMessagesDialog from "./IssueMessagesDialog";
import type { AutoNotifySettings } from "@/lib/auto-notify";
import type { IssueMessages } from "@/lib/issue-messages";

const ROW_H = 38;
const VIEW_H = 640; // înălțimea zonei derulabile a tabelului când rândurile sunt virtualizate
const VIRT_MIN = 60; // peste atâtea rânduri pe pagină se desenează doar cele vizibile
// Contor, Abonat, Tip, Responsabil, Secția, Termen de remediere, Stare, Rezolvat de, Raportat, Adresă, acțiuni
const COLS_HEAD = [104, 158, 150, 92, 112, 196, 92, 176, 88, 190];
/** Lățimea coloanei de acțiuni: butoanele stau pe un singur rând, deci coloana trebuie să le încapă (Editează 92 + Rezolvată 104 + Cerere 84 + spații). */
const actionsWidth = (edit: boolean, resolve: boolean, ticket: boolean) => {
  const w = [edit ? 76 : 0, resolve ? 84 : 0, ticket ? 68 : 0].filter(Boolean);
  return w.reduce((a, b) => a + b, 0) + Math.max(0, w.length - 1) * 4 + 12;
};

/** Butoanele din rândul neregulii: text pe un singur rând, aceeași înălțime, fără să se strângă (altfel textul trecea pe al doilea rând și ieșea din chenar). */
const ACT_BTN = "tap inline-flex h-6 shrink-0 cursor-pointer items-center gap-0.5 whitespace-nowrap rounded-md border bg-[var(--color-surface)] px-1.5 text-[10px] font-medium leading-none";

const fld = (active: string | boolean) =>
  `h-8 min-w-0 rounded-lg border px-2 text-xs outline-none focus:border-brand ${active ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"}`;

const dmy = (k: string | null | undefined) => (k ? k.slice(0, 10).split("-").reverse().join(".") : "");

/**
 * Registrul de nereguli de contor: o linie = o neregulă (deschisă sau rezolvată), cu cine remediază, secția responsabilă și termenul de remediere. Lista completă stă în
 * browser (descărcată condiționat, cu ETag), deci filtrele sunt instant; paginare cu „câte pe pagină” (20 … Toate) și rânduri virtualizate pe paginile mari.
 */
export default function MeterIssuesRegister({
  initialRows,
  initialFilters,
  initialPerPage,
  teams,
  canManage: canManageServer,
  canTicket = false,
  restricted: restrictedServer = false,
  ownTeamIds: ownTeamIdsServer = [],
  messages,
  autoNotify,
  canEditMessages,
  isSuper,
  emailEnabled,
  smsEnabled,
}: {
  initialRows: IssueRegisterRow[];
  initialFilters: IssueFilters;
  initialPerPage: number;
  teams: { id: string; name: string }[];
  canManage: boolean;
  /** Poate crea cereri (tichete): fiecare rând are butonul „+ Cerere” cu datele neregulii completate. */
  canTicket?: boolean;
  /** Vede doar neregulile secțiilor lui (`ownTeamIds`) — nu are „Plătitori – Vizualizare”; nu primește linkuri către fișele contoarelor / plătitorilor. */
  restricted?: boolean;
  ownTeamIds?: string[];
  /** Doar administratorii primesc mesajele și canalele automate (setări de administrator); altfel null și butonul „Mesaje automate” nu apare. */
  messages: IssueMessages | null;
  autoNotify: AutoNotifySettings | null;
  canEditMessages: boolean;
  isSuper: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const ds = useIssueDataset(initialRows);
  const canManage = ds.canManage ?? canManageServer;
  const restricted = ds.scope?.restricted ?? restrictedServer;
  const ownTeamIds = ds.scope?.ownTeamIds ?? ownTeamIdsServer;
  /** Marchează rezolvată: cine gestionează contoarele sau membrul secției responsabile. */
  const canResolve = (r: { _o: boolean; teamId: string | null }) => r._o && (canManage || (!!r.teamId && ownTeamIds.includes(r.teamId)));
  const [filters, setFilters] = useState<IssueFilters>(initialFilters);
  const [perPage, setPerPage] = useState(normalizePerPageClient(initialPerPage));
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<IssueRow | null>(null);
  const [msgOpen, setMsgOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [scroll, setScroll] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const q = useDeferredValue(filters.q);

  const list = useMemo(() => filterIssues(ds.rows, { ...filters, q }, ownTeamIds), [ds.rows, filters, q, ownTeamIds]);
  const counts = useMemo(() => countIssues(ds.rows), [ds.rows]);
  const uiPerPage = perPage === PER_PAGE_ALL ? Math.max(list.length, 1) : perPage;
  const totalPages = Math.max(1, Math.ceil(list.length / uiPerPage));
  const cur = Math.min(page, totalPages);
  const pageRows = useMemo(() => list.slice((cur - 1) * uiPerPage, cur * uiPerPage), [list, cur, uiPerPage]);
  /** Cine vede toate neregulile și are o secție pornește pe „Secția mea”; revenirea la filtrele implicite păstrează asta. */
  const defaultTeam = !restricted && ownTeamIds.length > 0 ? "mine" : "";
  const baseFilters: IssueFilters = { ...EMPTY_ISSUE_FILTERS, team: defaultTeam };
  const active = countActiveIssueFilters(filters) - (defaultTeam && filters.team === defaultTeam ? 1 : 0);

  const setFilter = useCallback((patch: Partial<IssueFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }, []);

  // adresa + preferința „câte pe pagină” (cookie → prima randare de pe server)
  useEffect(() => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v && v !== (k === "team" ? defaultTeam : (EMPTY_ISSUE_FILTERS as Record<string, string>)[k])) usp.set(k, v as string);
    }
    const qs = usp.toString();
    try {
      window.history.replaceState(null, "", `/contoare/nereguli${qs ? `?${qs}` : ""}`);
      document.cookie = `${ISSUES_PP_COOKIE}=${perPage}; path=/; max-age=31536000; samesite=lax`;
    } catch {}
  }, [filters, perPage, defaultTeam]);

  useEffect(() => {
    if (box.current) box.current.scrollTop = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- inițializare / resetare declanșată de schimbarea dependențelor (nu se poate deriva în randare)
    setScroll(0);
  }, [cur, filters, perPage]);

  const virt = pageRows.length > VIRT_MIN;
  const start = virt ? Math.max(0, Math.floor(scroll / ROW_H) - 6) : 0;
  const end = virt ? Math.min(pageRows.length, Math.ceil((scroll + VIEW_H) / ROW_H) + 6) : pageRows.length;

  const respLabel = (r: IssueDto) => (r.responsible === "CLIENT" ? t("Clientul") : r.responsible === "COMPANY" ? t("Compania") : t("De stabilit"));

  async function resolve(r: IssueRow) {
    const note = window.prompt(t("Cum a fost rezolvată neregula? (opțional)"), "");
    if (note === null) return;
    setBusy(r.id);
    try {
      const res = await resolveIssueAction(r.id, note);
      if (!res.ok) return toast.error(t(res.error ?? "Nu am putut salva."));
      ds.patch(r.id, { resolvedAt: new Date().toISOString(), resolvedNote: note.trim() || null, resolvedName: "—" });
      toast.success(t("Neregula a fost marcată ca rezolvată."));
    } catch {
      toast.error(t("Nu am putut salva."));
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    const esc = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const head = ["Nr. contor", "Abonat", "Cont personal", "Contract", "Adresă", "Telefon", "Tip", "Observații", "Responsabil", "Secția", "Raportat la", "Raportat de", "Termen de remediere", "Stare", "Rezolvat de", "Rezolvat la", "Rezolvare"].map((h) => esc(t(h)));
    const lines = [head.join(";")];
    for (const r of list) {
      lines.push([
        r.contor, r.name, r.account, r.contract, r.address, r.phone, t(ISSUE_LABELS[r.kind]), r.note, r.responsible ? respLabel(r) : "", r.teamName, dmy(r.reportedAt), r.userName, dmy(r.dueAt),
        r._o ? t("Deschisă") : t("Rezolvată"), r.resolvedName, dmy(r.resolvedAt), r.resolvedNote,
      ].map(esc).join(";"));
    }
    const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `nereguli-contoare-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Termenul: depășit (roșu), în ≤ 3 zile (portocaliu), altfel normal; la cele rezolvate — „în termen” / „cu întârziere”. */
  const dueCell = (r: IssueRow) => {
    if (!r.dueAt) return <span className="text-ink-soft/60">—</span>;
    if (!r._o) {
      const late = r.resolvedAt ? r.resolvedAt.slice(0, 10) > r.dueAt : false;
      return <span className={late ? "text-st-cancelled" : "text-st-done"}>{dmy(r.dueAt)} · {late ? t("cu întârziere") : t("în termen")}</span>;
    }
    const d = r._d;
    const cls = d < 0 ? "font-semibold text-st-cancelled" : d <= 3 ? "font-semibold text-st-progress" : "";
    const label = d < 0 ? t("depășit cu {n} zile", { n: -d }) : d === 0 ? t("expiră azi") : d === 1 ? t("expiră mâine") : t("expiră în {n} zile", { n: d });
    return <span className={cls} title={label}>{dmy(r.dueAt)} · {label}</span>;
  };

  /** Cerere nouă pentru această neregulă: pagina Cereri deschide fereastra de creare cu plătitorul, titlul și descrierea (contor, adresă, observații) completate. */
  const ticketHref = (r: IssueRow) => {
    const kind = t(ISSUE_LABELS[r.kind]);
    const desc = [
      `${t("Neregulă")}: ${kind}`,
      `${t("Contor")}: ${r.contor}`,
      r.name ? `${t("Abonat")}: ${r.name}` : "",
      r.address ? `${t("Adresă")}: ${r.address}` : "",
      r.phone ? `${t("Telefon")}: ${r.phone}` : "",
      r.note ? `${t("Observații")}: ${r.note}` : "",
      `${t("Raportat")}: ${dmy(r.reportedAt)}${r.userName ? ` (${r.userName})` : ""}`,
    ].filter(Boolean).join("\n");
    const sp = new URLSearchParams({ create: "ticket", title: `${kind} — ${t("contor")} ${r.contor}`.slice(0, 200), desc: desc.slice(0, 1000) });
    if (r.clientId) sp.set("client", r.clientId);
    if (r.phone) sp.set("phone", r.phone.replace(/[^\d+]/g, ""));
    return `/tickets?${sp.toString()}`;
  };

  const cols = [...COLS_HEAD, actionsWidth(canManage, canManage || ownTeamIds.length > 0, canTicket)];
  const grid = cols.map((w) => `${w}px`).join(" ");
  const gridW = cols.reduce((a, b) => a + b, 0);

  const actions = (r: IssueRow, wrap = false) =>
    canManage || canTicket || canResolve(r) ? (
      <span className={`flex items-center gap-1 ${wrap ? "flex-wrap" : "flex-nowrap"}`} onClick={(e) => e.stopPropagation()}>
        {canManage && <button type="button" onClick={() => setEdit(r)} className={`${ACT_BTN} border-[var(--color-line)] text-ink hover:bg-[var(--color-surface-2)]`} data-act="edit"><span aria-hidden>✎</span>{t("Editează")}</button>}
        {canResolve(r) && (
          <button type="button" disabled={busy === r.id} onClick={() => void resolve(r)} className={`${ACT_BTN} border-st-done/50 text-st-done hover:bg-st-done/10 disabled:opacity-50`} data-act="resolve"><span aria-hidden>✓</span>{t("Rezolvată")}</button>
        )}
        {canTicket && (
          <Link href={ticketHref(r)} prefetch={false} className={`${ACT_BTN} border-brand/50 text-brand hover:bg-brand-soft`} data-act="ticket" title={t("Creează o cerere pentru această neregulă (datele ei se completează singure)")}><span aria-hidden>+</span>{t("Cerere")}</Link>
        )}
      </span>
    ) : null;

  const pageButtons = buildPageButtons(cur, totalPages);
  const from = list.length === 0 ? 0 : (cur - 1) * uiPerPage + 1;
  const to = Math.min(cur * uiPerPage, list.length);

  return (
    <div className="w-full" data-issues-register="">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t("Nereguli contoare")}</h1>
          <p className="mt-0.5 text-sm text-ink-soft">{t("Neregulile raportate la contoare: cine remediază, ce secție răspunde și până când. Clientul sau personalul sunt anunțați înainte de termen și la depășire.")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {messages && autoNotify && (
          <button type="button" onClick={() => setMsgOpen(true)} className="tap inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium hover:bg-brand-soft" data-open-messages="">
            ✉ {t("Mesaje automate")}
            <span className={`rounded-full px-1.5 text-[10px] font-semibold ${autoNotify.issue.enabled ? "bg-st-done/15 text-st-done" : "bg-[var(--color-surface-2)] text-ink-soft"}`}>{autoNotify.issue.enabled ? t("pornite") : t("oprite")}</span>
          </button>
          )}
          <Link href="/contoare" className="tap inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]">{t("Contoare")}</Link>
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5 text-xs" data-issue-counters="">
        <Chip active={filters.status === "open" && !filters.due && !filters.resp} onClick={() => setFilters({ ...baseFilters, sort: filters.sort })} label={t("Deschise")} n={counts.open} />
        <Chip tone="red" active={filters.due === "overdue"} onClick={() => setFilter({ status: "open", due: filters.due === "overdue" ? "" : "overdue" })} label={t("Termen depășit")} n={counts.overdue} />
        <Chip tone="amber" active={filters.due === "7d"} onClick={() => setFilter({ status: "open", due: filters.due === "7d" ? "" : "7d" })} label={t("Expiră în 7 zile")} n={counts.soon} />
        <Chip active={filters.resp === "CLIENT"} onClick={() => setFilter({ status: "open", resp: filters.resp === "CLIENT" ? "" : "CLIENT" })} label={t("Răspunde clientul")} n={counts.client} />
        <Chip active={filters.resp === "COMPANY"} onClick={() => setFilter({ status: "open", resp: filters.resp === "COMPANY" ? "" : "COMPANY" })} label={t("Răspunde compania")} n={counts.company} />
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <input
          type="search"
          value={filters.q}
          onChange={(e) => setFilter({ q: e.target.value })}
          placeholder={t("Caută: contor, abonat, adresă, telefon…")}
          aria-label={t("Căutare")}
          className={`${fld(filters.q)} w-72 max-w-full`}
        />
        <select value={filters.status} onChange={(e) => setFilter({ status: e.target.value as IssueFilters["status"] })} className={fld(filters.status !== "open")} aria-label={t("Stare")}>
          <option value="open">{t("Deschise")}</option>
          <option value="resolved">{t("Rezolvate")}</option>
          <option value="all">{t("Toate")}</option>
        </select>
        <select value={filters.kind} onChange={(e) => setFilter({ kind: e.target.value as IssueFilters["kind"] })} className={fld(filters.kind)} aria-label={t("Tip")}>
          <option value="">{t("Tip: toate")}</option>
          {ISSUE_KINDS.map((k) => <option key={k} value={k}>{t(ISSUE_LABELS[k])}</option>)}
        </select>
        <select value={filters.resp} onChange={(e) => setFilter({ resp: e.target.value as IssueFilters["resp"] })} className={fld(filters.resp)} aria-label={t("Cine remediază")}>
          <option value="">{t("Responsabil: toți")}</option>
          <option value="CLIENT">{t("Clientul")}</option>
          <option value="COMPANY">{t("Compania")}</option>
          <option value="none">{t("De stabilit")}</option>
        </select>
        {!restricted && (
          <select value={filters.team} onChange={(e) => setFilter({ team: e.target.value })} className={fld(filters.team !== defaultTeam)} aria-label={t("Secția")} data-filter-team="">
            {defaultTeam && <option value="mine">{ownTeamIds.length > 1 ? t("Secțiile mele") : t("Secția mea")}</option>}
            <option value={defaultTeam ? "all" : ""}>{t("Secție: toate")}</option>
            {teams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            <option value="none">{t("Fără secție")}</option>
          </select>
        )}
        <select value={filters.due} onChange={(e) => setFilter({ due: e.target.value as IssueFilters["due"] })} className={fld(filters.due)} aria-label={t("Termen")}>
          <option value="">{t("Termen: toate")}</option>
          <option value="overdue">{t("Termen depășit")}</option>
          <option value="7d">{t("Expiră în 7 zile")}</option>
          <option value="none">{t("Fără termen")}</option>
        </select>
        <select value={filters.sort} onChange={(e) => setFilter({ sort: e.target.value as IssueFilters["sort"] })} className={fld(false)} aria-label={t("Sortare")}>
          <option value="dueAsc">{t("Sortare: termen apropiat")}</option>
          <option value="reportedDesc">{t("Sortare: raportate recent")}</option>
          <option value="contor">{t("Sortare: nr. contor")}</option>
        </select>
        {active > 0 && (
          <button type="button" onClick={() => { setFilters({ ...baseFilters, sort: filters.sort }); setPage(1); }} className="tap h-8 rounded-lg border border-[var(--color-line)] px-2 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]">{t("Resetează filtrele")} ({active})</button>
        )}
        <button type="button" onClick={exportCsv} disabled={list.length === 0} className="tap h-8 rounded-lg border border-[var(--color-line)] px-2.5 text-xs font-medium hover:bg-brand-soft disabled:opacity-40" data-export="">⭳ {t("Export")}</button>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-soft">
          {t("Afișează")}
          <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} className={fld(perPage !== DEFAULT_PER_PAGE)} aria-label={t("Rânduri pe pagină")}>
            {NOTIFY_PER_PAGE.map((n) => <option key={n} value={n}>{perPageLabel(n, t)}</option>)}
          </select>
        </label>
      </div>
      {ds.loading && <div className="mb-2 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}
      {ds.error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {ds.error}
          <button type="button" onClick={() => void ds.refresh()} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
        </p>
      )}

      {/* Tabel (ecrane late) */}
      <div className="card hidden overflow-hidden md:block">
        <div ref={box} onScroll={(e) => virt && setScroll((e.target as HTMLDivElement).scrollTop)} className="overflow-auto" style={{ maxHeight: virt ? VIEW_H : undefined }} data-issue-scroll="">
          <div role="table" className="text-[11px]" style={{ width: gridW, minWidth: "100%" }}>
            <div role="row" className="sticky top-0 z-10 grid bg-[var(--color-surface-2)]" style={{ gridTemplateColumns: grid }}>
              {["Contor", "Abonat", "Tip", "Responsabil", "Secția", "Termen de remediere", "Stare", "Rezolvat de", "Raportat", "Adresă", ""].map((h, i) => (
                <div key={i} role="columnheader" className="border-b border-[var(--color-line)] px-2 py-1.5 font-semibold text-ink-soft">{h ? t(h) : ""}</div>
              ))}
            </div>
            {virt && start > 0 && <div style={{ height: start * ROW_H }} />}
            {pageRows.slice(start, end).map((r) => (
              <div key={r.id} role="row" data-issue-row={r.id} className={`grid items-center hover:bg-brand-soft/30 ${r._o ? "" : "text-ink-soft"}`} style={{ gridTemplateColumns: grid, height: ROW_H }}>
                <div role="cell" className="truncate border-b border-[var(--color-line)] px-2 font-mono font-medium">{restricted ? r.contor : <Link href={`/contoare/${encodeURIComponent(r.meterId)}`} className="hover:text-brand hover:underline">{r.contor}</Link>}</div>
                <div role="cell" className="truncate border-b border-[var(--color-line)] px-2" title={r.name}>{r.clientId && !restricted ? <Link href={`/platitori/${r.clientId}`} className="hover:text-brand hover:underline">{r.name}</Link> : r.name}</div>
                <div role="cell" className={`truncate border-b border-[var(--color-line)] px-2 ${SERIOUS_ISSUES.includes(r.kind) && r._o ? "font-semibold text-st-cancelled" : ""}`} title={r.note ?? t(ISSUE_LABELS[r.kind])}>{t(ISSUE_LABELS[r.kind])}</div>
                <div role="cell" className="truncate border-b border-[var(--color-line)] px-2" data-resp={r.responsible ?? ""}>{respLabel(r)}</div>
                <div role="cell" className="truncate border-b border-[var(--color-line)] px-2" title={r.teamName ?? ""}>{r.teamName ?? <span className="text-ink-soft/60">—</span>}</div>
                <div role="cell" className="truncate border-b border-[var(--color-line)] px-2 tabular-nums" data-due={r.dueAt ?? ""}>{dueCell(r)}</div>
                <div role="cell" className="truncate border-b border-[var(--color-line)] px-2" title={r.resolvedNote ?? ""}>{r._o ? t("Deschisă") : `✓ ${t("Rezolvată")}`}</div>
                <div role="cell" className="truncate border-b border-[var(--color-line)] px-2" data-resolved-by={r.resolvedName ?? ""} title={r._o ? "" : [r.resolvedName, dmy(r.resolvedAt), r.resolvedNote].filter(Boolean).join(" · ")}>
                  {r._o ? <span className="text-ink-soft/60">—</span> : <>{r.resolvedName || "—"}{r.resolvedAt ? <span className="ml-1 tabular-nums text-ink-soft">{dmy(r.resolvedAt)}</span> : null}</>}
                </div>
                <div role="cell" className="truncate border-b border-[var(--color-line)] px-2 tabular-nums" title={r.userName}>{dmy(r.reportedAt)}</div>
                <div role="cell" className="truncate border-b border-[var(--color-line)] px-2" title={r.address ?? ""}>{r.address ?? "—"}</div>
                <div role="cell" className="border-b border-[var(--color-line)] px-1">{actions(r)}</div>
              </div>
            ))}
            {virt && end < pageRows.length && <div style={{ height: (pageRows.length - end) * ROW_H }} />}
          </div>
        </div>
        {pageRows.length === 0 && <p className="p-8 text-center text-ink-soft">{t("Nicio neregulă cu filtrele acestea.")}</p>}
      </div>

      {/* Carduri (telefon) */}
      <div className="flex flex-col gap-1.5 md:hidden">
        {pageRows.map((r) => (
          <div key={r.id} data-issue-card={r.id} className={`card p-3 text-sm ${r._o ? "" : "opacity-70"}`}>
            <div className="flex items-start justify-between gap-2">
              {restricted ? <span className="font-mono font-semibold">{r.contor}</span> : <Link href={`/contoare/${encodeURIComponent(r.meterId)}`} className="font-mono font-semibold hover:text-brand">{r.contor}</Link>}
              <span className={`text-xs ${SERIOUS_ISSUES.includes(r.kind) && r._o ? "font-semibold text-st-cancelled" : "text-ink-soft"}`}>{t(ISSUE_LABELS[r.kind])}</span>
            </div>
            <p className="truncate text-xs text-ink-soft">{r.clientId && !restricted ? <Link href={`/platitori/${r.clientId}`} className="hover:text-brand">{r.name}</Link> : r.name}{r.address ? ` · ${r.address}` : ""}</p>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div><dt className="text-ink-soft">{t("Responsabil")}</dt><dd className="font-medium">{respLabel(r)}</dd></div>
              <div><dt className="text-ink-soft">{t("Secția")}</dt><dd className="font-medium">{r.teamName ?? "—"}</dd></div>
              <div className="col-span-2"><dt className="text-ink-soft">{t("Termen de remediere")}</dt><dd className="font-medium">{dueCell(r)}</dd></div>
            </dl>
            {r.note && <p className="mt-1 text-xs">{r.note}</p>}
            {!r._o && <p className="mt-1 text-xs text-st-done" data-resolved-card="">✓ {t("Rezolvată de")} <b>{r.resolvedName || "—"}</b>{r.resolvedAt ? ` · ${dmy(r.resolvedAt)}` : ""}{r.resolvedNote ? ` — ${r.resolvedNote}` : ""}</p>}
            {(canManage || canTicket || canResolve(r)) && <div className="mt-2">{actions(r, true)}</div>}
          </div>
        ))}
        {pageRows.length === 0 && <div className="card p-8 text-center text-ink-soft">{t("Nicio neregulă cu filtrele acestea.")}</div>}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft" data-issue-pager="">
        <span>{list.length === 0 ? t("0 nereguli") : t("{from}–{to} din {total}", { from, to, total: list.length })}</span>
        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button disabled={cur <= 1} onClick={() => setPage(cur - 1)} className="tap grid size-7 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40" aria-label={t("Pagina anterioară")}><IconChevronLeft className="size-4" /></button>
            {pageButtons.map((b, i) =>
              b === "…" ? (
                <span key={`e${i}`} className="flex h-7 w-6 items-center justify-center text-sm">…</span>
              ) : (
                <button key={b} onClick={() => setPage(b)} className={`tap h-7 min-w-[28px] rounded-lg px-2 text-xs font-medium ${b === cur ? "bg-brand text-white" : "border border-[var(--color-line)] text-ink hover:bg-[var(--color-surface-2)]"}`}>{b}</button>
              ),
            )}
            <button disabled={cur >= totalPages} onClick={() => setPage(cur + 1)} className="tap grid size-7 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40" aria-label={t("Pagina următoare")}><IconChevronRight className="size-4" /></button>
          </div>
        )}
      </div>

      {msgOpen && messages && autoNotify && (
        <IssueMessagesDialog initial={messages} autoNotify={autoNotify} canEdit={canEditMessages} isSuper={isSuper} emailEnabled={emailEnabled} smsEnabled={smsEnabled} onClose={() => setMsgOpen(false)} />
      )}
      {edit && (
        <IssueEditDialog
          issue={edit}
          onClose={() => setEdit(null)}
          onSaved={(i) => ds.patch(i.id, { responsible: i.responsible, teamId: i.teamId, teamName: i.teamName, dueAt: i.dueAt })}
        />
      )}
    </div>
  );
}

function Chip({ label, n, onClick, active, tone }: { label: string; n: number; onClick: () => void; active: boolean; tone?: "red" | "amber" }) {
  const color = tone === "red" && n > 0 ? "text-st-cancelled" : tone === "amber" && n > 0 ? "text-st-progress" : "";
  return (
    <button type="button" onClick={onClick} className={`tap inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 ${active ? "border-brand bg-brand/10 font-semibold" : "border-[var(--color-line)] hover:bg-[var(--color-surface-2)]"} ${color}`}>
      {label} <b className="tabular-nums">{n}</b>
    </button>
  );
}

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
