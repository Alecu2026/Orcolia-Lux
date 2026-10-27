/**
 * Reamintiri programate pentru sarcini / tichete: o singură dată (dată + oră), zilnic, săptămânal (una sau mai multe zile pe săptămână, la o oră),
 * lunar (într-o zi a lunii, la o oră) sau la interval personalizat (la fiecare N minute / ore / zile / săptămâni). Orele sunt ale firmei (fusul DEFAULT_TZ),
 * nu ale telefonului. Modul e pur (fără server-only): îl folosesc și serverul (calculul următoarei reamintiri), și formularul (previzualizare).
 */

import { DEFAULT_TZ, dateKeyOf, isValidDateKey, isValidTimeOfDay, zonedParts, zonedToUtc } from "./date";

export type ReminderUnit = "minutes" | "hours" | "days" | "weeks";

export type ReminderSchedule =
  /** O singură dată, la data și ora date. */
  | { kind: "once"; date: string; time: string }
  | { kind: "daily"; time: string; until?: string }
  /** `days`: 1 = luni … 7 = duminică (ex. [1, 3, 5] = de 3 ori pe săptămână). */
  | { kind: "weekly"; days: number[]; time: string; until?: string }
  /** `day`: 1–31 (într-o lună mai scurtă se ia ultima zi a lunii) sau 0 = ultima zi a lunii. */
  | { kind: "monthly"; day: number; time: string; until?: string }
  /** La fiecare `every` `unit`, începând de la `anchor` (instant ISO — prima reamintire). */
  | { kind: "every"; every: number; unit: ReminderUnit; anchor: string; until?: string };

export const REMINDER_UNITS: ReminderUnit[] = ["minutes", "hours", "days", "weeks"];
const UNIT_MS: Record<ReminderUnit, number> = { minutes: 60_000, hours: 3_600_000, days: 86_400_000, weeks: 7 * 86_400_000 };
/** Cea mai deasă reamintire acceptată: 1 minut (verificarea sarcinilor rulează la fiecare minut). */
export const MIN_EVERY_MS = 60_000;

const pad = (n: number) => (n < 10 ? `0${n}` : String(n));

/**
 * Validează și normalizează o programare venită din formular / bază de date (orice altceva → null). Pentru „la interval" fără început, prima reamintire
 * e peste un interval de acum (`now`); cu `startDate` + `startTime` — chiar la momentul ales.
 */
