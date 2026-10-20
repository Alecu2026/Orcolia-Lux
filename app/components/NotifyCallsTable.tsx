"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DataTable, { type Col, type Filter } from "./DataTable";
import { IconX } from "./icons";
import { callSeconds, voiceById } from "@/lib/payer-notify";

export type NotifyCallRow = {
  id: string;
  callSid: string;
  campaignId: string;
  clientId: string;
  clientName: string;
  phone: string;
  voice: string | null;
  text: string;
  status: string;
  at: string;
  durationSec: number | null;
  reply: string | null;
  replyDigits: string | null;
  userName: string;
};

const TZ = "Europe/Chisinau";
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });
const mmss = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

type Result = { key: string; label: string; cls: string };
function resultOf(c: NotifyCallRow): Result {
  switch (c.status) {
    case "completed": return { key: "answered", label: "A răspuns", cls: "bg-st-done/15 text-st-done" };
    case "in-progress": return { key: "live", label: "Ascultă acum", cls: "bg-st-progress/15 text-st-progress" };
    case "ringing": return { key: "live", label: "Sună…", cls: "bg-st-new/15 text-st-new" };
    case "queued": case "initiated": return { key: "live", label: "În coadă", cls: "bg-st-new/15 text-st-new" };
    case "no-answer": return { key: "no-answer", label: "Fără răspuns", cls: "bg-st-noshow/15 text-st-noshow" };
    case "busy": return { key: "busy", label: "Ocupat", cls: "bg-st-noshow/15 text-st-noshow" };
    case "canceled": return { key: "failed", label: "Anulat", cls: "bg-st-noshow/15 text-st-noshow" };
    case "failed": return { key: "failed", label: "Eșuat", cls: "bg-st-cancelled/15 text-st-cancelled" };
  }
  return { key: "unknown", label: c.status, cls: "bg-[var(--color-surface-2)] text-ink-soft" };
}

const replyOf = (c: NotifyCallRow) => [c.reply, c.replyDigits ? `tasta ${c.replyDigits}` : ""].filter(Boolean).join(" · ");
/** Cât din mesaj a fost ascultat, în procente (durata convorbirii față de durata estimată a mesajului, plafonat la 100%). */
const heardPct = (c: NotifyCallRow) => (c.durationSec == null ? null : Math.min(100, Math.round((c.durationSec / (callSeconds(c.text) + 1)) * 100)));

const topBtn =
  "tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]";

