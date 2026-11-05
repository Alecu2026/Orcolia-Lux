"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";

/**
 * Doar pentru administratori: recalculează plățile din lanțul de facturi pe TOT istoricul (statusurile „Achitată” / „Restantă”, cât s-a plătit din fiecare factură),
 * rundă cu rundă, cu progres, până nu mai rămâne nimic de procesat. Apare doar cât mai sunt facturi neprocesate; altfel istoricul e la zi (se ține singur la zi după fiecare sincronizare 1C).
 */
export default function PaymentChainRunner() {
  const t = useT();
  const router = useRouter();
  const [pending, setPending] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = useRef(false);

  const refreshPending = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/payment-chain");
      if (!r.ok) return;
      const j = (await r.json()) as { pending?: number };
      if (typeof j.pending === "number") setPending(j.pending);
    } catch {}
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshPending();
    return () => {
      stop.current = true;
    };
  }, [refreshPending]);

  async function run() {
    setRunning(true);
    setError(null);
    stop.current = false;
    try {
      for (let round = 0; round < 200 && !stop.current; round++) {
        const r = await fetch("/api/admin/payment-chain", { method: "POST" });
        const j = (await r.json().catch(() => null)) as { pending?: number; skipped?: boolean; error?: string } | null;
        if (!r.ok || !j) throw new Error(j?.error ?? String(r.status));
        if (typeof j.pending === "number") setPending(j.pending);
        if (j.skipped) await new Promise((res) => setTimeout(res, 5000)); // altă rulare în curs (ex. cron): așteptăm
        else if ((j.pending ?? 0) === 0) break;
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Eroare"));
    } finally {
      setRunning(false);
      void refreshPending();
    }
  }

  if (pending == null || (pending === 0 && !running && !error)) return null;
  return (
    <div className="flex items-center gap-2 rounded-xl border border-st-progress/40 bg-st-progress/10 px-3 py-1.5 text-xs" data-payment-chain="">
      <span>
        {running
          ? t("Se recalculează plățile din lanțul de facturi… au rămas {n} facturi.", { n: (pending ?? 0).toLocaleString("ro-RO") })
          : t("{n} facturi nu au statusul calculat din avans / datorii.", { n: (pending ?? 0).toLocaleString("ro-RO") })}
      </span>
      {!running && (
        <button type="button" onClick={() => void run()} className="tap h-7 cursor-pointer rounded-lg bg-brand px-2.5 font-semibold text-white hover:bg-brand-strong">
          {t("Recalculează acum")}
        </button>
      )}
      {error && <span className="text-st-cancelled">{error}</span>}
    </div>
  );
}
