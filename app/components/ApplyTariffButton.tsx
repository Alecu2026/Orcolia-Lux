"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";

type Stats = {
  invoicesEligible: number;
  invoicesChanged: number;
  invoicesSkippedNoMatchingItem: number;
  itemsWithZeroQtyLeftAlone: number;
  oldTotalDue: number;
  newTotalDue: number;
};
type Applied = { invoicesUpdated: number; itemsUpdated: number };
type Phase = "idle" | "loading" | "preview" | "committing" | "done" | "error";

function money(n: number) {
  return `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MDL`;
}

/**
 * Buton separat de "Salvează" — tariful din formular afectează DOAR facturile Apă-Canal
 * create de acum înainte (fiecare linie de factură își reține propriul tarif la creare).
 * Acest buton citește tariful DEJA salvat (nu ce e tastat, nesalvat, în câmpuri — de-aia
 * cere Salvează întâi) și oferă, separat, opțiunea explicită de a-l aplica retroactiv și pe
 * facturile existente NEPLĂTITE (nu atinge niciodată facturi plătite/anulate).
 */
export default function ApplyTariffButton({ hasSavedTariff }: { hasSavedTariff: boolean }) {
  const t = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [tarife, setTarife] = useState<{ apa: number; canal: number } | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function loadPreview() {
    setOpen(true);
    setPhase("loading");
    setError(null);
    try {
      const res = await fetch("/api/invoices/apply-tariff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Eroare");
      setTarife({ apa: data.tarifApa, canal: data.tarifCanal });
      setStats(data.stats as Stats);
      setPhase("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare");
      setPhase("error");
    }
  }

  async function confirm() {
    setPhase("committing");
    setError(null);
    try {
      const res = await fetch("/api/invoices/apply-tariff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Eroare");
      setApplied(data.applied as Applied);
      setPhase("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eroare");
      setPhase("error");
    }
  }

  function close() {
    setOpen(false);
    setPhase("idle");
    setStats(null);
    setApplied(null);
    setError(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={loadPreview}
        disabled={!hasSavedTariff}
        title={!hasSavedTariff ? "Salvează întâi un tarif mai mare ca 0" : ""}
        className="tap h-10 rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
      >
        {t("Aplică tariful salvat și la facturile existente")}
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget && phase !== "loading" && phase !== "committing") close(); }}
        >
          <div className="card w-full max-w-md rounded-2xl p-6 shadow-xl">
            {(phase === "loading" || phase === "committing") && (
              <div className="flex flex-col items-center gap-3 py-6">
                <svg className="size-7 animate-spin text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                <p className="text-sm text-ink-soft">{phase === "loading" ? "Se calculează..." : "Se actualizează facturile..."}</p>
              </div>
            )}

            {phase === "preview" && stats && tarife && (
              <>
                <h2 className="mb-1 text-base font-semibold">{t("Aplică tarif nou la facturile existente")}</h2>
                <p className="mb-4 text-xs text-ink-soft">
                  Tarif: apă {tarife.apa} lei/m³ · canalizare {tarife.canal} lei/m³ — se aplică doar facturilor NEACHITATE.
                </p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <Stat label={t("Facturi eligibile (neachitate)")} value={stats.invoicesEligible} />
                  <Stat label={t("Vor fi modificate")} value={stats.invoicesChanged} />
                  <Stat label={t("Fără linii de consum (neschimbate)")} value={stats.invoicesSkippedNoMatchingItem} />
                  <Stat label={t("Linii cu volum 0 (păstrate)")} value={stats.itemsWithZeroQtyLeftAlone} />
                </dl>
                <div className="mt-3 rounded-xl bg-[var(--color-surface-2)] p-3 text-sm">
                  <div className="flex justify-between"><span className="text-ink-soft">{t("Total datorat acum")}</span><span className="font-semibold">{money(stats.oldTotalDue)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">{t("Total datorat după")}</span><span className="font-semibold">{money(stats.newTotalDue)}</span></div>
                  <div className="mt-1 flex justify-between border-t border-[var(--color-line)] pt-1">
                    <span className="text-ink-soft">{t("Diferență")}</span>
                    <span className={`font-semibold ${stats.newTotalDue - stats.oldTotalDue >= 0 ? "text-st-progress" : "text-st-done"}`}>
                      {stats.newTotalDue - stats.oldTotalDue >= 0 ? "+" : ""}{money(round2(stats.newTotalDue - stats.oldTotalDue))}
                    </span>
                  </div>
                </div>
                {stats.invoicesChanged === 0 ? (
                  <button type="button" onClick={close} className="tap mt-4 h-11 w-full rounded-xl bg-[var(--color-surface-2)] text-sm font-medium hover:bg-[var(--color-line)]">
                    {t("Închide")}
                  </button>
                ) : (
                  <div className="mt-4 flex gap-2">
                    <button type="button" onClick={close} className="tap h-11 flex-1 rounded-xl border border-[var(--color-line)] text-sm font-medium hover:bg-[var(--color-surface-2)]">
                      {t("Anulează")}
                    </button>
                    <button type="button" onClick={confirm} className="tap h-11 flex-1 rounded-xl bg-brand text-sm font-semibold text-white hover:bg-brand-strong">
                      {t("Confirmă și aplică")}
                    </button>
                  </div>
                )}
              </>
            )}

            {phase === "done" && applied && (
              <>
                <p className="mb-2 text-sm font-semibold text-st-done">{t("Actualizare finalizată")}</p>
                <p className="mb-4 text-sm text-ink-soft">
                  Facturi actualizate: {applied.invoicesUpdated}, linii: {applied.itemsUpdated}.
                </p>
                <button type="button" onClick={close} className="tap h-11 w-full rounded-xl bg-[var(--color-surface-2)] text-sm font-medium hover:bg-[var(--color-line)]">
                  {t("Închide")}
                </button>
              </>
            )}

            {phase === "error" && (
              <>
                <p className="mb-2 text-sm font-semibold text-st-cancelled">{t("Eroare")}</p>
                <p className="mb-4 text-sm text-ink-soft">{error}</p>
                <button type="button" onClick={close} className="tap h-11 w-full rounded-xl bg-[var(--color-surface-2)] text-sm font-medium hover:bg-[var(--color-line)]">
                  {t("Închide")}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] px-2.5 py-1.5">
      <dt className="text-[11px] text-ink-soft">{label}</dt>
      <dd className="text-sm font-semibold">{value.toLocaleString("ro-RO")}</dd>
    </div>
  );
}