/** Apelurile de notificare către plătitori (robot): rezultat, cât a ascultat destinatarul, ce a răspuns. Același tabel dens ca la PBX. */
export default function NotifyCallsTable({ rows }: { rows: NotifyCallRow[] }) {
  const router = useRouter();
  const [detail, setDetail] = useState<NotifyCallRow | null>(null);

  // Rezultatele vin din webhook — reîmprospătăm discret cât fila e vizibilă.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 15_000);
    return () => clearInterval(t);
  }, [router]);

  const dash = <span className="text-ink-soft/60">—</span>;
  const columns: Col<NotifyCallRow>[] = [
    { key: "at", label: "Data și ora", minW: 150, sticky: true, sort: (c) => c.at, render: (c) => <span className="whitespace-nowrap">{fmtDateTime(c.at)}</span> },
    {
      key: "client", label: "Plătitor", minW: 170, maxW: 240, sort: (c) => c.clientName,
      render: (c) => (
        <Link href={`/platitori/${c.clientId}`} onClick={(e) => e.stopPropagation()} className="cursor-pointer text-brand hover:underline" title={c.clientName}>{c.clientName}</Link>
      ),
    },
    { key: "phone", label: "Telefon", minW: 120, sort: (c) => c.phone, render: (c) => <span className="font-mono">{c.phone}</span> },
    {
      key: "result", label: "Rezultat", minW: 100, sort: (c) => resultOf(c).label,
      render: (c) => { const r = resultOf(c); return <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium leading-[14px] ${r.cls}`}>{r.label}</span>; },
    },
    {
      key: "heard", label: "Ascultat", minW: 110, right: true, sort: (c) => c.durationSec,
      render: (c) => {
        if (c.durationSec == null) return dash;
        const p = heardPct(c);
        return <span title={`Mesajul durează ≈ ${callSeconds(c.text)} s`}>{mmss(c.durationSec)}{p != null && <span className="text-ink-soft"> · {p}%</span>}</span>;
      },
    },
    { key: "reply", label: "A răspuns", minW: 160, maxW: 280, sort: (c) => replyOf(c), render: (c) => (replyOf(c) ? <span title={replyOf(c)}>{replyOf(c)}</span> : dash) },
    { key: "voice", label: "Voce", minW: 150, maxW: 200, sort: (c) => c.voice, render: (c) => (c.voice ? voiceById(c.voice).label : dash) },
    { key: "text", label: "Mesaj", minW: 220, maxW: 360, sort: (c) => c.text, render: (c) => <span title={c.text}>{c.text}</span> },
    { key: "by", label: "Trimis de", minW: 100, maxW: 140, sort: (c) => c.userName, render: (c) => c.userName },
    { key: "camp", label: "Campanie", minW: 120, defaultHidden: true, sort: (c) => c.campaignId, render: (c) => <span className="font-mono text-[10px]">{c.campaignId.slice(0, 8)}</span> },
  ];

  const filters = useMemo<Filter<NotifyCallRow>[]>(
    () => [
      {
        kind: "text", key: "q", label: "Caută", grow: true, placeholder: "Caută plătitor, telefon, răspuns, mesaj…",
        test: (c, v) => [c.clientName, c.phone, c.reply, c.text, c.userName].some((x) => (x ?? "").toLowerCase().includes(v.replace(/^\+/, ""))),
      },
      {
        kind: "select", key: "result", label: "Rezultat: toate",
        options: [
          { value: "answered", label: "A răspuns" },
          { value: "no-answer", label: "Fără răspuns" },
          { value: "busy", label: "Ocupat" },
          { value: "failed", label: "Eșuat / anulat" },
          { value: "live", label: "În curs" },
        ],
        test: (c, v) => resultOf(c).key === v,
      },
      {
        kind: "select", key: "heard", label: "Ascultat: toate",
        options: [{ value: "full", label: "Până la capăt (≥ 90%)" }, { value: "part", label: "Parțial (< 90%)" }, { value: "none", label: "Deloc" }],
        test: (c, v) => {
          const p = heardPct(c);
          if (v === "none") return p == null || c.durationSec === 0;
          if (p == null) return false;
          return v === "full" ? p >= 90 : p < 90 && (c.durationSec ?? 0) > 0;
        },
      },
      {
        kind: "select", key: "replied", label: "A spus ceva: toți",
        options: [{ value: "yes", label: "A răspuns / a tastat" }, { value: "no", label: "Fără răspuns" }],
        test: (c, v) => (v === "yes" ? !!replyOf(c) : !replyOf(c)),
      },
      {
        kind: "select", key: "period", label: "Perioadă: toate",
        options: [{ value: "today", label: "Azi" }, { value: "yesterday", label: "Ieri" }, { value: "7", label: "Ultimele 7 zile" }, { value: "30", label: "Ultimele 30 de zile" }],
        test: (c, v) => {
          const k = dayKey(c.at);
          if (v === "today") return k === dayKey(new Date().toISOString());
          if (v === "yesterday") return k === dayKey(new Date(Date.now() - 86_400_000).toISOString());
          return new Date(c.at).getTime() >= Date.now() - Number(v) * 86_400_000;
        },
      },
      { kind: "date", key: "from", label: "De la data", test: (c, v) => dayKey(c.at) >= v },
      { kind: "date", key: "to", label: "Până la data", test: (c, v) => dayKey(c.at) <= v },
    ],
    [],
  );

  return (
    <>
      <DataTable
        storageKey="pbx-notify-calls"
        rows={rows}
        columns={columns}
        filters={filters}
        defaultSort={{ key: "at", dir: "desc" }}
        noun="apeluri de notificare"
        emptyText="Niciun apel de notificare încă. Trimite un apel din Notificări plătitori (canalul „Apel”)."
        onRowClick={(c) => setDetail(c)}
        toolbar={<button type="button" onClick={() => router.refresh()} className={topBtn}>↻ Reîncarcă</button>}
      />
      {detail && <Detail call={rows.find((r) => r.id === detail.id) ?? detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function Detail({ call: c, onClose }: { call: NotifyCallRow; onClose: () => void }) {
  const r = resultOf(c);
  const p = heardPct(c);
  const item = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 px-2.5 py-1.5 text-[13px]">
      <span className="text-ink-soft">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">{c.clientName}</h2>
            <p className="text-xs text-ink-soft">{fmtDateTime(c.at)} · {c.phone}</p>
          </div>
          <button onClick={onClose} className="tap grid size-8 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label="Închide"><IconX className="size-4" /></button>
        </div>
        <div className="divide-y divide-[var(--color-line)] overflow-hidden rounded-lg border border-[var(--color-line)]">
          {item("Rezultat", <span className={`inline-block rounded-full px-1.5 text-[11px] font-medium ${r.cls}`}>{r.label}</span>)}
          {item("Ascultat", c.durationSec == null ? "—" : `${mmss(c.durationSec)}${p != null ? ` (${p}% din mesaj, ≈ ${callSeconds(c.text)} s)` : ""}`)}
          {item("A răspuns", replyOf(c) || <span className="text-ink-soft">nimic</span>)}
          {item("Voce", c.voice ? voiceById(c.voice).label : "—")}
          {item("Trimis de", c.userName)}
          {item("Mesaj", <span className="whitespace-pre-wrap">{c.text}</span>)}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Link href={`/platitori/${c.clientId}`} className="tap inline-flex h-8 cursor-pointer items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">Fișa plătitorului →</Link>
        </div>
      </div>
    </div>
  );
}
