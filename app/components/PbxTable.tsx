"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import DataTable, { type Col, type Filter } from "./DataTable";
import { getPbxEventsAction, type PbxEventRow } from "@/app/actions/pbx";
import { IconX } from "./icons";

export type PbxCallRow = {
  id: string;
  callId: string;
  direction: string | null;
  phone: string | null;
  phoneE164: string | null;
  diversion: string | null;
  pbxUser: string | null;
  ext: string | null;
  status: string | null;
  state: string | null;
  durationSec: number | null;
  waitSec: number | null;
  at: string;
  lastCmd: string | null;
  eventCount: number;
  clientId: string | null;
  clientName: string | null;
  recordingUrl: string | null;
  rating: number | null;
  groupName: string | null;
  lineName: string | null;
};

const TZ = "Europe/Chisinau";

/** Rezultatul apelului: din „history" (status final), iar până atunci din starea ultimului eveniment. */
type Result = { key: string; label: string; cls: string };
function resultOf(c: PbxCallRow): Result {
  const s = (c.status ?? "").toLowerCase();
  switch (s) {
    case "success": return { key: "success", label: "Răspuns", cls: "bg-st-done/15 text-st-done" };
    case "missed": return { key: "missed", label: "Pierdut", cls: "bg-st-cancelled/15 text-st-cancelled" };
    case "cancel": return { key: "cancel", label: "Anulat", cls: "bg-st-noshow/15 text-st-noshow" };
    case "busy": return { key: "busy", label: "Ocupat", cls: "bg-st-noshow/15 text-st-noshow" };
    case "notavailable": return { key: "unavailable", label: "Indisponibil", cls: "bg-st-noshow/15 text-st-noshow" };
    case "notallowed": return { key: "notallowed", label: "Interzis", cls: "bg-st-cancelled/15 text-st-cancelled" };
    case "notfound": return { key: "notfound", label: "Negăsit", cls: "bg-st-cancelled/15 text-st-cancelled" };
  }
  if (s) return { key: s, label: c.status!, cls: "bg-[var(--color-surface-2)] text-ink-soft" };
  switch (c.state) {
    case "INCOMING": case "OUTGOING": return { key: "ringing", label: "Sună…", cls: "bg-st-new/15 text-st-new" };
    case "ACCEPTED": return { key: "talking", label: "În convorbire", cls: "bg-st-progress/15 text-st-progress" };
    case "COMPLETED": return { key: "completed", label: "Încheiat", cls: "bg-st-done/15 text-st-done" };
    case "CANCELLED": return { key: "cancel", label: "Anulat", cls: "bg-st-noshow/15 text-st-noshow" };
    case "TRANSFERRED": return { key: "transferred", label: "Transferat", cls: "bg-st-confirmed/15 text-st-confirmed" };
  }
  return { key: "unknown", label: "—", cls: "text-ink-soft" };
}

const RESULT_OPTIONS = [
  { value: "success", label: "Răspuns" },
  { value: "missed", label: "Pierdut" },
  { value: "cancel", label: "Anulat" },
  { value: "busy", label: "Ocupat" },
  { value: "other", label: "Altele / în curs" },
];

const dir = (c: PbxCallRow) => (c.direction === "out" ? "out" : c.direction === "in" ? "in" : "");
const mmss = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });
const pretty = (p: string | null) => (p ? (p.startsWith("373") ? `+${p}` : p) : "—");

const topBtn =
  "tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]";

