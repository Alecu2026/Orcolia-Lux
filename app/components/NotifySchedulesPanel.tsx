"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  deleteNotifyScheduleAction,
  listNotifySchedulesAction,
  runNotifyScheduleNowAction,
  setNotifyScheduleActiveAction,
} from "@/app/actions/notify-schedules";
import type { ScheduleDto } from "@/lib/services/notify-schedules";
import { describeSchedule } from "@/lib/reminder-schedule";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { useToast } from "./toast";

/**
 * Notificările PROGRAMATE (către plătitori sau clienți): ce se trimite, când și cui, următoarea rulare, ultima rulare cu rezultatul. Se pot opri / porni, rula acum sau șterge.
 * Fiecare trimitere apare în Jurnalul de notificări, cu numele programării.
 */
export default function NotifySchedulesPanel({ initial, canManage }: { initial: ScheduleDto[]; canManage: boolean }) {
  const t = useT();
  const tag = dateTag(useLocale());
  const toast = useToast();
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await listNotifySchedulesAction());
    } catch {}
  }, []);

  // starea se reîmprospătează singură (o programare tocmai rulată își schimbă „ultima rulare”)
  useEffect(() => {
    const id = setInterval(() => void refresh(), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" }) : "—");

  async function act(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, okMsg?: string) {
    setBusy(id);
    try {
      const r = await fn();
      if (!r.ok) toast.error(t(r.error ?? "Eroare"));
      else if (okMsg) toast.success(okMsg);
      await refresh();
    } catch {
      toast.error(t("Eroare"));
    } finally {
      setBusy(null);
    }
  }

  const btn = "tap h-7 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40";

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-soft">
        <span>{t("{n} programări", { n: items.length })}</span>
        <button type="button" onClick={() => void refresh()} className={btn}>↻ {t("Reîmprospătează")}</button>
        <Link href="/notificari-platitori?view=jurnal" className="text-brand hover:underline">{t("Vezi jurnalul notificărilor →")}</Link>
      </div>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--color-line)] px-4 py-8 text-center text-sm text-ink-soft">
          {t("Nicio notificare programată. Alege destinatarii (plătitori sau clienți), scrie mesajul și bifează „Programează trimiterea”.")}
        </p>
      ) : (
        <div className="overflow-auto rounded-lg border border-[var(--color-line)]">
          <table className="w-full text-left text-xs">
            <thead className="bg-[var(--color-surface-2)] text-[11px] text-ink-soft">
              <tr>
                <th className="px-2 py-1.5 font-medium">{t("Programare")}</th>
                <th className="px-2 py-1.5 font-medium">{t("Către")}</th>
                <th className="px-2 py-1.5 font-medium">{t("Când")}</th>
                <th className="px-2 py-1.5 font-medium">{t("Următoarea")}</th>
                <th className="px-2 py-1.5 font-medium">{t("Ultima rulare")}</th>
                <th className="px-2 py-1.5 text-right font-medium">{t("Rulări")}</th>
                {canManage && <th className="px-2 py-1.5" />}
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className={`border-t border-[var(--color-line)] align-top ${s.active ? "" : "opacity-60"}`}>
                  <td className="px-2 py-1.5">
                    <div className="font-semibold">{s.name}</div>
                    <div className="text-ink-soft">{s.channels} · {s.createdByName}</div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div>{s.audience === "clients" ? t("Clienți") : t("Plătitori")}</div>
                    <div className="text-ink-soft">{s.fixedCount != null ? t("{n} aleși", { n: s.fixedCount }) : s.filtersText || t("toți din filtru")}</div>
                  </td>
                  <td className="px-2 py-1.5">{describeSchedule(s.schedule, t, tag)}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">{s.active ? when(s.nextRunAt) : <span className="text-ink-soft">{t("oprită")}</span>}</td>
                  <td className="px-2 py-1.5">
                    <div className="whitespace-nowrap">{when(s.lastRunAt)}</div>
                    {s.lastResult && <div className="max-w-64 text-ink-soft">{s.lastResult}</div>}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{s.runCount}</td>
                  {canManage && (
                    <td className="whitespace-nowrap px-2 py-1.5">
                      <div className="flex flex-wrap justify-end gap-1">
                        <button type="button" disabled={busy === s.id} onClick={() => void act(s.id, () => setNotifyScheduleActiveAction(s.id, !s.active))} className={btn}>
                          {s.active ? t("Oprește") : t("Pornește")}
                        </button>
                        <button
                          type="button"
                          disabled={busy === s.id}
                          onClick={() => {
                            if (confirm(t("Trimiți acum notificarea „{name}” către toți destinatarii?", { name: s.name }))) void act(s.id, () => runNotifyScheduleNowAction(s.id), t("Pornită în fundal. Rezultatul apare la „Ultima rulare” și în jurnal."));
                          }}
                          className={btn}
                        >
                          {t("Rulează acum")}
                        </button>
                        <button
                          type="button"
                          disabled={busy === s.id}
                          onClick={() => {
                            if (confirm(t("Ștergi programarea „{name}”?", { name: s.name }))) void act(s.id, () => deleteNotifyScheduleAction(s.id));
                          }}
                          className={`${btn} text-st-cancelled`}
                        >
                          {t("Șterge")}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
