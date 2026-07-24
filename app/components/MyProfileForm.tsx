"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateMyProfile,
  requestMyPasswordChangeCode,
  confirmMyPasswordChange,
  type ProfileState,
} from "@/app/actions/profile";
import { useToast } from "./toast";

const input =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";
const label = "mb-1.5 block text-xs font-semibold text-ink-soft";

export default function MyProfileForm({
  name,
  email,
  telegramChatId,
}: {
  name: string;
  email: string;
  telegramChatId: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useActionState<ProfileState, FormData>(updateMyProfile, undefined);

  const [pwStep, setPwStep] = useState<"idle" | "code" | "sending">("idle");
  const [codeState, codeAction, codePending] = useActionState<ProfileState, FormData>(
    confirmMyPasswordChange,
    undefined,
  );

  async function startPasswordChange() {
    setPwStep("sending");
    const res = await requestMyPasswordChangeCode();
    if (res?.error) {
      toast.error(res.error);
      setPwStep("idle");
    } else {
      toast.success("Cod trimis pe email.");
      setPwStep("code");
    }
  }

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  useEffect(() => {
    if (codeState?.ok) {
      toast.success("Parolă schimbată.");
      setPwStep("idle");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codeState]);

  return (
    <div className="card flex flex-col gap-5 p-5">
      <h2 className="text-base font-bold">Profilul meu</h2>

      <form action={action} className="flex flex-col gap-3">
        <div>
          <label className={label}>Nume</label>
          <input name="name" defaultValue={name} required className={input} />
        </div>
        <div>
          <label className={label}>Email</label>
          <input name="email" type="email" defaultValue={email} required className={input} />
        </div>
        <div>
          <label className={label}>Telegram Chat ID (opțional)</label>
          <input name="telegramChatId" defaultValue={telegramChatId ?? ""} inputMode="numeric" className={input} />
        </div>

        {state?.error && <p className="text-sm text-st-cancelled">{state.error}</p>}
        {state?.ok && <p className="text-sm text-st-done">Salvat.</p>}

        <button
          type="submit"
          disabled={pending}
          className="tap h-11 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {pending ? "Se salvează…" : "Salvează"}
        </button>
      </form>

      <div className="border-t border-[var(--color-line)] pt-4">
        <p className="mb-2 text-sm font-semibold">Schimbă parola</p>

        {pwStep === "idle" && (
          <button
            onClick={startPasswordChange}
            className="tap h-11 w-full rounded-xl border border-[var(--color-line)] font-semibold hover:bg-[var(--color-surface-2)]"
          >
            Trimite cod de confirmare pe email
          </button>
        )}

        {pwStep === "sending" && (
          <button disabled className="tap h-11 w-full rounded-xl border border-[var(--color-line)] font-semibold opacity-60">
            Se trimite codul…
          </button>
        )}

        {pwStep === "code" && (
          <form action={codeAction} className="flex flex-col gap-3">
            <p className="text-xs text-ink-soft">
              Am trimis un cod de 6 cifre pe <strong>{email}</strong>. Introdu-l mai jos împreună cu parola nouă.
            </p>
            <div>
              <label className={label}>Cod (6 cifre)</label>
              <input
                name="code"
                inputMode="numeric"
                maxLength={6}
                required
                className={`${input} text-center tracking-[0.5em]`}
              />
            </div>
            <div>
              <label className={label}>Parolă nouă</label>
              <input name="newPassword" type="password" required minLength={8} className={input} />
            </div>
            <div>
              <label className={label}>Confirmă parola nouă</label>
              <input name="confirmPassword" type="password" required minLength={8} className={input} />
            </div>

            {codeState?.error && <p className="text-sm text-st-cancelled">{codeState.error}</p>}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPwStep("idle")}
                className="tap h-11 flex-1 rounded-xl border border-[var(--color-line)] font-semibold hover:bg-[var(--color-surface-2)]"
              >
                Anulează
              </button>
              <button
                type="submit"
                disabled={codePending}
                className="tap h-11 flex-1 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
              >
                {codePending ? "Se confirmă…" : "Confirmă"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
