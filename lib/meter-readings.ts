/**
 * Cod partajat (server + client) pentru citirile lunare din teren: luna curentă, distanța dintre două puncte GPS, limitele de validare și
 * formele de date trimise între server și pagina „Citiri teren". Fără "server-only" — rulează și în browser.
 */

/** Fusul orar al firmei: „luna aceasta" se socotește după el, nu după ceasul telefonului. */
export const READING_TZ = "Europe/Bucharest";

/** „YYYY-MM" pentru momentul dat, în fusul firmei. */
export function currentPeriod(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: READING_TZ, year: "numeric", month: "2-digit" }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? String(d.getUTCFullYear());
  const m = parts.find((p) => p.type === "month")?.value ?? String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Luna dinaintea celei date („YYYY-MM"), de `back` ori. */
export function shiftPeriod(period: string, back: number): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Indexul maxim acceptat (m³). */
export const MAX_INDEX = 99_999_999;
/** Un consum mai mare decât atât într-o lună cere confirmare (probabil o greșeală de tastare). */
export const JUMP_CONFIRM_M3 = 200;
/** Peste această distanță față de locația ultimei citiri, citirea e semnalată pentru verificare. */
export const FAR_METERS = 150;

/** Distanța dintre două puncte GPS, în metri (haversine). */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Indexul scris de utilizator („1234,5" sau „1234.5") → număr, sau null dacă nu e valid. */
export function parseIndex(raw: string): number | null {
  const s = raw.trim().replace(/\s+/g, "").replace(",", ".");
  if (!/^\d{1,8}(\.\d{1,3})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= MAX_INDEX ? n : null;
}

/**
 * Un contor din lista de teren, ca tuplu: 0 id, 1 nr. contor, 2 abonat, 3 adresă, 4 ultimul index cunoscut (m³), 5 data lui („YYYY-MM-DD"),
 * 6 indexul citit luna aceasta (null = necitit), 7 când a fost citit (ms), 8 are poză (0/1).
 */
export type FieldTuple = [string, string, string, string | null, number | null, string | null, number | null, number | null, 0 | 1];

export type FieldRow = {
  id: string;
  contor: string;
  name: string;
  address: string | null;
  lastIndex: number | null;
  lastDate: string | null;
  value: number | null;
  readAt: number | null;
  photo: boolean;
  /** Text de căutare (litere mici). */
  _h: string;
};

export function decodeField(t: FieldTuple[]): FieldRow[] {
  return t.map((x) => ({
    id: x[0],
    contor: x[1],
    name: x[2],
    address: x[3],
    lastIndex: x[4],
    lastDate: x[5],
    value: x[6],
    readAt: x[7],
    photo: x[8] === 1,
    _h: [x[1], x[2], x[3]].filter(Boolean).join("\n").toLowerCase(),
  }));
}

/** O citire salvată, așa cum o primește interfața. */
export type ReadingDto = {
  id: string;
  meterId: string;
  contor: string;
  period: string;
  value: number;
  prevValue: number | null;
  readAt: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  distanceM: number | null;
  photoUrl: string | null;
  userName: string;
};

export type SaveReadingResult =
  | { ok: true; reading: ReadingDto }
  /** `confirm`: citirea pare greșită (mai mică decât cea anterioară / un salt mare) — se salvează abia după confirmare. */
  | { ok: false; error: string; confirm?: "lower" | "high" };

export type PhotoResult = { ok: true; photoUrl: string } | { ok: false; error: string };

/** Link către locație pe hartă. */
export const mapsUrl = (lat: number, lng: number) => `https://www.google.com/maps?q=${lat},${lng}`;
