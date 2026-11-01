"use client";

import { useState, useTransition } from "react";
import { confirmReadingAction, disputeReadingAction } from "@/app/actions/reading-verify";
import { useT } from "@/lib/i18n/context";

/** Butoanele „Confirm” / „Nu este corectă” de pe pagina de verificare a citirii. */
export default function ReadingVerifyForm({ token, initial }: { token: string; initial: "confirmed" | "disputed" | null }) {
  const t = useT();
  const [status, setStatus] = useState<"confirmed" | "disputed" | null>(initial);
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function run(fn: () => ReturnType<typeof confirmReadingAction>) {
    setError("");
    start(async () => {
      const r = await fn();
      if (r.ok) { setStatus(r.status); setDisputing(false); }
      else setError(r.error);
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {status && (
        <p className={`rounded-xl px-3 py-3 text-sm font-medium ${status === "confirmed" ? "bg-brand-soft text-brand-strong" : "bg-st-progress/15 text-st-progress"}`} role="status" data-verify-status={status}>
          {status === "confirmed" ? t("Mulțumim! Citirea a fost confirmată.") : t("Am înregistrat contestația. Un angajat va verifica citirea și vă va contacta.")}
        </p>
      )}
      {error && <p className="text-sm text-st-cancelled" role="alert">{t(error)}</p>}

      {!disputing && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" disabled={pending || status === "confirmed"} onClick={() => run(() => confirmReadingAction(token))} data-verify-confirm="" className="tap h-12 flex-1 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-50">
            {t("Confirm: citirea este corectă")}
          </button>
          <button type="button" disabled={pending} onClick={() => setDisputing(true)} data-verify-dispute="" className="tap h-12 flex-1 rounded-xl border border-[var(--color-line)] font-semibold hover:bg-[var(--color-surface-2)] disabled:opacity-50">
            {t("Nu este corectă")}
          </button>
        </div>
      )}

      {disputing && (
        <div className="flex flex-col gap-2">
          <label className="text-sm text-ink-soft" htmlFor="why">{t("Ce nu este corect? (opțional)")}</label>
          <textarea id="why" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} placeholder={t("De exemplu: indexul real este 1234, sau nu eu am trimis citirea.")} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-brand" />
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => run(() => disputeReadingAction(token, note))} data-verify-send="" className="tap h-11 flex-1 rounded-xl bg-st-cancelled font-semibold text-white disabled:opacity-50">{t("Trimite contestația")}</button>
            <button type="button" disabled={pending} onClick={() => setDisputing(false)} className="tap h-11 rounded-xl border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)]">{t("Renunță")}</button>
          </div>
        </div>
      )}
    </div>
  );
}
