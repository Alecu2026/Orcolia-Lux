// Închiderea unei cereri: „măsuri luate” și „timp de rezolvare” — formate, parsare, limite (cod partajat server / browser).

export const MEASURES_MIN = 3;
export const MEASURES_MAX = 2000;
/** Cel mult un an de muncă pe o cerere (minute): peste e, aproape sigur, o greșeală de tastare. */
export const RESOLUTION_MAX_MINUTES = 60 * 24 * 365;

export type Resolution = { measures: string; minutes: number | null };

/** 150 → „2 h 30 min”; 45 → „45 min”; 120 → „2 h”. */
export function formatMinutes(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min < 0) return "";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

/**
 * Durata scrisă de om → minute. Acceptă „2 h 30 min”, „2h”, „45 min”, „1:30” (ore:minute), „1,5 h”, „90” (minute). Gol / necunoscut → null.
 * Folosită la import (coloana „Timp de rezolvare”).
 */
export function parseDuration(raw: string | null | undefined): number | null {
  const s = (raw ?? "").trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  let m = /^(\d{1,3}):(\d{1,2})$/.exec(s);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (m) return Math.round(Number(m[1]));
  const h = /(\d+(?:\.\d+)?)\s*(?:h|ore|ora|oră|час|ч)\b/.exec(s);
  const mn = /(\d+)\s*(?:min|minute|minut|мин|м)\b/.exec(s);
  const d = /(\d+)\s*(?:zile|zi|d|дн|день)\b/.exec(s);
  if (!h && !mn && !d) return null;
  return Math.round((d ? Number(d[1]) * 1440 : 0) + (h ? Number(h[1]) * 60 : 0) + (mn ? Number(mn[1]) : 0));
}

/** Timpul scurs (ms) în cuvinte: „2 zile 3 ore”, „5 ore 10 min”, „12 min”. `t` = traducerea (opțională). */
export function formatElapsed(ms: number, t: (ro: string, v?: Record<string, string | number>) => string = (s, v) => (v ? s.replace(/\{(\w+)\}/g, (_, k) => String(v[k])) : s)): string {
  const totalMin = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d) return h ? `${t("{n} zile", { n: d })} ${t("{n} h", { n: h })}` : t("{n} zile", { n: d });
  if (h) return m ? `${t("{n} h", { n: h })} ${t("{n} min", { n: m })}` : t("{n} h", { n: h });
  return t("{n} min", { n: m });
}

/** Validare comună (server + formular): textul măsurilor și timpul. Întoarce eroarea (cheie de traducere) sau null. */
export function validateResolution(r: { measures?: string | null; minutes?: number | null }): string | null {
  const text = (r.measures ?? "").trim();
  if (text.length < MEASURES_MIN) return "Completează „Măsuri luate” (cel puțin 3 caractere).";
  if (text.length > MEASURES_MAX) return "„Măsuri luate” este prea lung.";
  if (r.minutes != null && (!Number.isInteger(r.minutes) || r.minutes < 0 || r.minutes > RESOLUTION_MAX_MINUTES)) return "Timpul de rezolvare e invalid.";
  return null;
}
