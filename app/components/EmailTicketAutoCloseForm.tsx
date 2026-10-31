"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { updateEmailTicketAutoClose, type SettingsState } from "@/app/actions/settings";
import { AUTOCLOSE_MAX_HOURS, AUTOCLOSE_MIN_HOURS } from "@/lib/ticket-autoclose";
import { useToast } from "./toast";
import { useMessages, useT } from "@/lib/i18n/context";

const inp = "h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

/**
 * „Închidere automată a cererilor din email”: după câte ore de la ultimul răspuns al operatorului, fără răspuns de la client, cererea trece în „Finalizat”
 * (clientul primește un email; o cerere nouă se deschide dacă mai scrie). Poate fi oprită complet.
 */
export default function EmailTicketAutoCloseForm({ enabled, hours, canEdit }: { enabled: boolean; hours: number; canEdit: boolean }) {
  const t = useT();
  const m = useMessages();
  const toast = useToast();
  const [on, setOn] = useState(enabled);
  const [h, setH] = useState(String(hours));
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateEmailTicketAutoClose, undefined);

  useEffect(() => {
    if (state?.ok) toast.success(t("Închiderea automată a fost salvată."));
    else if (state?.error) toast.error(t(state.error));
  }, [state, toast, t]);

  const n = Number(h);
  const days = Number.isInteger(n) && n >= 24 && n % 24 === 0 ? n / 24 : null;

  return (
    <div className="card flex flex-col gap-4 p-5" data-autoclose-settings="">
      <div>
        <h2 className="text-base font-bold">{t("Închidere automată cereri din email")}</h2>
        <p className="text-sm text-ink-soft">
          {t("O cerere din email la care operatorul a răspuns, iar clientul nu mai scrie, se finalizează singură după numărul de ore ales. Clientul primește un email, iar la „Măsuri luate” se notează motivul.")}
        </p>
      </div>
      {!canEdit ? (
        <p className="rounded-xl border border-[var(--color-line)] px-4 py-3 text-sm">
          {enabled ? t("Activă: după {n} ore fără răspuns de la client.", { n: hours }) : <span className="text-ink-soft">{t("Dezactivată.")}</span>}
        </p>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); const fd = new FormData(e.currentTarget); startTransition(() => action(fd)); }} className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" name="enabled" checked={on} onChange={(e) => setOn(e.target.checked)} className="size-4 rounded accent-brand" />
            {t("Închide automat cererile din email fără răspuns")}
          </label>
          <div className="flex flex-col gap-1">
            <span className="text-xs text-ink-soft">{t("După câte ore fără răspuns de la client")}</span>
            <div className="flex items-center gap-2">
              <input
                type="number"
                name="hours"
                min={AUTOCLOSE_MIN_HOURS}
                max={AUTOCLOSE_MAX_HOURS}
                step={1}
                value={h}
                onChange={(e) => setH(e.target.value)}
                disabled={!on}
                required
                className={`${inp} w-28 disabled:opacity-50`}
              />
              <span className="text-sm text-ink-soft">{t("ore")}{days != null ? ` (= ${days} ${days === 1 ? t("zi") : t("zile")})` : ""}</span>
            </div>
            <span className="text-[11px] text-ink-soft">{t("Minim {a}, maxim {b} ore (90 de zile). Implicit: 48.", { a: AUTOCLOSE_MIN_HOURS, b: AUTOCLOSE_MAX_HOURS })}</span>
          </div>
          <button type="submit" disabled={pending} className="tap h-9 self-start rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {pending ? m.common.saving : m.common.save}
          </button>
        </form>
      )}
    </div>
  );
}
