"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createPortalTicket, type PortalTicketState } from "@/app/actions/portal";

const input =
  "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-4 py-3 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30";

export default function PortalNewTicketForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState<PortalTicketState, FormData>(
    createPortalTicket,
    undefined,
  );

  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-3">
      <input name="title" placeholder="Titlu (ex: Scurgere la contor)" required className={input} />
      <textarea name="description" placeholder="Descriere (opțional)" rows={3} className={input} />

      {state?.error && <p className="text-sm text-st-cancelled">{state.error}</p>}
      {state?.ok && <p className="text-sm text-brand-strong">Tichet trimis cu succes.</p>}

      <button
        type="submit"
        disabled={pending}
        className="tap h-11 self-start rounded-xl bg-brand px-5 font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
      >
        {pending ? "Se trimite…" : "Trimite tichet"}
      </button>
    </form>
  );
}
