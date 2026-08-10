"use client";

import { useActionState } from "react";
import { requestClientRegistration, type ClientAuthState } from "@/app/actions/client-auth";

const input =
  "w-full h-12 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

export default function PortalRegisterRequestForm() {
  const [state, formAction, pending] = useActionState<ClientAuthState, FormData>(
    requestClientRegistration,
    undefined,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input name="meterSeries" placeholder="Serie contor" required className={input} />
      <input name="email" type="email" placeholder="Email" autoComplete="email" required className={input} />

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
