"use client";

import { useMemo, useState } from "react";
import { DEFAULT_TZ, zonedParts } from "@/lib/date";
import { computeNextRun, describeSchedule, parseReminderSchedule, type ReminderSchedule, type ReminderUnit } from "@/lib/reminder-schedule";
import { useLocale, useMessages, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";

type Mode = "none" | "fixed" | "once" | "daily" | "weekly" | "monthly" | "every";

const FIXED = [10, 30, 60, 180, 360, 720, 1440, 10080] as const;
const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
const inp = "h-9 min-w-0 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 text-sm outline-none focus:border-brand";
const chip = (on: boolean) =>
  `tap h-8 cursor-pointer rounded-lg border px-2.5 text-xs font-semibold ${on ? "border-brand bg-brand text-white" : "border-[var(--color-line)] text-ink-soft hover:bg-brand-soft"}`;

/** Ziua de mâine (data firmei) — valoarea implicită pentru „o singură dată”. */
function tomorrowKey(): string {
  const p = zonedParts(new Date(Date.now() + 86_400_000), DEFAULT_TZ);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/**
 * „Reamintire periodică” pentru sarcini / tichete: fără reamintire, interval fix, sau o programare — o singură dată (dată + oră), zilnic, săptămânal
 * (zilele alese, ex. de 3 ori pe săptămână, la o oră), lunar (într-o zi a lunii, la o oră) ori la interval personalizat (la fiecare N minute / ore / zile / săptămâni).
 * Orele sunt ale firmei. Se trimite prin două câmpuri ascunse: `reminderIntervalMinutes` (interval fix) și `reminderSchedule` (JSON, validat pe server).
 */
export default function ReminderPicker({ interval, schedule }: { interval: number | null; schedule: string | null }) {
  const t = useT();
  const m = useMessages();
  const tag = dateTag(useLocale());

  // starea inițială din ce are deja sarcina (interval fix sau programare salvată)
  const init = useMemo(() => {
    let s: ReminderSchedule | null = null;
    try {
      s = schedule ? parseReminderSchedule(JSON.parse(schedule)) : null;
    } catch {}
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const anchor = init?.kind === "every" ? zonedParts(new Date(init.anchor), DEFAULT_TZ) : null;

  const [mode, setMode] = useState<Mode>(init ? init.kind : interval && interval > 0 ? "fixed" : "none");
  const [fixed, setFixed] = useState<number>(interval && interval > 0 ? interval : 60);
  const [date, setDate] = useState(init?.kind === "once" ? init.date : tomorrowKey());
  const [time, setTime] = useState(init && init.kind !== "every" ? init.time : "09:00");
  const [days, setDays] = useState<number[]>(init?.kind === "weekly" ? init.days : [1]);
  const [monthDay, setMonthDay] = useState<number>(init?.kind === "monthly" ? init.day : 1);
  const [every, setEvery] = useState<number>(init?.kind === "every" ? init.every : 2);
  const [unit, setUnit] = useState<ReminderUnit>(init?.kind === "every" ? init.unit : "hours");
  const [startDate, setStartDate] = useState(anchor ? `${anchor.year}-${pad(anchor.month)}-${pad(anchor.day)}` : "");
  const [startTime, setStartTime] = useState(anchor ? `${pad(anchor.hour)}:${pad(anchor.minute)}` : "");
  const today = (() => {
    const p = zonedParts(new Date(), DEFAULT_TZ);
    return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  })();
  const [until, setUntil] = useState(init && init.kind !== "once" ? (init.until ?? "") : "");

  // programarea curentă, ca obiect (null = nu e programată sau e incompletă)
  const built = useMemo<ReminderSchedule | null>(() => {
    const u = until ? { until } : {};
    if (mode === "once") return parseReminderSchedule({ kind: "once", date, time });
    if (mode === "daily") return parseReminderSchedule({ kind: "daily", time, ...u });
    if (mode === "weekly") return parseReminderSchedule({ kind: "weekly", days, time, ...u });
    if (mode === "monthly") return parseReminderSchedule({ kind: "monthly", day: monthDay, time, ...u });
    if (mode === "every") {
      // cu început ales → ancora = începutul; la editare fără modificări începutul din formular reproduce exact ancora salvată
      return parseReminderSchedule({ kind: "every", every, unit, ...(startDate || startTime ? { startDate: startDate || today, startTime: startTime || "00:00" } : {}), ...u });
    }
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, date, time, days, monthDay, every, unit, startDate, startTime, until]);

  const next = built ? computeNextRun(built, new Date()) : null;
  const fmtNext = (d: Date) => d.toLocaleString(tag, { timeZone: DEFAULT_TZ, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const incomplete = mode !== "none" && mode !== "fixed" && !built;

  const dayName = (d: number) => new Date(Date.UTC(2024, 0, d)).toLocaleDateString(tag, { weekday: "short", timeZone: "UTC" });
  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));
  const preset = (list: number[]) => setDays(list);

  const fixedLabel: Record<number, string> = {
    10: m.tasks.reminder10m, 30: m.tasks.reminder30m, 60: m.tasks.reminder1h, 180: m.tasks.reminder3h,
    360: m.tasks.reminder6h, 720: m.tasks.reminder12h, 1440: m.tasks.reminder24h, 10080: m.tasks.reminder7d,
  };

  return (
    <div className="flex flex-col gap-2">
      {/* câmpurile trimise cu formularul */}
      <input type="hidden" name="reminderIntervalMinutes" value={mode === "fixed" ? fixed : 0} />
      <input type="hidden" name="reminderSchedule" value={built ? JSON.stringify(built) : ""} />

      <select
        value={mode === "fixed" ? `fixed:${fixed}` : mode}
        onChange={(e) => {
          const v = e.target.value;
          if (v.startsWith("fixed:")) {
            setMode("fixed");
            setFixed(Number(v.slice(6)));
          } else setMode(v as Mode);
        }}
        aria-label={m.tasks.reminderLabel}
        className={`${inp} w-full`}
      >
        <option value="none">{m.tasks.reminderNever}</option>
        <optgroup label={t("Interval fix")}>
          {FIXED.map((n) => (
            <option key={n} value={`fixed:${n}`}>{fixedLabel[n]}</option>
          ))}
        </optgroup>
        <optgroup label={t("Programată (la o oră anume)")}>
          <option value="once">{t("O singură dată (dată și oră)")}</option>
          <option value="daily">{t("Zilnic, la o oră")}</option>
          <option value="weekly">{t("Săptămânal (zilele alese, la o oră)")}</option>
          <option value="monthly">{t("Lunar (într-o zi a lunii, la o oră)")}</option>
          <option value="every">{t("Interval personalizat (la fiecare N minute / ore / zile)")}</option>
        </optgroup>
      </select>

      {mode !== "none" && mode !== "fixed" && (
        <div className="flex flex-col gap-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)]/50 p-3">
          {mode === "once" && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="text-[11px] font-semibold text-ink-soft">
                {t("Data")}
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={`${inp} mt-0.5 w-full`} />
              </label>
              <label className="text-[11px] font-semibold text-ink-soft">
                {t("Ora")}
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${inp} mt-0.5 w-full`} />
              </label>
            </div>
          )}

          {(mode === "daily" || mode === "weekly" || mode === "monthly") && (
            <>
              {mode === "weekly" && (
                <div>
                  <p className="mb-1 text-[11px] font-semibold text-ink-soft">{t("În zilele")}</p>
                  <div className="flex flex-wrap gap-1">
                    {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                      <button key={d} type="button" onClick={() => toggleDay(d)} aria-pressed={days.includes(d)} className={chip(days.includes(d))}>
                        {dayName(d)}
                      </button>
                    ))}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
                    <button type="button" onClick={() => preset([1, 2, 3, 4, 5])} className="tap cursor-pointer text-brand underline">{t("Luni–Vineri")}</button>
                    <span className="text-ink-soft">·</span>
                    <button type="button" onClick={() => preset([1, 3, 5])} className="tap cursor-pointer text-brand underline">{t("de 3 ori pe săptămână (L, Mi, V)")}</button>
                    <span className="text-ink-soft">·</span>
                    <button type="button" onClick={() => preset([1])} className="tap cursor-pointer text-brand underline">{t("o dată pe săptămână (luni)")}</button>
                  </div>
                </div>
              )}
              {mode === "monthly" && (
                <label className="text-[11px] font-semibold text-ink-soft">
                  {t("În ziua")}
                  <select value={monthDay} onChange={(e) => setMonthDay(Number(e.target.value))} className={`${inp} mt-0.5 w-full`}>
                    {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                    <option value={0}>{t("Ultima zi a lunii")}</option>
                  </select>
                </label>
              )}
              <label className="text-[11px] font-semibold text-ink-soft">
                {t("La ora")}
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={`${inp} mt-0.5 w-full sm:w-40`} />
              </label>
            </>
          )}

          {mode === "every" && (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-[11px] font-semibold text-ink-soft">
                  {t("La fiecare")}
                  <input type="number" min={1} step={1} value={every} onChange={(e) => setEvery(Number(e.target.value))} className={`${inp} mt-0.5 w-24`} />
                </label>
                <select value={unit} onChange={(e) => setUnit(e.target.value as ReminderUnit)} aria-label={t("Unitate")} className={`${inp} w-36`}>
                  <option value="minutes">{t("minute")}</option>
                  <option value="hours">{t("ore")}</option>
                  <option value="days">{t("zile")}</option>
                  <option value="weeks">{t("săptămâni")}</option>
                </select>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="text-[11px] font-semibold text-ink-soft">
                  {t("Începând de la data (opțional)")}
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={`${inp} mt-0.5 w-full`} />
                </label>
                <label className="text-[11px] font-semibold text-ink-soft">
                  {t("Ora de început (opțional)")}
                  <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={`${inp} mt-0.5 w-full`} />
                </label>
              </div>
            </>
          )}

          {mode !== "once" && (
            <label className="text-[11px] font-semibold text-ink-soft">
              {t("Până la data (opțional)")}
              <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} className={`${inp} mt-0.5 w-full sm:w-48`} />
            </label>
          )}

          {incomplete && mode === "every" && (
            <p className="text-xs text-st-progress">{t("Alege un număr întreg de cel puțin 1 (maximum 366 de zile). Începutul e opțional: fără el, prima reamintire vine peste un interval.")}</p>
          )}
          {incomplete && mode !== "every" && <p className="text-xs text-st-progress">{t("Completează toate câmpurile: reamintirea nu se va salva până atunci.")}</p>}
          {built && (
            <p className="text-xs text-ink-soft">
              <b className="text-ink">{describeSchedule(built, t, tag)}</b>
              <span className="block">{next ? t("Următoarea reamintire: {when}", { when: fmtNext(next) }) : t("Nu mai urmează nicio reamintire (data și ora sunt în trecut sau perioada s-a încheiat).")}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
