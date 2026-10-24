"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { savePbxCallNoteAction } from "@/app/actions/pbx";
import type { CallerContext } from "@/lib/services/pbx";
import { IconX } from "./icons";
import { useToast } from "./toast";
import { useT } from "@/lib/i18n/context";

type ActiveCall = {
  callId: string;
  direction: string | null;
  phone: string | null;
  diversion: string | null;
  operator: string | null;
  ext: string | null;
  status: string | null;
  state: string | null;
  finished: boolean;
  at: string;
  note: string | null;
  context: CallerContext | null;
};

const POLL_MS = 4000;
const pretty = (p: string | null) => (p ? (p.startsWith("373") ? `+${p}` : p) : "număr necunoscut");
const money = (n: number) => `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MDL`;

/** Textul pentru căutarea în Plătitori: ultimele 8 cifre se potrivesc indiferent cum e scris telefonul (069…, +373…). */
export const phoneQuery = (p: string | null) => (p ? p.replace(/\D/g, "").slice(-8) : "");

function stateLabel(c: ActiveCall): { text: string; cls: string } {
  if (c.status) {
    const s = c.status.toLowerCase();
    if (s === "success") return { text: "Încheiat", cls: "bg-st-done/15 text-st-done" };
    if (s === "missed") return { text: "Pierdut", cls: "bg-st-cancelled/15 text-st-cancelled" };
    return { text: c.status, cls: "bg-st-noshow/15 text-st-noshow" };
  }
  if (c.state === "ACCEPTED") return { text: "În convorbire", cls: "bg-st-progress/15 text-st-progress" };
  if (c.state === "COMPLETED") return { text: "Încheiat", cls: "bg-st-done/15 text-st-done" };
  if (c.state === "CANCELLED") return { text: "Anulat", cls: "bg-st-noshow/15 text-st-noshow" };
  return { text: "Sună…", cls: "bg-st-new/15 text-st-new animate-pulse" };
}

/**
 * Popup „Apel primit": când sună cineva pe numărul companiei, apare cardul cu cine e (dacă există în CRM/Plătitori), datele
 * curente (datorie, tichete deschise, ultima notiță) și acțiuni rapide: fișa, filtru în Plătitori, tichet/task cu datele
 * preîncărcate, notă despre apel. Datele se verifică la câteva secunde cât fila e vizibilă; un apel închis manual nu reapare.
 */
export default function IncomingCallPopup({ canEdit = true }: { canEdit?: boolean }) {
  const [calls, setCalls] = useState<ActiveCall[]>([]);
  const dismissed = useRef<Set<string>>(new Set());
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      if (document.visibilityState === "visible") {
        try {
          const r = await fetch("/api/pbx/active", { cache: "no-store" });
          if (r.ok) {
            const j = (await r.json()) as { calls: ActiveCall[] };
            if (alive) setCalls(j.calls.filter((c) => !dismissed.current.has(c.callId)));
          }
        } catch {}
      }
      if (alive) timer = setTimeout(tick, POLL_MS);
    }
    tick();
    return () => { alive = false; clearTimeout(timer); };
  }, []);

  // O scurtă notificare sonoră la un apel nou primit (dacă browserul permite sunete).
  useEffect(() => {
    for (const c of calls) {
      if (!seen.current.has(c.callId)) {
        seen.current.add(c.callId);
        if (!c.finished && c.direction !== "out") {
          try {
            const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
            if (Ctx) {
              const ctx = new Ctx();
              const o = ctx.createOscillator();
              const g = ctx.createGain();
              o.type = "sine"; o.frequency.value = 880; g.gain.value = 0.05;
              o.connect(g); g.connect(ctx.destination);
              o.start(); o.stop(ctx.currentTime + 0.25);
            }
          } catch {}
        }
      }
    }
  }, [calls]);

  if (calls.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-[80] flex flex-col items-center gap-2 px-2 sm:inset-x-auto sm:right-3 sm:items-end">
      {calls.map((c) => (
        <CallCard key={c.callId} call={c} canEdit={canEdit} onDismiss={() => { dismissed.current.add(c.callId); setCalls((cur) => cur.filter((x) => x.callId !== c.callId)); }} />
      ))}
    </div>
  );
}

