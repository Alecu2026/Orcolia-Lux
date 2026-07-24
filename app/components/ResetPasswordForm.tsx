"use client";

import { useActionState } from "react";
import { resetPasswordWithCode, type AuthState } from "@/app/actions/auth";

const input =
  "w-full h-12 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

export default function ResetPasswordForm({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    resetPasswordWithCode,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="email" value={email} />
      <input
        name="code"
        inputMode="numeric"
        maxLength={6}
        placeholder="Cod (6 cifre)"
        required
        className={`${input} text-center tracking-[0.5em]`}
      />
      <input
        name="newPassword"
        type="password"
        placeholder="Parolă nouă"
        autoComplete="new-password"
        required
        minLength={8}
        className={input}
      />
      <input
        name="confirmPassword"
        type="password"
        placeholder="Confirmă parola nouă"
        autoComplete="new-password"
        required
        minLength={8}
        className={input}
      />

      {state?.error && <p className="text-sm text-st-cancelled">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
      >
        {pending ? "Se procesează…" : "Setează parola nouă"}
      </button>
    </form>
  );
}
