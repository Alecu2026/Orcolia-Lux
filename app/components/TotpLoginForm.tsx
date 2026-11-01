"use client";

import { useActionState } from "react";
import { cancelLoginTotp, verifyLoginTotp, type AuthState } from "@/app/actions/auth";
import { useT } from "@/lib/i18n/context";

const input =
  "w-full h-12 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 text-center text-xl tracking-[0.3em] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

/** Pasul 2 al intrării (după parola corectă): codul din aplicația de autentificare sau un cod de recuperare. */
export default function TotpLoginForm() {
  const t = useT();
  const [state, formAction, pending] = useActionState<AuthState, FormData>(verifyLoginTotp, undefined);
  return (
    <div className="flex flex-col gap-3">
      <form action={formAction} className="flex flex-col gap-3">
        <input
          name="code"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          required
          maxLength={14}
          placeholder="000000"
          aria-label={t("Cod de autentificare")}
          className={input}
        />
        <p className="text-xs text-ink-soft">{t("Introdu codul din aplicația de autentificare. Dacă nu mai ai telefonul, scrie un cod de recuperare (XXXXX-XXXXX).")}</p>
        {state?.error && <p className="text-sm text-st-cancelled">{t(state.error)}</p>}
        <button type="submit" disabled={pending} className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
          {pending ? t("Se verifică…") : t("Confirmă")}
        </button>
      </form>
      <form action={cancelLoginTotp}>
        <button type="submit" className="w-full text-center text-xs text-brand hover:underline">
          {t("Înapoi la autentificare")}
        </button>
      </form>
    </div>
  );
}
