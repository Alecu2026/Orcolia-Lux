"use client";

import { useState, type ReactNode } from "react";
import { MEASURES_MAX, formatElapsed, validateResolution, type Resolution } from "@/lib/resolution";
import { useT } from "@/lib/i18n/context";
import { IconX } from "./icons";

export type ResolutionAsk = {
  /** Titlul cererii (afișat în fereastră). */
  title?: string | null;
  /** Când a fost depusă cererea: din ea se arată „timp scurs de la depunere”. */
  createdAt?: string | number | Date | null;
  /** Valori de pornire (la corectarea unei rezolvări existente). */
  initial?: { measures?: string | null; minutes?: number | null };
  /** Textul butonului de confirmare (implicit „Finalizează cererea”). */
  confirmLabel?: string;
};

const fld = "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

function Dialog({ ask, onSubmit, onClose }: { ask: ResolutionAsk; onSubmit: (r: Resolution) => void; onClose: () => void }) {
  const t = useT();
  const init = ask.initial?.minutes;
  const [measures, setMeasures] = useState(ask.initial?.measures ?? "");
  const [hours, setHours] = useState(init != null ? String(Math.floor(init / 60)) : "");
  const [mins, setMins] = useState(init != null ? String(init % 60) : "");
  const [error, setError] = useState<string | null>(null);
  const created = ask.createdAt != null ? new Date(ask.createdAt).getTime() : NaN;
  // eslint-disable-next-line react-hooks/purity -- momentul curent afișat la randare (valoare de afișare, nu stare)
  const elapsed = Number.isFinite(created) ? formatElapsed(Date.now() - created, t) : null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const h = hours.trim() === "" ? null : Number(hours);
    const m = mins.trim() === "" ? null : Number(mins);
    if ((h != null && (!Number.isFinite(h) || h < 0)) || (m != null && (!Number.isFinite(m) || m < 0))) return setError(t("Timpul de rezolvare e invalid."));
    const minutes = h == null && m == null ? null : Math.round((h ?? 0) * 60 + (m ?? 0));
    const r = { measures: measures.trim(), minutes };
    const bad = validateResolution(r);
    if (bad) return setError(t(bad));
    setError(null);
    onSubmit(r);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="card w-full max-w-md rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl" role="dialog" aria-label={t("Finalizare cerere")}>
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold">{t("Finalizare cerere")}</h2>
            {ask.title && <p className="mt-0.5 truncate text-xs text-ink-soft">{ask.title}</p>}
          </div>
          <button type="button" onClick={onClose} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>
            <IconX className="size-4" />
          </button>
        </div>

        <label className="mb-1 block text-xs font-semibold text-ink-soft" htmlFor="res-measures">{t("Măsuri luate")} *</label>
        <textarea
          id="res-measures"
          name="measures"
          value={measures}
          onChange={(e) => setMeasures(e.target.value)}
          rows={4}
          maxLength={MEASURES_MAX}
          autoFocus
          placeholder={t("Descrie ce s-a făcut (ex. contor înlocuit, sigiliu pus, recalculare efectuată)")}
          className={`${fld} py-2`}
        />

        <p className="mb-1 mt-3 text-xs font-semibold text-ink-soft">{t("Timp de rezolvare")}</p>
        <div className="flex items-center gap-2">
          <input name="hours" type="number" min={0} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} className={`${fld} h-11 w-24`} aria-label={t("ore")} placeholder="0" />
          <span className="text-sm text-ink-soft">{t("ore")}</span>
          <input name="minutes" type="number" min={0} inputMode="numeric" value={mins} onChange={(e) => setMins(e.target.value)} className={`${fld} h-11 w-24`} aria-label={t("minute")} placeholder="0" />
          <span className="text-sm text-ink-soft">{t("minute")}</span>
        </div>
        {elapsed && <p className="mt-1 text-[11px] text-ink-soft">{t("Timp scurs de la depunere: {v}", { v: elapsed })}</p>}

        {error && <p className="mt-2 text-sm text-st-cancelled">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="tap h-11 cursor-pointer rounded-xl border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)]">{t("Anulează")}</button>
          <button type="submit" className="tap h-11 cursor-pointer rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong">{ask.confirmLabel ?? t("Finalizează cererea")}</button>
        </div>
      </form>
    </div>
  );
}

/**
 * Fereastra „Finalizare cerere” (măsuri luate + timp de rezolvare), în același stil ca cererea de dovadă (useProofPrompt): serverul răspunde `needsResolution`,
 * interfața cheamă `ask(...)`, iar după confirmare reia finalizarea cu valorile completate.
 */
export function useResolutionPrompt(): { ask: (info: ResolutionAsk, submit: (r: Resolution) => void) => void; node: ReactNode } {
  const [state, setState] = useState<{ ask: ResolutionAsk; submit: (r: Resolution) => void; key: number } | null>(null);
  return {
    ask: (info, submit) => setState({ ask: info, submit, key: Date.now() }),
    node: state ? <Dialog key={state.key} ask={state.ask} onSubmit={state.submit} onClose={() => setState(null)} /> : null,
  };
}