export function parseReminderSchedule(raw: unknown, now: Date = new Date(), tz = DEFAULT_TZ): ReminderSchedule | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const time = typeof o.time === "string" ? o.time : "";
  const until = typeof o.until === "string" && isValidDateKey(o.until) ? o.until : undefined;
  const withUntil = <T extends object>(s: T): T & { until?: string } => (until ? { ...s, until } : s);
  switch (o.kind) {
    case "once": {
      const date = typeof o.date === "string" ? o.date : "";
      return isValidDateKey(date) && isValidTimeOfDay(time) ? { kind: "once", date, time } : null;
    }
    case "daily":
      return isValidTimeOfDay(time) ? withUntil({ kind: "daily" as const, time }) : null;
    case "weekly": {
      const days = Array.isArray(o.days) ? [...new Set(o.days.map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort((a, b) => a - b) : [];
      return days.length > 0 && isValidTimeOfDay(time) ? withUntil({ kind: "weekly" as const, days, time }) : null;
    }
    case "monthly": {
      const day = Number(o.day);
      return Number.isInteger(day) && day >= 0 && day <= 31 && isValidTimeOfDay(time) ? withUntil({ kind: "monthly" as const, day, time }) : null;
    }
    case "every": {
      const every = Number(o.every);
      const unit = o.unit as ReminderUnit;
      if (!REMINDER_UNITS.includes(unit) || !Number.isFinite(every) || every <= 0 || !Number.isInteger(every)) return null;
      const step = every * UNIT_MS[unit];
      if (step < MIN_EVERY_MS || step > 366 * 86_400_000) return null;
      let anchor: Date;
      if (typeof o.anchor === "string" && !Number.isNaN(Date.parse(o.anchor))) anchor = new Date(o.anchor);
      else if (typeof o.startDate === "string" && isValidDateKey(o.startDate) && isValidTimeOfDay(typeof o.startTime === "string" ? o.startTime : "")) {
        anchor = zonedToUtc(o.startDate, o.startTime as string, tz);
      } else anchor = new Date(now.getTime() + step);
      return withUntil({ kind: "every" as const, every, unit, anchor: anchor.toISOString() });
    }
    default:
      return null;
  }
}

/** Ultima zi a lunii (1-based `month`). */
const lastDayOf = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Prima reamintire STRICT după `after` (null = nu mai urmează niciuna: programare unică trecută sau perioada „până la" depășită).
 * Zilnic / săptămânal / lunar: se caută prima zi potrivită din calendarul firmei, la ora dată (corect și la schimbarea orei de vară).
 */
export function computeNextRun(s: ReminderSchedule, after: Date, tz = DEFAULT_TZ): Date | null {
  const within = (d: Date | null): Date | null => {
    if (!d) return null;
    if (s.kind !== "once" && s.until && dateKeyOf(d, tz) > s.until) return null;
    return d;
  };
  if (s.kind === "once") {
    const at = zonedToUtc(s.date, s.time, tz);
    return at.getTime() > after.getTime() ? at : null;
  }
  if (s.kind === "every") {
    const step = s.every * UNIT_MS[s.unit];
    const anchor = Date.parse(s.anchor);
    if (!Number.isFinite(anchor) || step <= 0) return null;
    const k = after.getTime() < anchor ? 0 : Math.floor((after.getTime() - anchor) / step) + 1;
    return within(new Date(anchor + k * step));
  }
  // zilnic / săptămânal / lunar: parcurgem zilele începând cu ziua lui `after` (în fusul firmei)
  const p = zonedParts(after, tz);
  for (let i = 0; i <= 400; i++) {
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day + i, 12)); // la amiază UTC: fără surprize la schimbarea orei
    const y = day.getUTCFullYear();
    const m = day.getUTCMonth() + 1;
    const d = day.getUTCDate();
    const isoWeekday = day.getUTCDay() === 0 ? 7 : day.getUTCDay();
    const matches =
      s.kind === "daily" ||
      (s.kind === "weekly" && s.days.includes(isoWeekday)) ||
      (s.kind === "monthly" && d === (s.day === 0 ? lastDayOf(y, m) : Math.min(s.day, lastDayOf(y, m))));
    if (!matches) continue;
    const at = zonedToUtc(`${y}-${pad(m)}-${pad(d)}`, s.time, tz);
    if (at.getTime() > after.getTime()) return within(at);
  }
  return null;
}

/** Descrierea programării, pentru afișare („Săptămânal: lun, mie, vin la 09:00”). `t` = traducerea; `tag` = limba pentru numele zilelor. */
export function describeSchedule(
  s: ReminderSchedule,
  t: (ro: string, v?: Record<string, string | number>) => string,
  tag = "ro-RO",
  tz = DEFAULT_TZ,
): string {
  const dmy = (d: string) => d.split("-").reverse().join(".");
  const dayName = (d: number) => new Date(Date.UTC(2024, 0, d)).toLocaleDateString(tag, { weekday: "short", timeZone: "UTC" }); // 2024-01-01 = luni
  const tail = s.kind !== "once" && s.until ? ` · ${t("până la {date}", { date: dmy(s.until) })}` : "";
  switch (s.kind) {
    case "once":
      return t("O singură dată: {date} la {time}", { date: dmy(s.date), time: s.time });
    case "daily":
      return t("Zilnic la {time}", { time: s.time }) + tail;
    case "weekly":
      return t("Săptămânal: {days} la {time}", { days: s.days.map(dayName).join(", "), time: s.time }) + tail;
    case "monthly":
      return (s.day === 0 ? t("Lunar: în ultima zi a lunii la {time}", { time: s.time }) : t("Lunar: în ziua {day} la {time}", { day: s.day, time: s.time })) + tail;
    case "every": {
      const unit = s.unit === "minutes" ? t("minute") : s.unit === "hours" ? t("ore") : s.unit === "days" ? t("zile") : t("săptămâni");
      const p = zonedParts(new Date(s.anchor), tz);
      const start = `${pad(p.day)}.${pad(p.month)}.${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
      return t("La fiecare {n} {unit}, începând de la {start}", { n: s.every, unit, start }) + tail;
    }
  }
}
