"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createQuickAppointment,
  updateAppointmentAction,
  type ApptState,
} from "@/app/actions/appointments";
import type { CategoryLite, QuickDefaults, QuickPrefill } from "./types";
import ClientCombobox from "./ClientCombobox";
import { IconCheck, IconMail, IconSend, IconX } from "./icons";
import ReminderPicker from "./ReminderPicker";
import AppointmentLocationField from "./AppointmentLocationField";
import { DEFAULT_TZ, zonedToUtc } from "@/lib/date";
import { presetsToMinutes } from "@/lib/reminder-presets";
import { useMessages } from "@/lib/i18n/context";
import { useT } from "@/lib/i18n/context";

/** Următorul interval liber de azi, după ceasul din fusul orar ales în setări (nu al browserului). */
function nextSlot(slot: number, tz?: string): string {
  let h: number, mi: number;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
    h = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
    mi = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  } catch {
    const d = new Date();
    h = d.getHours(); mi = d.getMinutes();
  }
  let total = h * 60 + mi + 5;
  total = Math.ceil(total / slot) * slot;
  if (total >= 1440) total = 1440 - slot;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

const chip =
  "tap rounded-full px-3.5 py-2 text-sm font-medium border border-[var(--color-line)]";

export default function QuickAddDialog({
  categories,
  defaults,
  prefill,
  onClose,
}: {
  categories: CategoryLite[];
  defaults: QuickDefaults;
  prefill?: QuickPrefill;
  onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const m = useMessages();
  const editId = prefill?.id ?? "";
  const [state, formAction, pending] = useActionState<ApptState, FormData>(
    editId ? updateAppointmentAction : createQuickAppointment,
    undefined,
  );

  const [client, setClient] = useState({
    id: prefill?.clientId ?? "",
    name: prefill?.clientName ?? "",
  });
  const [categoryId, setCategoryId] = useState(prefill?.categoryId ?? "");
  const [dateKey, setDateKey] = useState(prefill?.dateKey ?? defaults.today);
  const [time, setTime] = useState(prefill?.time ?? nextSlot(defaults.slotMinutes, defaults.tz));
  const [duration, setDuration] = useState(
    String(prefill?.durationMinutes ?? defaults.slotMinutes),
  );
  const [message, setMessage] = useState(prefill?.message ?? "");
  const [remEmail, setRemEmail] = useState(
    prefill?.reminderEmail ?? defaults.reminderEmail,
  );
  const [remTelegram, setRemTelegram] = useState(
    prefill?.reminderTelegram ?? defaults.reminderTelegram,
  );
  // Reminderele (ca la sarcini): programarea salvată; la o programare veche — pragurile fixe vechi convertite în „înainte de începere”; la una nouă — standardul din setări
  const [remSchedule] = useState<string | null>(() => {
    if (prefill?.reminderSchedule) return prefill.reminderSchedule;
    if (prefill?.reminderIntervalMinutes) return null;
    const mins = presetsToMinutes(prefill?.reminderOffsets ?? (editId ? [] : defaults.reminderOffsets), prefill?.time);
    return mins.length ? JSON.stringify({ kind: "before", offsets: mins }) : null;
  });
  const startAtIso = (() => {
    try {
      return zonedToUtc(dateKey, time, DEFAULT_TZ).toISOString();
    } catch {
      return "";
    }
  })();
  const [assigneeId, setAssigneeId] = useState(prefill?.assigneeId ?? "");
  const [status, setStatus] = useState<"NEW" | "CONFIRMED">(
    prefill?.status ?? "NEW",
  );

  // La selectarea categoriei, preia durata default
  function pickCategory(id: string) {
    setCategoryId(id);
    const c = categories.find((x) => x.id === id);
    if (c) setDuration(String(c.defaultDurationMinutes));
  }

  useEffect(() => {
    if (state?.ok) {
      router.refresh();
      onClose();
    }
  }, [state, router, onClose]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card max-h-[92dvh] w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl p-5 shadow-2xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{editId ? t("Editează programarea") : m.appts.newTitle}</h2>
          <button
            onClick={onClose}
            className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]"
            aria-label={m.common.close}
          >
            <IconX className="size-4" />
          </button>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          {/* Hidden inputs sincronizate cu starea */}
          {editId && <input type="hidden" name="id" value={editId} />}
          <input type="hidden" name="clientId" value={client.id} />
          <input type="hidden" name="clientName" value={client.id ? "" : client.name} />
          <input type="hidden" name="categoryId" value={categoryId} />
          <input type="hidden" name="assigneeId" value={assigneeId} />
          <input type="hidden" name="dateKey" value={dateKey} />
          <input type="hidden" name="durationMinutes" value={duration} />
          <input type="hidden" name="reminderEmail" value={remEmail ? "true" : "false"} />
          <input type="hidden" name="reminderTelegram" value={remTelegram ? "true" : "false"} />
          <input type="hidden" name="status" value={status} />

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-soft">{m.appts.clientLabel}</label>
            <ClientCombobox value={client} onPick={setClient} />
          </div>

          {(defaults.assignees?.length ?? 0) > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-soft">{t("Pentru (cine participă)")}</label>
              <select
                value={assigneeId}
                onChange={(e) => setAssigneeId(e.target.value)}
                className="h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
              >
                <option value="">{t("— fără —")}</option>
                {defaults.assignees!.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.me ? ` (${t("eu")})` : ""}</option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-ink-soft">{t("Programarea apare și la el, iar el și tu primiți notificare (aplicație, push, Telegram).")}</p>
            </div>
          )}

          {categories.length > 0 && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-soft">{m.appts.categoryLabel}</label>
              <select
                value={categoryId}
                onChange={(e) => pickCategory(e.target.value)}
                className="h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
              >
                <option value="">{t("— fără categorie —")}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink-soft">{m.appts.dateLabel}</label>
              <div className="mb-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setDateKey(defaults.today)}
                  className={`${chip} flex-1 ${dateKey === defaults.today ? "bg-brand text-white" : ""}`}
                >
                  {m.appts.todayBtn}
                </button>
                <button
                  type="button"
                  onClick={() => setDateKey(defaults.tomorrow)}
                  className={`${chip} flex-1 ${dateKey === defaults.tomorrow ? "bg-brand text-white" : ""}`}
                >
                  {m.appts.tomorrowBtn}
                </button>
              </div>
              <input
                type="date"
                value={dateKey}
                onChange={(e) => setDateKey(e.target.value)}
                className="h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:block">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-ink-soft">{m.appts.timeLabel}</label>
                <input
                  type="time"
                  name="time"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  className="h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-base outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="mt-0 sm:mt-2 mb-1 block text-xs font-semibold text-ink-soft">{m.appts.durationLabel}</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={1440}
                  step={1}
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                  placeholder={t("ex. 30")}
                  className="h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
                />
              </div>
            </div>
          </div>

          <AppointmentLocationField initial={{ address: prefill?.address, lat: prefill?.lat ?? null, lng: prefill?.lng ?? null, mapUrl: prefill?.mapUrl }} />

          <input
            name="title"
            defaultValue={prefill?.title ?? ""}
            maxLength={120}
                        placeholder={t("Descriere scurtă (ex. Citire contor)")}
            className="h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
          />
          <input
            name="message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={m.appts.messagePlaceholder}
            className="h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
          />

          <div className="flex flex-wrap items-center gap-2">
            {(!editId || prefill?.status) && <button
              type="button"
              onClick={() => setStatus(status === "NEW" ? "CONFIRMED" : "NEW")}
              className={`${chip} inline-flex items-center gap-1.5 ${status === "CONFIRMED" ? "bg-st-confirmed text-white" : ""}`}
            >
              {status === "CONFIRMED" && <IconCheck className="size-3.5" />}
              {status === "CONFIRMED" ? m.appts.statusConfirmed : m.appts.statusNew}
            </button>}
            <button
              type="button"
              onClick={() => setRemEmail(!remEmail)}
              className={`${chip} inline-flex items-center gap-1.5 ${remEmail ? "bg-brand text-white" : ""}`}
            >
              <IconMail className="size-3.5" /> Email
            </button>
            <button
              type="button"
              onClick={() => setRemTelegram(!remTelegram)}
              className={`${chip} inline-flex items-center gap-1.5 ${remTelegram ? "bg-brand text-white" : ""}`}
            >
              <IconSend className="size-3.5" /> Telegram
            </button>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-ink-soft">{m.appts.remindersLabel}</label>
            <ReminderPicker interval={prefill?.reminderIntervalMinutes ?? null} schedule={remSchedule} startAt={startAtIso} />
            <p className="mt-1.5 text-[11px] text-ink-soft">{t("Reamintirile ajung la tine (aplicație, push, Telegram). Clientul primește email / Telegram doar dacă bifezi canalul de mai sus.")}</p>
          </div>

          {state?.error && (
            <p className="rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
              {t(state.error)}
            </p>
          )}

          <button
            type="submit"
            disabled={pending || (!client.id && !client.name.trim())}
            className="tap h-13 min-h-12 rounded-xl bg-brand py-3 text-base font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
          >
            {pending ? m.common.saving : editId ? t("Salvează modificările") : m.appts.saveBtn}
          </button>
        </form>
      </div>
    </div>
  );
}
