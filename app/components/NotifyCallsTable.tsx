"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DataTable, { type Col, type Filter } from "./DataTable";
import VoicePicker from "./VoicePicker";
import AutoinformDialog from "./AutoinformDialog";
import { useToast } from "./toast";
import { IconX } from "./icons";
import { DEFAULT_VOICE } from "@/lib/payer-notify";
import {
  deleteNotifyCallAction,
  dialNotifyCallAction,
  listPbxOperatorsAction,
  saveNotifyCallNoteAction,
} from "@/app/actions/notify-calls";
import type { PbxUser } from "@/lib/pbx-api";

export type NotifyCallRow = {
  id: string;
  campaignId: string;
  clientId: string;
  clientName: string;
  phone: string;
  /** Mesajul de transmis, cu datele plătitorului. */
  text: string;
  /** Când a fost pus în coadă. */
  at: string;
  dialedAt: string | null;
  operator: string | null;
  callId: string | null;
  /** queued (în coadă) | dialing (apel pornit) | exported (în ZIP-ul pentru autoinformare) */
  status: string;
  note: string | null;
  userName: string;
  // din apelul PBX cu același callId (webhook-ul /api/pbx)
  pbxStatus: string | null;
  pbxState: string | null;
  durationSec: number | null;
  hasRecording: boolean;
  rating: number | null;
};

const TZ = "Europe/Chisinau";
const OPERATOR_KEY = "notify-call-operator";
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const dayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ });
const mmss = (s: number | null) => (s == null ? "—" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);

type Result = { key: string; label: string; cls: string };
function resultOf(c: NotifyCallRow): Result {
  if (c.status === "sent") return { key: "sent", label: "Trimis la gateway", cls: "bg-st-progress/15 text-st-progress" };
  if (c.status === "exported") return { key: "exported", label: "Exportat în PBX", cls: "bg-st-confirmed/15 text-st-confirmed" };
  if (!c.callId) return { key: "queued", label: "În coadă", cls: "bg-st-new/15 text-st-new" };
  switch ((c.pbxStatus ?? "").toLowerCase()) {
    case "success": return { key: "answered", label: "Convorbire", cls: "bg-st-done/15 text-st-done" };
    case "missed": return { key: "noanswer", label: "Nu a răspuns", cls: "bg-st-cancelled/15 text-st-cancelled" };
    case "busy": return { key: "noanswer", label: "Ocupat", cls: "bg-st-noshow/15 text-st-noshow" };
    case "cancel": return { key: "noanswer", label: "Anulat", cls: "bg-st-noshow/15 text-st-noshow" };
    case "notavailable": case "notallowed": case "notfound":
      return { key: "noanswer", label: "Indisponibil", cls: "bg-st-cancelled/15 text-st-cancelled" };
  }
  if (c.pbxState === "ACCEPTED") return { key: "dialing", label: "În convorbire", cls: "bg-st-progress/15 text-st-progress" };
  return { key: "dialing", label: "Se sună…", cls: "bg-st-progress/15 text-st-progress" };
}

const topBtn =
  "tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]";
const selectCls = "h-7 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-1.5 text-[11px] outline-none focus:border-brand";