/** PBX (Moldcell) — apelurile primite prin webhook. Tabel dens cu filtre locale; click pe rând = toate mesajele apelului. */
export default function PbxTable({ rows, webhookUrl, tokenConfigured }: { rows: PbxCallRow[]; webhookUrl: string; tokenConfigured: boolean }) {
  const router = useRouter();
  const [detail, setDetail] = useState<PbxCallRow | null>(null);
  const [copied, setCopied] = useState(false);

  // Apelurile noi apar singure (reîmprospătare discretă la 20 s cât timp fila e vizibilă).
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 20_000);
    return () => clearInterval(t);
  }, [router]);

  const dash = <span className="text-ink-soft/60">—</span>;
  const columns: Col<PbxCallRow>[] = [
    { key: "at", label: "Data și ora", minW: 150, sticky: true, sort: (c) => c.at, render: (c) => <span className="whitespace-nowrap">{fmtDateTime(c.at)}</span> },
    {
      key: "dir", label: "Direcție", minW: 80, sort: (c) => c.direction,
      render: (c) => (c.direction === "out" ? <span className="text-st-progress">↗ Efectuat</span> : c.direction === "in" ? <span className="text-st-confirmed">↘ Primit</span> : dash),
    },
    { key: "phone", label: "Număr", minW: 120, sort: (c) => c.phone, render: (c) => <span className="font-mono">{pretty(c.phone)}</span> },
    { key: "client", label: "Client", minW: 160, maxW: 220, sort: (c) => c.clientName, render: (c) => (c.clientName ? <span title={c.clientName}>{c.clientName}</span> : <span className="text-ink-soft">necunoscut</span>) },
    {
      key: "result", label: "Rezultat", minW: 100, sort: (c) => resultOf(c).label,
      render: (c) => { const r = resultOf(c); return <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium leading-[14px] ${r.cls}`}>{r.label}</span>; },
    },
    { key: "dur", label: "Durată", minW: 60, right: true, sort: (c) => c.durationSec, render: (c) => mmss(c.durationSec) },
    { key: "wait", label: "Așteptare", minW: 65, right: true, sort: (c) => c.waitSec, render: (c) => (c.waitSec != null ? `${c.waitSec}s` : dash) },
    { key: "ext", label: "Extensie", minW: 65, sort: (c) => c.ext, render: (c) => c.ext ?? dash },
    { key: "user", label: "Operator", minW: 100, maxW: 140, sort: (c) => c.pbxUser, render: (c) => c.pbxUser ?? dash },
    { key: "line", label: "Număr companie", minW: 120, sort: (c) => c.diversion, render: (c) => (c.diversion ? <span title={c.lineName ?? undefined}>{pretty(c.diversion)}</span> : dash) },
    {
      key: "rec", label: "Înregistrare", minW: 90,
      render: (c) => (c.recordingUrl ? <a href={c.recordingUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="cursor-pointer text-brand hover:underline">▶ Ascultă</a> : dash),
    },
    { key: "ev", label: "Mesaje", minW: 60, right: true, sort: (c) => c.eventCount, render: (c) => c.eventCount },
    { key: "group", label: "Departament", minW: 110, defaultHidden: true, sort: (c) => c.groupName, render: (c) => c.groupName ?? dash },
    { key: "rating", label: "Notă client", minW: 70, right: true, defaultHidden: true, sort: (c) => c.rating, render: (c) => (c.rating != null ? `${c.rating}/5` : dash) },
    { key: "callid", label: "ID apel", minW: 150, defaultHidden: true, sort: (c) => c.callId, render: (c) => <span className="font-mono text-[10px]">{c.callId}</span> },
  ];

  const filters = useMemo<Filter<PbxCallRow>[]>(
    () => [
      {
        kind: "text", key: "q", label: "Caută", grow: true, placeholder: "Caută număr, client, operator, ID apel…",
        test: (c, v) => [c.phone, c.phoneE164, c.clientName, c.pbxUser, c.callId, c.ext].some((x) => (x ?? "").toLowerCase().includes(v.replace(/^\+/, ""))),
      },
      {
        kind: "select", key: "dir", label: "Direcție: toate",
        options: [{ value: "in", label: "Primite" }, { value: "out", label: "Efectuate" }],
        test: (c, v) => dir(c) === v,
      },
      {
        kind: "select", key: "result", label: "Rezultat: toate", options: RESULT_OPTIONS,
        test: (c, v) => { const k = resultOf(c).key; return v === "other" ? !["success", "missed", "cancel", "busy"].includes(k) : k === v; },
      },
      {
        kind: "select", key: "period", label: "Perioadă: toate",
        options: [{ value: "today", label: "Azi" }, { value: "yesterday", label: "Ieri" }, { value: "7", label: "Ultimele 7 zile" }, { value: "30", label: "Ultimele 30 de zile" }],
        test: (c, v) => {
          const k = dayKey(c.at);
          const today = dayKey(new Date().toISOString());
          if (v === "today") return k === today;
          if (v === "yesterday") return k === dayKey(new Date(Date.now() - 86_400_000).toISOString());
          return new Date(c.at).getTime() >= Date.now() - Number(v) * 86_400_000;
        },
      },
      { kind: "date", key: "from", label: "De la data", test: (c, v) => dayKey(c.at) >= v },
      { kind: "date", key: "to", label: "Până la data", test: (c, v) => dayKey(c.at) <= v },
      {
        kind: "select", key: "client", label: "Client: toți",
        options: [{ value: "known", label: "Cu client în CRM" }, { value: "unknown", label: "Necunoscuți" }],
        test: (c, v) => (v === "known" ? !!c.clientId : !c.clientId),
      },
      {
        kind: "select", key: "rec", label: "Înregistrare: toate",
        options: [{ value: "yes", label: "Cu înregistrare" }, { value: "no", label: "Fără" }],
        test: (c, v) => (v === "yes" ? !!c.recordingUrl : !c.recordingUrl),
      },
    ],
    [],
  );

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-1.5 text-[11px]">
        <span className="font-semibold">Webhook PBX:</span>
        <code className="rounded bg-[var(--color-surface)] px-1.5 py-0.5 font-mono">{webhookUrl}</code>
        <button
          type="button"
          onClick={() => { navigator.clipboard?.writeText(webhookUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }}
          className="cursor-pointer text-brand hover:underline"
        >
          {copied ? "Copiat!" : "Copiază"}
        </button>
        <span className={tokenConfigured ? "text-st-done" : "font-semibold text-st-cancelled"}>
          {tokenConfigured ? "● token configurat" : "● CRM_TOKEN nesetat — apelurile sunt respinse"}
        </span>
      </div>

      <DataTable
        storageKey="pbx"
        rows={rows}
        columns={columns}
        filters={filters}
        defaultSort={{ key: "at", dir: "desc" }}
        noun="apeluri"
        emptyText="Niciun apel primit încă. Apelurile apar aici imediat ce PBX-ul trimite mesaje către webhook."
        onRowClick={(c) => setDetail(c)}
        rowClassName={(c) => (resultOf(c).key === "missed" ? "bg-st-cancelled/5" : "")}
        toolbar={<button type="button" onClick={() => router.refresh()} className={topBtn}>↻ Reîncarcă</button>}
      />

      {detail && <CallDialog call={rows.find((r) => r.id === detail.id) ?? detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function CallDialog({ call: c, onClose }: { call: PbxCallRow; onClose: () => void }) {
  const [events, setEvents] = useState<PbxEventRow[] | null>(null);
  useEffect(() => {
    let alive = true;
    getPbxEventsAction(c.callId).then((r) => alive && setEvents(r)).catch(() => alive && setEvents([]));
    return () => { alive = false; };
  }, [c.callId, c.eventCount]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const r = resultOf(c);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-xl overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">{c.clientName ?? pretty(c.phone)}</h2>
            <p className="text-xs text-ink-soft">
              {c.direction === "out" ? "Apel efectuat" : "Apel primit"} · {fmtDateTime(c.at)}
            </p>
          </div>
          <button onClick={onClose} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label="Închide">
            <IconX className="size-4" />
          </button>
        </div>

        <section className="mb-2.5 overflow-hidden rounded-lg border border-[var(--color-line)]">
          <h3 className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Apel</h3>
          <div className="divide-y divide-[var(--color-line)] text-[13px]">
            <Item label="Rezultat"><span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${r.cls}`}>{r.label}</span></Item>
            <Item label="Număr">{pretty(c.phone)}</Item>
            <Item label="Client">{c.clientName ?? "necunoscut"}</Item>
            <Item label="Durată">{mmss(c.durationSec)}{c.waitSec != null ? ` · așteptare ${c.waitSec}s` : ""}</Item>
            <Item label="Operator">{[c.pbxUser, c.ext ? `ext. ${c.ext}` : null].filter(Boolean).join(" · ") || "—"}</Item>
            <Item label="Număr companie">{c.diversion ? pretty(c.diversion) : "—"}{c.lineName ? ` (${c.lineName})` : ""}</Item>
            {c.groupName && <Item label="Departament">{c.groupName}</Item>}
            {c.rating != null && <Item label="Nota clientului">{c.rating}/5</Item>}
            {c.recordingUrl && <Item label="Înregistrare"><a href={c.recordingUrl} target="_blank" rel="noreferrer" className="cursor-pointer text-brand hover:underline">▶ Ascultă</a></Item>}
            <Item label="ID apel"><span className="font-mono text-[11px]">{c.callId}</span></Item>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-[var(--color-line)]">
          <h3 className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Mesaje primite{events ? ` (${events.length})` : ""}
          </h3>
          {!events ? (
            <p className="px-2.5 py-2 text-sm text-ink-soft">Se încarcă…</p>
          ) : events.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-ink-soft">—</p>
          ) : (
            <ul className="divide-y divide-[var(--color-line)] text-xs">
              {events.map((e) => (
                <li key={e.id} className="px-2.5 py-1.5">
                  <details>
                    <summary className="flex cursor-pointer items-center justify-between gap-2">
                      <span className="font-semibold">
                        {e.cmd ?? "?"}
                        {typeof e.payload.type === "string" && <span className="ml-1.5 font-normal text-ink-soft">{e.payload.type}</span>}
                        {typeof e.payload.status === "string" && <span className="ml-1.5 font-normal text-ink-soft">{e.payload.status}</span>}
                      </span>
                      <span className="text-ink-soft">{new Date(e.receivedAt).toLocaleTimeString("ro-RO", { timeZone: TZ })}</span>
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-[var(--color-surface-2)] p-2 text-[10px] leading-snug">{JSON.stringify(e.payload, null, 2)}</pre>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
      <span className="shrink-0 text-[11px] text-ink-soft">{label}</span>
      <span className="min-w-0 break-words text-right">{children}</span>
    </div>
  );
}
