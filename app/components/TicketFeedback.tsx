"use client";

import { useState, useTransition } from "react";
import { submitTicketFeedbackAction } from "@/app/actions/portal-feedback";
import { FEEDBACK_MAX } from "@/lib/ticket-feedback";
import { useT } from "@/lib/i18n/context";

const LABELS = ["Foarte nemulțumit", "Nemulțumit", "Acceptabil", "Mulțumit", "Foarte mulțumit"] as const;

/**
 * Feedback-ul clientului după ce cererea lui a fost finalizată: nota 1–5 (stele) + un comentariu opțional. Se trimite la echipă (notificare către administratori și
 * cei asignați) și se poate corecta oricând. Fără feedback dat apare formularul; după trimitere — rezumatul, cu „Modifică”.
 */
export default function TicketFeedback({
  ticketId,
  initialRating,
  initialComment,
  readOnlyReason,
}: {
  ticketId: string;
  initialRating: number | null;
  initialComment: string | null;
  /** Când e setat (ex. simulare de către personal), formularul e doar de citit. */
  readOnlyReason?: string | null;
}) {
  const t = useT();
  const [saved, setSaved] = useState<{ rating: number; comment: string | null } | null>(initialRating ? { rating: initialRating, comment: initialComment } : null);
  const [editing, setEditing] = useState(!initialRating);
  const [rating, setRating] = useState(initialRating ?? 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(initialComment ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = hover || rating;

  function send() {
    setError(null);
    start(async () => {
      const res = await submitTicketFeedbackAction(ticketId, rating, comment);
      if (!res.ok) return setError(t(res.error));
      setSaved({ rating: res.rating, comment: res.comment });
      setEditing(false);
    });
  }

  return (
    <section className="card border-brand/30 p-3" data-ticket-feedback="">
      <h2 className="text-sm font-bold">{t("Cum a fost rezolvată cererea?")}</h2>
      {saved && !editing ? (
        <div className="mt-1.5 text-sm">
          <p className="text-lg leading-none text-st-progress" aria-label={`${saved.rating}/5`} data-feedback-saved={saved.rating}>
            {"★".repeat(saved.rating)}<span className="text-ink-soft/30">{"★".repeat(5 - saved.rating)}</span>
          </p>
          {saved.comment && <p className="mt-1.5 whitespace-pre-wrap break-words text-ink-soft">{saved.comment}</p>}
          <p className="mt-1.5 text-xs text-st-done">✓ {t("Mulțumim! Părerea ta a ajuns la echipă.")}</p>
          {!readOnlyReason && (
            <button type="button" onClick={() => setEditing(true)} className="tap mt-1 h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft">
              ✎ {t("Modifică")}
            </button>
          )}
        </div>
      ) : (
        <div className="mt-1.5">
          <p className="mb-1 text-xs text-ink-soft">{t("Dă o notă de la 1 la 5 — ne ajută să ne îmbunătățim.")}</p>
          <div role="radiogroup" aria-label={t("Nota")} className="flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={rating === n}
                aria-label={`${n} — ${t(LABELS[n - 1])}`}
                title={t(LABELS[n - 1])}
                disabled={!!readOnlyReason}
                onMouseEnter={() => setHover(n)}
                onClick={() => setRating(n)}
                className={`grid size-11 cursor-pointer place-items-center text-3xl leading-none transition-colors disabled:cursor-not-allowed ${n <= shown ? "text-st-progress" : "text-ink-soft/30"}`}
                data-star={n}
              >
                ★
              </button>
            ))}
            {shown > 0 && <span className="ml-2 text-xs text-ink-soft">{t(LABELS[shown - 1])}</span>}
          </div>
          <textarea
            name="feedbackComment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={FEEDBACK_MAX}
            rows={3}
            disabled={!!readOnlyReason}
            placeholder={t("Comentariu (opțional): ce a mers bine, ce putem face mai bine?")}
            className="mt-2 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-brand"
          />
          {(error || readOnlyReason) && <p className="mt-1 text-sm text-st-cancelled">{error ?? readOnlyReason}</p>}
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={send} disabled={pending || rating === 0 || !!readOnlyReason} className="tap h-11 cursor-pointer rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50">
              {pending ? t("Se trimite…") : t("Trimite feedback")}
            </button>
            {saved && (
              <button type="button" onClick={() => { setEditing(false); setRating(saved.rating); setComment(saved.comment ?? ""); }} className="tap h-11 cursor-pointer rounded-xl border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)]">
                {t("Anulează")}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
