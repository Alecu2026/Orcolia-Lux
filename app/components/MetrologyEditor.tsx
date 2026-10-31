"use client";

import { useState, useTransition } from "react";
import { setMeterMetrologyAction } from "@/app/actions/metrology";
import { metrologyDueKey, METROLOGY_YEARS } from "@/lib/metrology";
import { useToast } from "./toast";
import { useT } from "@/lib/i18n/context";
import ContractExpiry from "./ContractExpiry";
import { markMeterDatasetStale } from "./useMeterDataset";

const dmy = (k: string | null | undefined) => (k ? k.split("-").reverse().join(".") : null);

/**
 * Verificarea metrologică a unui contor: data ultimei verificări (introdusă manual) și scadența următoarei (+ 5 ani, cu culoare după cât mai e).
 * Fără drept de editare, doar se afișează. Salvarea se vede imediat aici; lista de contoare se actualizează singură la următoarea sincronizare a listei.
 */
export default function MetrologyEditor({
  meterId,
  initial,
  canEdit,
  onSaved,
}: {
  meterId: string;
  initial: string | null;
  canEdit: boolean;
  onSaved?: (verifiedAt: string | null) => void;
}) {
  const t = useT();
  const toast = useToast();
  const [verified, setVerified] = useState<string | null>(initial);
  const [value, setValue] = useState(initial ?? "");
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const due = verified ? metrologyDueKey(verified) : null;

  function save(next: string | null) {
    start(async () => {
      const res = await setMeterMetrologyAction(meterId, next);
      if (res.error) return toast.error(t(res.error));
      setVerified(res.verifiedAt ?? null);
      setValue(res.verifiedAt ?? "");
      setEditing(false);
      toast.success(t(next ? "Verificarea metrologică a fost salvată." : "Data verificării metrologice a fost ștearsă."));
      markMeterDatasetStale(); // lista de contoare din browser se reîmprospătează (coloana și filtrul văd data nouă)
      onSaved?.(res.verifiedAt ?? null);
    });
  }

  return (
    <div className="px-3 py-2 text-sm" data-metrology="">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{t("Ultima verificare")}</p>
          <p className="font-medium" data-metrology-verified="">{dmy(verified) ?? <span className="text-ink-soft">{t("Nu e introdusă")}</span>}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{t("Următoarea verificare (peste {n} ani)", { n: METROLOGY_YEARS })}</p>
          <p className="font-medium" data-metrology-due=""><ContractExpiry date={due} /></p>
        </div>
      </div>
      {canEdit && (
        <div className="mt-2">
          {editing ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs font-semibold text-ink-soft">
                {t("Data ultimei verificări")}
                <input
                  type="date"
                  name="metrologyDate"
                  value={value}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => setValue(e.target.value)}
                  className="mt-1 block h-10 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm font-normal text-ink outline-none focus:border-brand"
                />
              </label>
              <button type="button" disabled={pending || !value} onClick={() => save(value)} className="tap h-10 cursor-pointer rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50">
                {t("Salvează")}
              </button>
              <button type="button" disabled={pending} onClick={() => { setEditing(false); setValue(verified ?? ""); }} className="tap h-10 cursor-pointer rounded-xl border border-[var(--color-line)] px-3 text-sm hover:bg-[var(--color-surface-2)]">
                {t("Anulează")}
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setEditing(true)} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft">
                ✎ {verified ? t("Modifică data") : t("Introdu data verificării")}
              </button>
              {verified && (
                <button type="button" disabled={pending} onClick={() => save(null)} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium text-st-cancelled hover:bg-[var(--color-surface-2)]">
                  {t("Șterge data")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
