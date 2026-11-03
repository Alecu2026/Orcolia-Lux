"use client";

import { useState, useTransition } from "react";
import { confirmPendingReadingAction } from "@/app/actions/reading-verify";
import { useT } from "@/lib/i18n/context";

/** Butonul „Confirm citirea” de pe pagina de confirmare: abia apăsarea lui înregistrează citirea trimisă din portal. */
export default function ReadingConfirmForm({ token }: { token: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  function confirm() {
    setError("");
    start(async () => {
      const r = await confirmPendingReadingAction(token);
      if (r.ok) setDone(true);
      else setError(r.error);
    });
  }

  return (
    <div className="mt-4 flex flex-col gap-3">
      {done && (
        <p className="rounded-xl bg-brand-soft px-3 py-3 text-sm font-medium text-brand-strong" role="status" data-confirm-done="">
          {t("Mulțumim! Citirea a fost confirmată și înregistrată.")}
        </p>
      )}
      {error && <p className="text-sm text-st-cancelled" role="alert" data-confirm-error="">{t(error)}</p>}
      {!done && (
        <button type="button" disabled={pending} onClick={confirm} data-confirm-reading-btn="" className="tap h-12 rounded-xl bg-brand text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50">
          {pending ? t("Se confirmă…") : t("Confirm citirea")}
        </button>
      )}
    </div>
  );
}