function CallCard({ call: c, canEdit, onDismiss }: { call: ActiveCall; canEdit: boolean; onDismiss: () => void }) {
  const tr = useT();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(c.note);
  const ctx = c.context;
  const st = stateLabel(c);
  const q = phoneQuery(c.phone);
  const callTitle = `Apel de la ${ctx?.name ?? pretty(c.phone)}`;
  const prefill = (kind: "ticket" | "task") => {
    const sp = new URLSearchParams({
      create: kind,
      ...(ctx?.clientId ? { client: ctx.clientId } : {}),
      title: callTitle,
      desc: `Apel ${c.direction === "out" ? "efectuat către" : "primit de la"} ${pretty(c.phone)} (${new Date(c.at).toLocaleString("ro-RO", { timeZone: "Europe/Chisinau", dateStyle: "short", timeStyle: "short" })}).`,
    });
    return `/${kind === "ticket" ? "tickets" : "tasks"}?${sp.toString()}`;
  };

  async function saveNote() {
    const text = note.trim();
    if (!text) return;
    setSaving(true);
    const res = await savePbxCallNoteAction(c.callId, text).catch(() => null);
    setSaving(false);
    if (res?.ok) { setSaved((s) => (s ? `${s}\n${res.note}` : res.note)); setNote(""); toast.success(ctx ? "Notă salvată (și pe fișa clientului)." : "Notă salvată."); }
    else toast.error(res && !res.ok ? res.error : "Nu am putut salva nota.");
  }

  const btn = "tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2.5 text-[11px] font-medium hover:bg-brand-soft";
  return (
    <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-brand/40 bg-[var(--color-surface)] p-3 shadow-2xl ring-1 ring-brand/20">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
            📞 {c.direction === "out" ? "Apel efectuat" : "Apel primit"}
            <span className={`ml-2 rounded-full px-1.5 py-px text-[10px] normal-case ${st.cls}`}>{st.text}</span>
          </p>
          <p className="truncate text-base font-bold">{ctx?.name ?? pretty(c.phone)}</p>
          <p className="text-xs text-ink-soft">
            {ctx ? `${pretty(c.phone)} · ` : ""}
            {c.operator ? `răspunde ${c.operator}${c.ext ? ` (ext. ${c.ext})` : ""}` : c.diversion ? `pe ${pretty(c.diversion)}` : ""}
          </p>
        </div>
        <button onClick={onDismiss} className="tap grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={tr("Închide")}>
          <IconX className="size-4" />
        </button>
      </div>

      {ctx ? (
        <div className="mb-2 divide-y divide-[var(--color-line)] overflow-hidden rounded-lg border border-[var(--color-line)] text-[12px]">
          <Row label={ctx.isPayer ? "Plătitor" : "Client CRM"}>{ctx.account ? `cont ${ctx.account}` : "—"}</Row>
          {ctx.address && <Row label={tr("Adresă")}>{ctx.address}</Row>}
          {ctx.debt != null && (
            <Row label={tr("De achitat")}>
              <b className={ctx.debt > 0 ? "text-st-cancelled" : "text-st-done"}>{money(ctx.debt)}</b>
              {ctx.invoiceStatus && <span className="ml-1 text-ink-soft">({ctx.invoiceStatus.toLowerCase()})</span>}
            </Row>
          )}
          <Row label={tr("Cereri deschise")}>
            {ctx.openTicketCount === 0 ? "niciunul" : (
              <span className="flex flex-col items-end gap-0.5">
                {ctx.openTickets.map((t) => (
                  <Link key={t.id} href={`/tickets/${t.id}`} className="max-w-[14rem] cursor-pointer truncate text-brand hover:underline" title={t.title}>
                    {t.seq != null ? `#${t.seq} ` : ""}{t.title}
                  </Link>
                ))}
                {ctx.openTicketCount > ctx.openTickets.length && <span className="text-ink-soft">+{ctx.openTicketCount - ctx.openTickets.length} altele</span>}
              </span>
            )}
          </Row>
          {ctx.lastNote && <Row label={tr("Ultima notiță")}><span className="line-clamp-2 text-left">{ctx.lastNote.body}</span></Row>}
        </div>
      ) : (
        <p className="mb-2 rounded-lg bg-st-progress/10 px-2.5 py-1.5 text-[12px] text-st-progress">
          {tr("Numărul nu e în clienți. Caută-l în Plătitori (formatul telefonului poate fi diferit) sau creează un client.")}
        </p>
      )}

      <div className="mb-2 flex flex-wrap gap-1.5">
        {ctx?.isPayer && <Link href={`/platitori/${ctx.clientId}`} className={`${btn} bg-brand text-white hover:bg-brand-strong`}>{tr("Fișa plătitorului →")}</Link>}
        {q && <Link href={`/platitori?q=${q}`} className={btn}>{tr("🔎 Filtrează în Plătitori")}</Link>}
        {!ctx && <Link href="/clients?create=1" className={btn}>{tr("+ Client nou")}</Link>}
        {canEdit && <Link href={prefill("ticket")} className={btn}>{tr("🎫 Cerere")}</Link>}
        {canEdit && <Link href={prefill("task")} className={btn}>{tr("✔ Sarcină")}</Link>}
      </div>

      {canEdit && (
        <div>
          {saved && <p className="mb-1 whitespace-pre-wrap rounded bg-[var(--color-surface-2)] px-2 py-1 text-[11px] text-ink-soft">{saved}</p>}
          <div className="flex gap-1.5">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void saveNote(); } }}
              placeholder={tr("Notă despre apel (ce a cerut)… Enter = salvează")}
              className="h-8 min-w-0 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-[12px] outline-none focus:border-brand"
            />
            <button type="button" onClick={saveNote} disabled={saving || !note.trim()} className="tap h-8 cursor-pointer rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong disabled:cursor-default disabled:opacity-40">
              {saving ? "…" : "Salvează"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 px-2.5 py-1">
      <span className="shrink-0 text-[11px] text-ink-soft">{label}</span>
      <span className="min-w-0 break-words text-right">{children}</span>
    </div>
  );
}
