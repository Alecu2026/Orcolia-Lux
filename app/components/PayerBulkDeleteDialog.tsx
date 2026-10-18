"use client";

import { useRef, useState } from "react";
import { deletePayersBulkAction } from "@/app/actions/payers";
import { IconX } from "./icons";

const CHUNK = 100;
const nf = (n: number) => n.toLocaleString("ro-RO");

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
        setTotals((t) => ({
          deleted: t.deleted + res.deletedIds.length,
          withInvoices: t.withInvoices + res.skipped.withInvoices,
          withActivity: t.withActivity + res.skipped.withActivity,
          activated: t.activated + res.skipped.activated,
          missing: t.missing + res.skipped.missing,
        }));
        setProcessed(Math.min(total, i + chunk.length));
      } catch {
        setError("Conexiune întreruptă. Verifică în tabel ce s-a șters și reia dacă e nevoie.");
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
          <h2 className="text-base font-bold text-st-cancelled">Șterge plătitori</h2>
          <button
            type="button"
            disabled={running}
            onClick={() => (phase === "done" ? onDone(deletedIds.current) : onClose())}
            className="tap grid size-8 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label="Închide"
          >
            <IconX className="size-4" />
          </button>
        </div>

        {phase === "confirm" && (
          <div className="flex flex-col gap-3 text-sm">
            <p>
              Ai selectat <b>{nf(total)}</b> plătitori. Se șterg <b>definitiv</b> doar cei care <b>nu au</b> facturi, programări, proiecte sau
              task-uri și nici cont de portal activat; pe ceilalți îi omit automat.
            </p>
            <p className="rounded-lg bg-st-cancelled/10 px-3 py-2 text-xs text-st-cancelled">
              Acțiunea nu poate fi anulată. Dacă acești plătitori vin din exportul 1C, o sincronizare următoare îi poate crea la loc.
            </p>
            <label className="text-xs font-semibold text-ink-soft">
              Scrie <span className="font-mono">STERGE</span> ca să confirmi
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
                Anulează
              </button>
              <button
                type="button"
                disabled={!armed}
                onClick={run}
                className="tap h-9 cursor-pointer rounded-lg bg-st-cancelled px-4 text-sm font-semibold text-white disabled:cursor-default disabled:opacity-40"
              >
                Șterge definitiv
              </button>
            </div>
          </div>
        )}

        {(phase === "running" || phase === "done") && (
          <div className="flex flex-col gap-3 text-sm">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold">{running ? "Se șterge…" : error ? "Întrerupt" : "Gata"}</span>
                <span className="tabular-nums text-ink-soft">{nf(processed)} / {nf(total)} ({pct}%)</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div className="h-full rounded-full bg-st-cancelled transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <p>
              Șterși: <b className="text-st-cancelled">{nf(totals.deleted)}</b>
              {skipped > 0 && <> · Omiși: <b>{nf(skipped)}</b></>}
            </p>
            {skipped > 0 && (
              <ul className="list-disc pl-5 text-xs text-ink-soft">
                {totals.withInvoices > 0 && <li>{nf(totals.withInvoices)} au facturi</li>}
                {totals.withActivity > 0 && <li>{nf(totals.withActivity)} au programări, proiecte sau task-uri</li>}
                {totals.activated > 0 && <li>{nf(totals.activated)} au cont de portal activat</li>}
                {totals.missing > 0 && <li>{nf(totals.missing)} nu mai existau</li>}
              </ul>
            )}
            {error && <p className="rounded-lg bg-st-cancelled/10 px-3 py-2 text-xs text-st-cancelled">{error}</p>}
            <div className="flex justify-end gap-2">
              {running ? (
                <button type="button" onClick={() => (stop.current = true)} className="tap h-9 cursor-pointer rounded-lg border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)]">
                  Oprește după lotul curent
                </button>
              ) : (
                <button type="button" onClick={() => onDone(deletedIds.current)} className="tap h-9 cursor-pointer rounded-lg bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong">
                  Închide
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