function readOperator(fallback: string): string {
  try {
    return localStorage.getItem(OPERATOR_KEY) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Coada de apeluri către plătitori (canalul „Apel"). „Sună" → PBX-ul sună întâi operatorul ales, apoi îl leagă cu plătitorul.
 * Starea, durata și înregistrarea vin din apelul PBX (același callId). Aici operatorul vede și mesajul de transmis.
 */
export default function NotifyCallsTable({ rows: serverRows, defaultOperator }: { rows: NotifyCallRow[]; defaultOperator: string }) {
  const router = useRouter();
  const toast = useToast();
  const [local, setLocal] = useState<Record<string, Partial<NotifyCallRow>>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [operator, setOperator] = useState(() => readOperator(defaultOperator || "robot"));
  const [users, setUsers] = useState<PbxUser[] | null>(null);
  const [usersError, setUsersError] = useState<string | null>(null);
  // „Sună toți": apelurile pornesc pe rând (PBX-ul și limita aplicației nu permit sute deodată).
  const [bulk, setBulk] = useState<{ phase: "idle" | "confirm" | "running" | "done"; done: number; total: number; failed: number; lastError: string | null }>({ phase: "idle", done: 0, total: 0, failed: 0, lastError: null });
  const stopBulk = useRef(false);

  // Operatorul folosit la „Sună": cel ales; dacă nu e ales nimic, „robot" din lista PBX (ce vezi în câmp = ce se folosește).
  const robotLogin = users?.find((u) => /robot/i.test(u.login) || /robot/i.test(u.name))?.login ?? "";
  const activeOperator = operator.trim() || robotLogin || "robot";

  const rows = useMemo(
    () => serverRows.filter((r) => !removed.has(r.id)).map((r) => (local[r.id] ? { ...r, ...local[r.id] } : r)),
    [serverRows, local, removed],
  );

  // Operatorii din PBX (pentru alegere); dacă lista nu se poate încărca, operatorul se poate scrie de mână.
  useEffect(() => {
    let alive = true;
    listPbxOperatorsAction()
      .then((r) => {
        if (!alive) return;
        if (r.ok) {
          setUsers(r.users);
          const robot = r.users.find((u) => /robot/i.test(u.login) || /robot/i.test(u.name));
          setOperator((cur) => {
            if (cur || !robot) return cur;
            try { localStorage.setItem(OPERATOR_KEY, robot.login); } catch {}
            return robot.login;
          });
        } else setUsersError(r.error);
      })
      .catch(() => alive && setUsersError("Nu am putut încărca operatorii."));
    return () => { alive = false; };
  }, []);

  // Starea apelurilor vine din webhook-ul PBX — reîmprospătăm discret cât fila e vizibilă.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, 15_000);
    return () => clearInterval(t);
  }, [router]);

  function pickOperator(v: string) {
    setOperator(v);
    try { localStorage.setItem(OPERATOR_KEY, v); } catch {}
  }

  async function dial(c: NotifyCallRow) {
    if (!activeOperator) { toast.error("Alege apelantul (robotul) din câmpul „Apelant” de sus (acum e gol) — apoi apasă din nou „Sună”."); return; }
    setBusy(c.id);
    const res = await dialNotifyCallAction(c.id, activeOperator).catch(() => null);
    setBusy(null);
    if (res?.ok) {
      setLocal((m) => ({ ...m, [c.id]: { ...m[c.id], callId: res.callId, dialedAt: res.dialedAt, operator: res.operator, pbxStatus: null, pbxState: null } }));
      toast.success(`Apel pornit prin „${res.operator}” către ${c.clientName}. Starea apare în tabel în câteva secunde.`);
      router.refresh();
    } else {
      toast.error(res && !res.ok ? res.error : "Nu am putut porni apelul.");
    }
  }

  const queued = rows.filter((r) => !r.callId && r.status === "queued");
  const [exportOpen, setExportOpen] = useState(false);

  async function dialAll() {
    const todo = queued.slice();
    if (!activeOperator || todo.length === 0) return;
    stopBulk.current = false;
    setBulk({ phase: "running", done: 0, total: todo.length, failed: 0, lastError: null });
    let done = 0, failed = 0, streak = 0, lastError: string | null = null;
    for (const c of todo) {
      if (stopBulk.current) break;
      const res = await dialNotifyCallAction(c.id, activeOperator).catch(() => null);
      if (res?.ok) {
        done++; streak = 0;
        setLocal((m) => ({ ...m, [c.id]: { ...m[c.id], callId: res.callId, dialedAt: res.dialedAt, operator: res.operator, pbxStatus: null, pbxState: null } }));
      } else {
        failed++; streak++;
        lastError = res && !res.ok ? res.error : "Nu am putut porni apelul.";
        if (streak >= 3) break; // 3 eșecuri la rând = problemă de configurare/PBX, nu insistăm
      }
      setBulk({ phase: "running", done, total: todo.length, failed, lastError });
      await new Promise((r) => setTimeout(r, 1700));
    }
    setBulk({ phase: "done", done, total: todo.length, failed, lastError });
    router.refresh();
  }

  async function remove(c: NotifyCallRow) {
    setRemoved((s) => new Set(s).add(c.id));
    setDetailId(null);
    const res = await deleteNotifyCallAction(c.id).catch(() => null);
    if (!res?.ok) {
      setRemoved((s) => { const n = new Set(s); n.delete(c.id); return n; });
      toast.error(res && !res.ok ? res.error : "Nu am putut șterge rândul.");
    }
  }

  async function saveNote(c: NotifyCallRow, note: string) {
    const before = c.note;
    setLocal((m) => ({ ...m, [c.id]: { ...m[c.id], note: note.trim() || null } }));
    const res = await saveNotifyCallNoteAction(c.id, note).catch(() => null);
    if (res?.ok) toast.success("Notă salvată.");
    else {
      setLocal((m) => ({ ...m, [c.id]: { ...m[c.id], note: before } }));
      toast.error(res && !res.ok ? res.error : "Nu am putut salva nota.");
    }
  }

  const dash = <span className="text-ink-soft/60">—</span>;
  const columns: Col<NotifyCallRow>[] = [
    { key: "at", label: "În coadă din", minW: 130, sticky: true, sort: (c) => c.at, render: (c) => <span className="whitespace-nowrap">{fmtDateTime(c.at)}</span> },
    {
      key: "client", label: "Plătitor", minW: 170, maxW: 240, sort: (c) => c.clientName,
      render: (c) => (
        <Link href={`/platitori/${c.clientId}`} onClick={(e) => e.stopPropagation()} className="cursor-pointer text-brand hover:underline" title={c.clientName}>{c.clientName}</Link>
      ),
    },
    { key: "phone", label: "Telefon", minW: 110, sort: (c) => c.phone, render: (c) => <span className="font-mono">{c.phone}</span> },
    {
      key: "result", label: "Stare", minW: 100, sort: (c) => resultOf(c).label,
      render: (c) => { const r = resultOf(c); return <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium leading-[14px] ${r.cls}`}>{r.label}</span>; },
    },
    { key: "dur", label: "Durată", minW: 60, right: true, sort: (c) => c.durationSec, render: (c) => (c.durationSec != null ? mmss(c.durationSec) : dash) },
    { key: "op", label: "Apelant", minW: 90, maxW: 130, sort: (c) => c.operator, render: (c) => c.operator ?? dash },
    { key: "dialed", label: "Sunat la", minW: 130, defaultHidden: true, sort: (c) => c.dialedAt, render: (c) => (c.dialedAt ? fmtDateTime(c.dialedAt) : dash) },
    { key: "note", label: "Notă", minW: 160, maxW: 260, sort: (c) => c.note, render: (c) => (c.note ? <span title={c.note}>{c.note}</span> : dash) },
    { key: "text", label: "Mesaj de transmis", minW: 240, maxW: 380, sort: (c) => c.text, render: (c) => <span title={c.text}>{c.text}</span> },
    { key: "by", label: "Pus în coadă de", minW: 100, maxW: 140, defaultHidden: true, sort: (c) => c.userName, render: (c) => c.userName },
    { key: "camp", label: "Campanie", minW: 90, defaultHidden: true, sort: (c) => c.campaignId, render: (c) => <span className="font-mono text-[10px]">{c.campaignId.slice(0, 8)}</span> },
    {
      key: "act", label: "", minW: 96,
      render: (c) => (
        <button
          type="button"
          disabled={busy === c.id}
          onClick={(e) => { e.stopPropagation(); void dial(c); }}
          className="tap h-6 cursor-pointer rounded-md bg-brand px-2 text-[11px] font-semibold text-white hover:bg-brand-strong disabled:cursor-default disabled:opacity-50"
        >
          {busy === c.id ? "…" : c.callId ? "📞 Din nou" : "📞 Sună"}
        </button>
      ),
    },
  ];

  const filters = useMemo<Filter<NotifyCallRow>[]>(
    () => [
      {
        kind: "text", key: "q", label: "Caută", grow: true, placeholder: "Caută plătitor, telefon, notă, mesaj…",
        test: (c, v) => [c.clientName, c.phone, c.note, c.text, c.operator].some((x) => (x ?? "").toLowerCase().includes(v.replace(/^\+/, ""))),
      },
      {
        kind: "select", key: "result", label: "Stare: toate",
        options: [
          { value: "queued", label: "În coadă (neexportate)" },
          { value: "sent", label: "Trimis la gateway" },
          { value: "exported", label: "Exportat în PBX" },
          { value: "dialing", label: "Se sună / în convorbire" },
          { value: "answered", label: "Convorbire încheiată" },
          { value: "noanswer", label: "Nu a răspuns / ocupat" },
        ],
        test: (c, v) => resultOf(c).key === v,
      },
      {
        kind: "select", key: "note", label: "Notă: toate",
        options: [{ value: "yes", label: "Cu notă" }, { value: "no", label: "Fără notă" }],
        test: (c, v) => (v === "yes" ? !!c.note : !c.note),
      },
      {
        kind: "select", key: "rec", label: "Înregistrare: toate",
        options: [{ value: "yes", label: "Cu înregistrare" }, { value: "no", label: "Fără" }],
        test: (c, v) => (v === "yes" ? c.hasRecording : !c.hasRecording),
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

  const detail = detailId ? rows.find((r) => r.id === detailId) ?? null : null;

  return (
    <>
      <DataTable
        storageKey="pbx-notify-calls"
        rows={rows}
        columns={columns}
        filters={filters}
        defaultSort={{ key: "at", dir: "desc" }}
        noun="apeluri de notificare"
        emptyText="Coada e goală. Din Notificări plătitori alege canalul „Apel” și trimite — plătitorii ajung aici, gata de sunat."
        onRowClick={(c) => setDetailId(c.id)}
        toolbar={
          <>
            <label className="flex items-center gap-1 text-[11px] text-ink-soft">
              Apelant:
              <input
                list="notify-callers"
                value={operator}
                onChange={(e) => pickOperator(e.target.value)}
                placeholder="robot"
                title={usersError ?? "Extensia din PBX care face apelul (robotul) — scrie loginul sau alege din listă"}
                className={`${selectCls} w-28`}
              />
              <datalist id="notify-callers">
                {(users ?? []).map((u) => (
                  <option key={u.login} value={u.login}>{u.name}{u.ext ? ` (${u.ext})` : ""}</option>
                ))}
              </datalist>
            </label>
            <button type="button" disabled={queued.length === 0} onClick={() => setExportOpen(true)} className={`${topBtn} border-brand text-brand disabled:cursor-default disabled:opacity-40`} title="Pregătește ZIP-ul (numere + audio per plătitor) pentru PBX → Autoinformare">
              ⬇ Export autoinformare ({queued.length})
            </button>
            {bulk.phase === "idle" || bulk.phase === "done" ? (
              <button type="button" disabled={queued.length === 0 || !activeOperator} onClick={() => setBulk((b) => ({ ...b, phase: "confirm" }))} className={`${topBtn} disabled:cursor-default disabled:opacity-40`} title={activeOperator ? "Pornește apelurile pe rând, prin operatorul ales" : "Alege întâi apelantul (robotul)"}>
                📞 Sună toți din coadă ({queued.length})
              </button>
            ) : bulk.phase === "confirm" ? (
              <>
                <button type="button" onClick={() => void dialAll()} className="tap inline-flex h-7 cursor-pointer items-center rounded-lg bg-brand px-2 text-[11px] font-semibold text-white hover:bg-brand-strong">Confirmă: sună {queued.length} prin „{activeOperator}”</button>
                <button type="button" onClick={() => setBulk((b) => ({ ...b, phase: "idle" }))} className={topBtn}>Anulează</button>
              </>
            ) : (
              <>
                <span className="text-[11px] text-ink-soft">Se sună… {bulk.done + bulk.failed}/{bulk.total}</span>
                <button type="button" onClick={() => { stopBulk.current = true; }} className={topBtn}>■ Oprește</button>
              </>
            )}
            <button type="button" onClick={() => router.refresh()} className={topBtn}>↻ Reîncarcă</button>
          </>
        }
      />
      {bulk.phase === "done" && (
        <p className={`mt-1.5 text-[11px] ${bulk.failed ? "text-st-progress" : "text-st-done"}`}>
          Apeluri pornite: {bulk.done} din {bulk.total}{bulk.failed ? ` · eșuate: ${bulk.failed}${bulk.lastError ? ` (${bulk.lastError})` : ""}` : ""}.
        </p>
      )}
      {usersError && <p className="mt-1.5 text-[11px] text-st-progress">Lista de operatori nu s-a încărcat ({usersError}) — scrie loginul sau numărul scurt al robotului în câmpul „Apelant”.</p>}
      {exportOpen && (
        <AutoinformDialog
          rows={queued.map((r) => ({ id: r.id, phone: r.phone, clientName: r.clientName, text: r.text }))}
          onClose={() => setExportOpen(false)}
          onExported={(ids) => setLocal((m) => { const n = { ...m }; for (const id of ids) n[id] = { ...n[id], status: "exported", operator: "autoinformare" }; return n; })}
        />
      )}
      {detail && (
        <Detail
          call={detail}
          busy={busy === detail.id}
          onClose={() => setDetailId(null)}
          caller={operator}
          onCaller={pickOperator}
          onDial={() => void dial(detail)}
          onRemove={() => void remove(detail)}
          onSaveNote={(n) => void saveNote(detail, n)}
        />
      )}
    </>
  );
}

function Detail({
  call: c, busy, caller, onCaller, onClose, onDial, onRemove, onSaveNote,
}: {
  call: NotifyCallRow;
  busy: boolean;
  caller: string;
  onCaller: (v: string) => void;
  onClose: () => void;
  onDial: () => void;
  onRemove: () => void;
  onSaveNote: (note: string) => void;
}) {
  const r = resultOf(c);
  const [note, setNote] = useState(c.note ?? "");
  const [voice, setVoice] = useState<string>(DEFAULT_VOICE);
  const [confirmDel, setConfirmDel] = useState(false);
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
            <p className="text-xs text-ink-soft">{c.phone} · în coadă din {fmtDateTime(c.at)}</p>
          </div>
          <button onClick={onClose} className="tap grid size-8 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label="Închide"><IconX className="size-4" /></button>
        </div>

        <div className="mb-3 rounded-lg border border-brand/30 bg-brand/5 p-2.5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Mesaj de transmis</p>
          <p className="mb-2 whitespace-pre-wrap text-[13px]">{c.text}</p>
          <VoicePicker voice={voice} text={c.text} onChange={setVoice} compact />
        </div>

        <div className="divide-y divide-[var(--color-line)] overflow-hidden rounded-lg border border-[var(--color-line)]">
          {item("Stare", <span className={`inline-block rounded-full px-1.5 text-[11px] font-medium ${r.cls}`}>{r.label}</span>)}
          {item("Durată convorbire", c.durationSec != null ? mmss(c.durationSec) : "—")}
          {item("Apelant", c.operator ?? "—")}
          {item("Sunat la", c.dialedAt ? fmtDateTime(c.dialedAt) : "—")}
          {c.rating != null && item("Notă client", `${c.rating}/5`)}
          {item("Pus în coadă de", c.userName)}
        </div>

        {c.hasRecording && c.callId && (
          <div className="mt-3">
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Înregistrare</p>
            <audio controls preload="none" src={`/api/pbx/recording?callId=${encodeURIComponent(c.callId)}`} className="h-10 w-full" />
          </div>
        )}

        <div className="mt-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Notă (ce a spus plătitorul)</p>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="ex. Promite că plătește vineri / nu mai locuiește la adresă…"
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-2 text-sm outline-none focus:border-brand"
          />
          <button type="button" onClick={() => onSaveNote(note)} disabled={note.trim() === (c.note ?? "")} className="tap mt-1.5 h-8 cursor-pointer rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong disabled:cursor-default disabled:opacity-40">
            Salvează nota
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line)] pt-3">
          <label className="flex items-center gap-1 text-xs text-ink-soft">
            Apelant:
            <input
              list="notify-callers"
              value={caller}
              onChange={(e) => onCaller(e.target.value)}
              placeholder="robot"
              className="h-8 w-28 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-xs outline-none focus:border-brand"
            />
          </label>
          <button type="button" onClick={onDial} disabled={busy} className="tap h-8 cursor-pointer rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong disabled:cursor-default disabled:opacity-50">
            {busy ? "Se sună…" : c.callId ? "📞 Sună din nou" : "📞 Sună"}
          </button>
          <Link href={`/platitori/${c.clientId}`} className="tap inline-flex h-8 cursor-pointer items-center rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft">Fișa plătitorului →</Link>
          <span className="ml-auto" />
          {confirmDel ? (
            <>
              <button type="button" onClick={onRemove} className="tap h-8 cursor-pointer rounded-lg bg-st-cancelled px-3 text-xs font-semibold text-white">Șterge din coadă</button>
              <button type="button" onClick={() => setConfirmDel(false)} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs">Nu</button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmDel(true)} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs text-st-cancelled hover:bg-[var(--color-surface-2)]">🗑 Șterge</button>
          )}
        </div>
      </div>
    </div>
  );
}
