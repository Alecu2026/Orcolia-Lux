"use client";

import { useRef, useState } from "react";
import { deletePayersBulkAction } from "@/app/actions/payers";
import { IconX } from "./icons";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";

const CHUNK = 100;

type Totals = { deleted: number; withInvoices: number; withActivity: number; activated: number; missing: number };

/**
 * Ștergere în masă a plătitorilor selectați — pentru curățarea datelor de test. Protecții:
 *  - serverul șterge DOAR plătitorii fără facturi, programări, proiecte/task-uri și fără cont de portal activ
 *    (restul sunt omiși și numărați, nu șterși);
 *  - confirmarea cere scrierea cuvântului „STERGE";
 *  - nu există retrimitere automată: la o eroare de rețea te oprești și vezi cât s-a șters.
 */
export default function PayerBulkDeleteDialog({
  ids,
  onClose,
  onDone,
}: {
  ids: string[];
  onClose: () => void;
  /** Apelat la închidere, cu id-urile șterse efectiv — pagina le scoate din selecție și reîncarcă tabelul. */
  onDone: (deletedIds: string[]) => void;
}) {
  const t = useT();
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag);
  const [word, setWord] = useState("");
  const [phase, setPhase] = useState<"confirm" | "running" | "done">("confirm");
  const [processed, setProcessed] = useState(0);
  const [totals, setTotals] = useState<Totals>({ deleted: 0, withInvoices: 0, withActivity: 0, activated: 0, missing: 0 });
  const [error, setError] = useState<string | null>(null);
  const deletedIds = useRef<string[]>([]);
  const stop = useRef(false);

  const armed = word.trim().toUpperCase() === "STERGE";
  const total = ids.length;
  const pct = total ? Math.round((processed / total) * 100) : 0;

  async function run() {
    setPhase("running");
    stop.current = false;
    setError(null);
    for (let i = 0; i < ids.length; i += CHUNK) {
      if (stop.current) break;
      const chunk = ids.slice(i, i + CHUNK);
      try {
        const res = await deletePayersBulkAction(chunk);
        if (!res.ok) { setError(res.error); break; }
        deletedIds.current.push(...res.deletedIds);
        setTotals((s) => ({
          deleted: s.deleted + res.deletedIds.length,
          withInvoices: s.withInvoices + res.skipped.withInvoices,
          withActivity: s.withActivity + res.skipped.withActivity,
          activated: s.activated + res.skipped.activated,
          missing: s.missing + res.skipped.missing,
        }));
        setProcessed(Math.min(total, i + chunk.length));
      } catch {
        setError(t("Conexiune întreruptă. Verifică în tabel ce s-a șters și reia dacă e nevoie."));
        break;
      }
    }
    setPhase("done");
  }

  const skipped = totals.withInvoices + totals.withActivity + totals.activated + totals.missing;
  const running = phase === "running";

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !running && (phase === "done" ? onDone(deletedIds.current) : onClose())}
    >
      <div className="card w-full max-w-md rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className="text-base font-bold text-st-cancelled">{t("Șterge plătitori")}</h2>
          <button
            type="button"
            disabled={running}
            onClick={() => (phase === "done" ? onDone(deletedIds.current) : onClose())}
            className="tap grid size-8 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={t("Închide")}
          >
            <IconX className="size-4" />
          </button>
        </div>

        {phase === "confirm" && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              {t("Ai selectat {n} plătitori. Se șterg definitiv doar cei care nu au facturi, programări, proiecte sau sarcini și nici cont de portal activat; pe ceilalți îi omit automat.", { n: nf(total) })}
            </p>
            <p className="rounded-lg bg-st-cancelled/10 px-3 py-2 text-xs text-st-cancelled">
              {t("Acțiunea nu poate fi anulată. Dacă acești plătitori vin din exportul 1C, o sincronizare următoare îi poate crea la loc.")}
            </p>
            <label className="text-xs font-semibold text-ink-soft">
              {t("Scrie")} <span className="font-mono">STERGE</span> {t("ca să confirmi")}
              <input
                value={word}
                onChange={(e) => setWord(e.target.value)}
                autoFocus
                placeholder="STERGE"
                className="mt-1 h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm outline-none focus:border-st-cancelled"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="tap h-9 cursor-pointer rounded-lg border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)]">
                {t("Anulează")}
              </button>
              <button
                type="button"
                disabled={!armed}
                onClick={run}
                className="tap h-9 cursor-pointer rounded-lg bg-st-cancelled px-4 text-sm font-semibold text-white disabled:cursor-default disabled:opacity-40"
              >
                {t("Șterge definitiv")}
              </button>
            </div>
          </div>
        )}

        {(phase === "running" || phase === "done") && (
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold">{running ? t("Se șterge…") : error ? t("Întrerupt") : t("Gata")}</span>
                <span className="tabular-nums text-ink-soft">{nf(processed)} / {nf(total)} ({pct}%)</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div className="h-full rounded-full bg-st-cancelled transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <p>
              {t("Șterși")}: <b className="text-st-cancelled">{nf(totals.deleted)}</b>
              {skipped > 0 && <> · {t("Omiși")}: <b>{nf(skipped)}</b></>}
            </p>
            {skipped > 0 && (
              <ul className="list-disc pl-5 text-xs text-ink-soft">
                {totals.withInvoices > 0 && <li>{t("{n} au facturi", { n: nf(totals.withInvoices) })}</li>}
                {totals.withActivity > 0 && <li>{t("{n} au programări, proiecte sau sarcini", { n: nf(totals.withActivity) })}</li>}
                {totals.activated > 0 && <li>{t("{n} au cont de portal activat", { n: nf(totals.activated) })}</li>}
                {totals.missing > 0 && <li>{t("{n} nu mai existau", { n: nf(totals.missing) })}</li>}
              </ul>
            )}
            {error && <p className="rounded-lg bg-st-cancelled/10 px-3 py-2 text-xs text-st-cancelled">{error}</p>}
            <div className="flex justify-end gap-2">
              {running ? (
                <button type="button" onClick={() => (stop.current = true)} className="tap h-9 cursor-pointer rounded-lg border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)]">
                  {t("Oprește după lotul curent")}
                </button>
              ) : (
                <button type="button" onClick={() => onDone(deletedIds.current)} className="tap h-9 cursor-pointer rounded-lg bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong">
                  {t("Închide")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
