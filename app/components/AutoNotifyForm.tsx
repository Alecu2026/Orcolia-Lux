"use client";

import { useState, useTransition } from "react";
import { saveAutoNotifyAction } from "@/app/actions/auto-notify";
import { AUTO_NOTIFY_KINDS, AUTO_NOTIFY_LABELS, type AutoNotifySettings } from "@/lib/auto-notify";
import { useT } from "@/lib/i18n/context";
import { useToast } from "./toast";

/**
 * „Notificări automate către clienți”: pentru fiecare tip (expirarea contractului, verificarea metrologică, termenul neregulilor) se alege dacă se trimit automat și pe ce canal.
 * SMS-ul costă bani, emailul nu: se pot bifa separat. Personalul primește oricum notificările interne; fără canal către client, el vede „de contactat personal”.
 */
export default function AutoNotifyForm({
  initial,
  canEdit,
  emailEnabled,
  smsEnabled,
}: {
  initial: AutoNotifySettings;
  canEdit: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const [s, setS] = useState<AutoNotifySettings>(initial);
  const [pending, start] = useTransition();
  const set = (k: (typeof AUTO_NOTIFY_KINDS)[number], patch: Partial<AutoNotifySettings[typeof k]>) => setS((x) => ({ ...x, [k]: { ...x[k], ...patch } }));

  function save() {
    start(async () => {
      const r = await saveAutoNotifyAction(s);
      if (r.error) toast.error(t(r.error));
      else toast.success(t("Notificările automate au fost salvate."));
    });
  }

  return (
    <div className="card flex flex-col gap-4 p-5" data-auto-notify="">
      <div>
        <h2 className="text-base font-bold">{t("Notificări automate către clienți")}</h2>
        <p className="text-sm text-ink-soft">{t("Alege ce se trimite automat clienților și pe ce canal. SMS-ul costă bani, emailul nu — le poți activa separat. Personalul primește oricum notificările interne.")}</p>
        {(!emailEnabled || !smsEnabled) && (
          <p className="mt-1 text-xs text-st-progress">
            {!emailEnabled && `⚠ ${t("Emailul nu este configurat pe server (SMTP).")} `}
            {!smsEnabled && `⚠ ${t("SMS-ul nu este configurat pe server.")}`}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-3">
        {AUTO_NOTIFY_KINDS.map((k) => {
          const r = s[k];
          return (
            <div key={k} className="border-b border-[var(--color-line)] pb-3 last:border-0 last:pb-0" data-auto={k}>
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" name={`${k}-enabled`} checked={r.enabled} disabled={!canEdit} onChange={(e) => set(k, { enabled: e.target.checked })} className="size-4 rounded accent-brand" />
                {t(AUTO_NOTIFY_LABELS[k].title)}
              </label>
              <p className="ml-6 text-xs text-ink-soft">{t(AUTO_NOTIFY_LABELS[k].desc)}</p>
              <div className="ml-6 mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-sm">
                <label className={`flex items-center gap-1.5 ${r.enabled ? "" : "opacity-50"}`}>
                  <input type="checkbox" name={`${k}-email`} checked={r.email} disabled={!canEdit || !r.enabled} onChange={(e) => set(k, { email: e.target.checked })} className="size-4 rounded accent-brand" />
                  {t("Email")} <span className="text-xs text-ink-soft">({t("gratuit")})</span>
                </label>
                <label className={`flex items-center gap-1.5 ${r.enabled ? "" : "opacity-50"}`}>
                  <input type="checkbox" name={`${k}-sms`} checked={r.sms} disabled={!canEdit || !r.enabled} onChange={(e) => set(k, { sms: e.target.checked })} className="size-4 rounded accent-brand" />
                  {t("SMS")} <span className="text-xs text-ink-soft">({t("costă bani")})</span>
                </label>
              </div>
            </div>
          );
        })}
      </div>
      {canEdit && (
        <button type="button" onClick={save} disabled={pending} className="tap h-9 self-start rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
          {pending ? t("Se salvează…") : t("Salvează")}
        </button>
      )}
    </div>
  );
}
