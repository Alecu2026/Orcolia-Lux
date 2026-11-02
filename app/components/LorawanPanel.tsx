"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { activateLorawanAction, lorawanStatusAction, runLorawanAction } from "@/app/actions/lorawan";
import type { LorawanStatus } from "@/lib/lorawan";
import LorawanDiagTable from "./LorawanDiagTable";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";

/** Starea extragerii LoRaWAN + butonul „Rulează acum”. Cât rulează o extragere, starea se reîmprospătează la câteva secunde. */
export default function LorawanPanel({ initial }: { initial: LorawanStatus }) {
  const t = useT();
  const tag = dateTag(useLocale());
  const [st, setSt] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  /** O extragere tocmai pornită: starea se verifică la câteva secunde până apare rezultatul ei (jobul din fundal poate începe cu o clipă de întârziere). */
  const [watching, setWatching] = useState(false);
  const startedAt = useRef(0);

  const refresh = useCallback(async () => {
    const s = await lorawanStatusAction().catch(() => null);
    if (s) {
      setSt(s);
      // gata: nu mai rulează și există un rezultat mai nou decât momentul pornirii (sau au trecut 10 minute)
      if (!s.running && ((s.lastRunAt && new Date(s.lastRunAt).getTime() >= startedAt.current - 2000) || Date.now() - startedAt.current > 600_000)) setWatching(false);
    }
    return s;
  }, []);

  useEffect(() => {
    if (!st.running && !watching) return;
    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [st.running, watching, refresh]);

  const run = async (activate = false) => {
    setBusy(true);
    setErr(null);
    const r = await (activate ? activateLorawanAction() : runLorawanAction()).catch(() => ({ ok: false, error: "Nu am putut porni extragerea." }));
    if (!r.ok) setErr(t(r.error ?? "Nu am putut porni extragerea."));
    else {
      startedAt.current = Date.now();
      setWatching(true);
      setSt((s) => ({ ...s, running: true }));
    }
    setBusy(false);
  };

  const s = st.stats;
  const nf = (n: number) => n.toLocaleString(tag);
  const cell = (label: string, value: number, hint?: string) => (
    <div className="rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3" title={hint}>
      <p className="text-[11px] text-ink-soft">{label}</p>
      <p className="text-lg font-bold tabular-nums">{nf(value)}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4" data-lorawan-panel="">
      {!st.configured && <p className="rounded-xl bg-st-progress/10 p-3 text-sm font-medium text-st-progress">{t("Extragerea nu e configurată: lipsește LORAWAN_TOKEN în configurația serverului.")}</p>}

      {!st.activated && (
        <div className="rounded-2xl border border-brand/40 bg-brand-soft/40 p-4" data-lorawan-activate="">
          <p className="text-sm font-semibold">{t("Extragerea LoRaWAN nu e activată încă")}</p>
          <p className="mt-1 text-sm text-ink-soft">{t("Prima apăsare citește acum toate contoarele LoRaWAN, le potrivește cu cele din CRM și salvează citirile lunii curente. Dacă reușește, extragerea automată zilnică (23:30) pornește de-acum, iar acest buton dispare.")}</p>
          <button
            type="button"
            onClick={() => void run(true)}
            disabled={busy || watching || st.running || !st.configured}
            data-lorawan-activate-btn=""
            className="tap mt-3 h-10 cursor-pointer rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            {st.running || watching ? t("Se activează…") : t("Activează LoRaWAN")}
          </button>
        </div>
      )}

      <div className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">
              {st.running ? t("Extragerea rulează…") : st.lastRunAt ? (st.lastOk ? `✓ ${t("Ultima extragere")}` : `⚠ ${t("Ultima extragere a eșuat")}`) : t("Încă nu a rulat nicio extragere.")}
            </p>
            {st.lastRunAt && !st.running && (
              <p className="text-xs text-ink-soft">
                {new Date(st.lastRunAt).toLocaleString(tag, { dateStyle: "medium", timeStyle: "short" })} · {st.lastTrigger === "manual" ? t("pornită manual") : t("automat")} · {Math.round(st.durationMs / 1000)} s
              </p>
            )}
            {st.message && <p className={`mt-1 text-sm ${st.lastOk || st.running ? "" : "text-st-cancelled"}`}>{st.message}</p>}
          </div>
          {st.activated && (
            <button
              type="button"
              onClick={() => void run()}
              disabled={busy || watching || st.running || !st.configured}
              className="tap h-10 cursor-pointer rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
            >
              {st.running || watching ? t("Rulează…") : t("Rulează acum")}
            </button>
          )}
        </div>
        {err && <p className="mt-2 text-sm text-st-cancelled">{err}</p>}
        <p className="mt-2 text-xs text-ink-soft">{t("Contoare marcate LoRaWAN în CRM")}: <b>{nf(st.known)}</b></p>
      </div>

      {s && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {cell(t("Primite"), s.received)}
          {cell(t("Citiri salvate"), s.saved, t("Indexuri noi sau schimbate față de ieri"))}
          {cell(t("Neschimbate"), s.unchanged)}
          {cell(t("Ignorate (altă lună)"), s.stale, t("Ultima transmisie nu e din luna curentă"))}
          {cell(t("Fără nicio transmisie"), s.placeholders ?? 0, t("Înregistrate pe serverul LoRaWAN, dar cu 0 m³ la o dată fixă: nu au transmis niciodată"))}
          {cell(t("Negăsite în CRM"), s.unmatched)}
          {(s.bySuffix ?? 0) > 0 && cell(t("Potrivite prin sufix"), s.bySuffix, t("Contoare din CRM cu sufix (-wc, -bc) după număr: citirea LoRaWAN s-a atribuit lor"))}
          {cell(t("Scoase din uz în CRM"), s.removed)}
          {cell(t("Fără plătitor"), s.noPayer, t("Contorul există în CRM, dar nu e legat de un plătitor"))}
          {cell(t("Citite deja în teren"), s.skippedField, t("Luna are o citire făcută de cititor: nu se suprascrie"))}
          {cell(t("Index mai mic decât cel anterior"), s.lowerThanPrev, t("Contor înlocuit sau transmisie greșită — de verificat"))}
          {cell(t("Erori"), s.errors)}
        </div>
      )}

      <LorawanDiagTable />

      {st.unmatched.length > 0 && (
        <details className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <summary className="cursor-pointer text-sm font-semibold">{t("Numere de contor fără corespondent în CRM")} ({nf(s?.unmatched ?? st.unmatched.length)})</summary>
          <p className="mt-2 text-xs text-ink-soft">{t("Primele {n} numere (fără prefixul S):", { n: st.unmatched.length })}</p>
          <p className="mt-1 break-words font-mono text-xs leading-relaxed">{st.unmatched.join(" · ")}</p>
        </details>
      )}
    </div>
  );
}
