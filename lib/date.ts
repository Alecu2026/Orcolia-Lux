/**
 * Helpers de dată conștiente de fusul orar, fără dependențe externe.
 * Folosim Intl pentru a calcula offset-ul fusului la un anumit moment.
 *
 * Convenție cheie: `dateKey` = "YYYY-MM-DD" în fusul orar al userului.
 * Toate Date-urile stocate sunt UTC (Mongo/Prisma).
 */

export const DEFAULT_TZ = "Europe/Bucharest";

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Offset-ul fusului (ms) la momentul `date`: localWallClockAsUTC - actualUTC. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  // `hour` poate fi 24 la miezul nopții în unele runtime-uri
  const hour = map.hour === 24 ? 0 : map.hour;
  const asUTC = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    hour,
    map.minute,
    map.second,
  );
  return asUTC - date.getTime();
}

/** Componentele wall-clock (an/lună/zi/oră/min) ale unui instant în fusul dat. */
export function zonedParts(date: Date, timeZone: string) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const map: Record<string, number> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour === 24 ? 0 : map.hour,
    minute: map.minute,
  };
}

/** dateKey "YYYY-MM-DD" pentru un instant, în fusul dat. */
export function dateKeyOf(date: Date, timeZone = DEFAULT_TZ): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Transformă o oră de perete (dateKey + "HH:mm" în fus) într-un Date UTC. */
export function zonedToUtc(
  dateKey: string,
  time: string,
  timeZone = DEFAULT_TZ,
): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  // O singură corecție de offset acoperă toate cazurile, cu excepția marginilor DST.
  const offset = tzOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

/** Formatează un Date UTC ca "HH:mm" în fusul dat. */
export function formatTime(date: Date, timeZone = DEFAULT_TZ): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** Formatează un Date ca "dd.MM.yyyy" în fusul dat. */
export function formatDate(date: Date, timeZone = DEFAULT_TZ): string {
  const p = zonedParts(date, timeZone);
  return `${pad(p.day)}.${pad(p.month)}.${p.year}`;
}

/** Începutul (00:00 local) și sfârșitul (24:00 local) unui dateKey, ca instant UTC. */
export function dayBoundsUtc(dateKey: string, timeZone = DEFAULT_TZ) {
  const start = zonedToUtc(dateKey, "00:00", timeZone);
  const [y, m, d] = dateKey.split("-").map(Number);
  const nextKey = dateKeyOf(
    new Date(Date.UTC(y, m - 1, d + 1, 12, 0, 0)),
    timeZone,
  );
  const end = zonedToUtc(nextKey, "00:00", timeZone);
  return { start, end };
}

export function todayKey(timeZone = DEFAULT_TZ): string {
  return dateKeyOf(new Date(), timeZone);
}

export function addDaysToKey(
  dateKey: string,
  days: number,
  timeZone = DEFAULT_TZ,
): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return dateKeyOf(new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0)), timeZone);
}

export function tomorrowKey(timeZone = DEFAULT_TZ): string {
  return addDaysToKey(todayKey(timeZone), 1, timeZone);
}

/** Lista de dateKey-uri (Luni→Duminică) pentru săptămâna care conține `fromKey`. */
export function weekKeys(
  fromKey = todayKey(),
  timeZone = DEFAULT_TZ,
): string[] {
  const [y, m, d] = fromKey.split("-").map(Number);
  const ref = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  // getUTCDay: 0=Dum..6=Sâm; vrem Luni ca prima zi
  const dow = (ref.getUTCDay() + 6) % 7;
  const monday = addDaysToKey(fromKey, -dow, timeZone);
  return Array.from({ length: 7 }, (_, i) => addDaysToKey(monday, i, timeZone));
}

/** Toate dateKey-urile dintr-o lună (pentru month view). */
export function monthKeys(year: number, month1: number, timeZone = DEFAULT_TZ): string[] {
  const keys: string[] = [];
  const daysInMonth = new Date(Date.UTC(year, month1, 0)).getUTCDate();
  for (let d = 1; d <= daysInMonth; d++) {
    keys.push(`${year}-${pad(month1)}-${pad(d)}`);
  }
  return keys;
}

/** Etichetă scurtă pentru zi, ex. "Vineri 14 iun". */
export function humanDay(dateKey: string, timeZone = DEFAULT_TZ, locale = "ro-RO"): string {
  const { start } = dayBoundsUtc(dateKey, timeZone);
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "short",
  }).format(start);
}
