"use client";

import { useActionState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { login, register, type AuthState } from "@/app/actions/auth";
import { useMessages } from "@/lib/i18n/context";

const input =
  "w-full h-12 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

export default function AuthForm({ mode }: { mode: "login" | "register" }) {
  const m = useMessages();
  const action = mode === "login" ? login : register;
  const [state, formAction, pending] = useActionState<AuthState, FormData>(
    action,
    undefined,
  );
  const next = useSearchParams().get("next") ?? "/dashboard";

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="next" value={next} />

      {mode === "register" && (
        <input
          name="name"
          placeholder={m.auth.namePlaceholder}
          autoComplete="name"
          required
          className={input}
        />
      )}
      <input
        name="email"
        type="email"
        placeholder={m.auth.email}
        autoComplete="email"
        required
        className={input}
      />
      <input
        name="password"
        type="password"
        placeholder={m.auth.password}
        autoComplete={mode === "login" ? "current-password" : "new-password"}
        required
        className={input}
      />

      {mode === "login" && (
        <Link href="/forgot-password" className="-mt-1 self-end text-xs text-brand hover:underline">
          Ai uitat parola?
        </Link>
      )}

      {state?.error && (
        <p className="text-sm text-st-cancelled">{state.error}</p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
      >
        {pending
          ? m.auth.processing
          : mode === "login"
            ? m.auth.loginBtn
            : m.auth.registerBtn}
      </button>
    </form>
  );
}
