"use client";

import { useActionState } from "react";
import { requestPasswordReset, type AuthState } from "@/app/actions/auth";

const input =
  "w-full h-12 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

export default function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    requestPasswordReset,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input
        name="email"
        type="email"
        placeholder="Email"
        autoComplete="email"
        required
        className={input}
      />

      {state?.error && <p className="text-sm text-st-cancelled">{state.error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
      >
        {pending ? "Se procesează…" : "Trimite cod pe email"}
      </button>
    </form>
  );
}
