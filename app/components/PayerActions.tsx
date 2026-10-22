"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { updatePayer, deletePayer, resetPayerPortalAccess, type PayerState } from "@/app/actions/payers";
import { useToast } from "./toast";
import { useT } from "@/lib/i18n/context";

const input =
  "h-10 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

export default function PayerActions({
  payer,
  canEdit,
  canDelete,
  canAdmin,
}: {
  payer: { id: string; name: string; phone: string | null; email: string | null; notes: string | null };
  canEdit: boolean;
  canDelete: boolean;
  canAdmin: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<PayerState, FormData>(updatePayer, undefined);
  const [busy, setBusy] = useState<"delete" | "reset" | null>(null);

  async function onDelete() {
    if (!confirm(t("Ștergi definitiv „{name}”? Se șterg și toate facturile lui.", { name: payer.name }))) return;
    setBusy("delete");
    await deletePayer(payer.id);
    router.push("/platitori");
  }

  async function onReset() {
    if (!confirm(t("Revoci accesul la portal pentru „{name}”? Va trebui să se reactiveze cu seria de contor.", { name: payer.name }))) return;
    setBusy("reset");
    await resetPayerPortalAccess(payer.id);
    setBusy(null);
    toast.success(t("Acces portal resetat."));
    router.refresh();
  }

  if (editing) {
    return (
      <form
        action={(fd) => {
          fd.set("id", payer.id);
          formAction(fd);
        }}
        className="card flex flex-col gap-3 p-4"
      >
        <input name="name" defaultValue={payer.name} placeholder={t("Nume")} required className={input} />
        <input name="phone" defaultValue={payer.phone ?? ""} placeholder={t("Telefon")} className={input} />
        <input name="email" defaultValue={payer.email ?? ""} placeholder={t("Email")} type="email" className={input} />
        <textarea name="notes" defaultValue={payer.notes ?? ""} placeholder={t("Notițe")} rows={2} className={input} />
        {state?.error && <p className="text-sm text-st-cancelled">{state.error}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className="tap h-10 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {pending ? t("Se salvează…") : t("Salvează")}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="tap h-10 rounded-xl border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)]">
            {t("Anulează")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canEdit && (
        <button onClick={() => setEditing(true)} className="tap h-10 rounded-xl border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)]">
          {t("Editează")}
        </button>
      )}
      {canAdmin && (
        <button onClick={onReset} disabled={busy === "reset"} className="tap h-10 rounded-xl border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)] disabled:opacity-60">
          {busy === "reset" ? t("Se resetează…") : t("Resetează acces portal")}
        </button>
      )}
      {canDelete && (
        <button onClick={onDelete} disabled={busy === "delete"} className="tap h-10 rounded-xl border border-[var(--color-line)] px-4 text-sm text-st-cancelled hover:bg-[var(--color-surface-2)] disabled:opacity-60">
          {busy === "delete" ? t("Se șterge…") : t("Șterge")}
        </button>
      )}
    </div>
  );
}
