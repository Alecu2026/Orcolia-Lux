"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { resolveIssueAction } from "@/app/actions/meter-routes";
import { countActiveIssueFilters, countIssues, EMPTY_ISSUE_FILTERS, filterIssues, type IssueFilters, type IssueRow } from "@/lib/meter-issue-register";
import { ISSUE_LABELS, ISSUE_KINDS, SERIOUS_ISSUES, type IssueDto, type IssueRegisterRow } from "@/lib/meter-issues";
import { useT } from "@/lib/i18n/context";
import { useToast } from "./toast";
import DataTable, { type Col } from "./DataTable";
import { useIssueDataset } from "./useIssueDataset";
import IssueEditDialog from "./IssueEditDialog";
import IssueMessagesDialog from "./IssueMessagesDialog";
import type { AutoNotifySettings } from "@/lib/auto-notify";
import type { IssueMessages } from "@/lib/issue-messages";

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
  const [edit, setEdit] = useState<IssueRow | null>(null);
  const [msgOpen, setMsgOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useDeferredValue(filters.q);

  const list = useMemo(() => filterIssues(ds.rows, { ...filters, q }, ownTeamIds), [ds.rows, filters, q, ownTeamIds]);
  const counts = useMemo(() => countIssues(ds.rows), [ds.rows]);
  /** Cine vede toate neregulile și are o secție pornește pe „Secția mea”; revenirea la filtrele implicite păstrează asta. */
  const defaultTeam = !restricted && ownTeamIds.length > 0 ? "mine" : "";
  const baseFilters: IssueFilters = { ...EMPTY_ISSUE_FILTERS, team: defaultTeam };
  const active = countActiveIssueFilters(filters) - (defaultTeam && filters.team === defaultTeam ? 1 : 0);

  const setFilter = useCallback((patch: Partial<IssueFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
  }, []);

  // adresa (filtrele rămân în link)
  useEffect(() => {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (v && v !== (k === "team" ? defaultTeam : (EMPTY_ISSUE_FILTERS as Record<string, string>)[k])) usp.set(k, v as string);
    }
    const qs = usp.toString();
    try {
      window.history.replaceState(null, "", `/contoare/nereguli${qs ? `?${qs}` : ""}`);
    } catch {}
  }, [filters, defaultTeam]);

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

  const columns: Col<IssueRow>[] = [
    {
      key: "contor", label: "Contor", minW: 100, sticky: true, sort: (r) => r.contor,
      render: (r) => (restricted ? <span className="font-mono font-medium">{r.contor}</span> : <Link href={`/contoare/${encodeURIComponent(r.meterId)}`} className="font-mono font-medium hover:text-brand hover:underline">{r.contor}</Link>),
    },
    {
      key: "name", label: "Abonat", minW: 150, maxW: 260, sort: (r) => r.name,
      render: (r) => (r.clientId && !restricted ? <Link href={`/platitori/${r.clientId}`} className="hover:text-brand hover:underline">{r.name}</Link> : r.name),
    },
    {
      key: "kind", label: "Tip", minW: 140, sort: (r) => t(ISSUE_LABELS[r.kind]),
      render: (r) => <span className={SERIOUS_ISSUES.includes(r.kind) && r._o ? "font-semibold text-st-cancelled" : ""} title={r.note ?? t(ISSUE_LABELS[r.kind])}>{t(ISSUE_LABELS[r.kind])}</span>,
    },
    { key: "resp", label: "Responsabil", minW: 90, sort: (r) => respLabel(r), render: (r) => respLabel(r) },
    { key: "team", label: "Secția", minW: 110, sort: (r) => r.teamName ?? "", render: (r) => r.teamName ?? <span className="text-ink-soft/60">—</span> },
    { key: "due", label: "Termen de remediere", minW: 190, sort: (r) => r.dueAt ?? "9999-12-31", render: (r) => dueCell(r) },
    { key: "state", label: "Stare", minW: 90, sort: (r) => (r._o ? 0 : 1), render: (r) => (r._o ? t("Deschisă") : `✓ ${t("Rezolvată")}`) },
    {
      key: "resolvedBy", label: "Rezolvat de", minW: 160, maxW: 240, sort: (r) => r.resolvedName ?? "",
      render: (r) => (r._o ? <span className="text-ink-soft/60">—</span> : <>{r.resolvedName || "—"}{r.resolvedAt ? <span className="ml-1 tabular-nums text-ink-soft">{dmy(r.resolvedAt)}</span> : null}</>),
    },
    { key: "reported", label: "Raportat", minW: 85, sort: (r) => r.reportedAt ?? "", render: (r) => <span className="tabular-nums" title={r.userName}>{dmy(r.reportedAt)}</span> },
    { key: "address", label: "Adresă", minW: 180, maxW: 300, sort: (r) => r.address ?? "", render: (r) => r.address ?? "—" },
    { key: "note", label: "Observații", minW: 200, maxW: 320, defaultHidden: true, sort: (r) => r.note ?? "", render: (r) => r.note ?? "—" },
    { key: "resolution", label: "Rezolvare", minW: 200, maxW: 320, defaultHidden: true, sort: (r) => r.resolvedNote ?? "", render: (r) => r.resolvedNote ?? "—" },
    { key: "act", label: "", minW: 230, render: (r) => actions(r) },
  ];


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
          <button type="button" onClick={() => setFilters({ ...baseFilters, sort: filters.sort })} className="tap h-8 rounded-lg border border-[var(--color-line)] px-2 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]">{t("Resetează filtrele")} ({active})</button>
        )}
        <button type="button" onClick={exportCsv} disabled={list.length === 0} className="tap h-8 rounded-lg border border-[var(--color-line)] px-2.5 text-xs font-medium hover:bg-brand-soft disabled:opacity-40" data-export="">⭳ {t("Export")}</button>
      </div>
      {ds.loading && <div className="mb-2 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}
      {ds.error && (
        <p className="mb-2 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
          {ds.error}
          <button type="button" onClick={() => void ds.refresh()} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
        </p>
      )}

      <DataTable<IssueRow>
        storageKey="meter-issues"
        rows={list}
        columns={columns}
        filters={[]}
        noun={t("nereguli")}
        emptyText={t("Nicio neregulă cu filtrele acestea.")}
        rowClassName={(r) => (r._o ? "" : "text-ink-soft")}
        cardKeys={["contor", "name", "kind"]}
      />

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
