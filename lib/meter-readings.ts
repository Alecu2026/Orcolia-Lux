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
 * 6 indexul citit luna aceasta (null = necitit), 7 când a fost citit (ms), 8 are poză (0/1), 9 cine a citit, 10 distanța (m) față de locația citirii anterioare.
 */
export type FieldTuple = [string, string, string, string | null, number | null, string | null, number | null, number | null, 0 | 1, string | null, number | null];

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
  /** Cine a făcut citirea (luna aceasta). */
  by: string | null;
  /** Distanța (m) față de locația citirii anterioare — mare = de verificat. */
  distanceM: number | null;
  /** Consumul = indexul citit − ultimul index cunoscut (m³), sau null dacă lipsește unul dintre ele. */
  consum: number | null;
  /** Text de căutare (litere mici). */
  _h: string;
  /** Adresa în litere mici (filtrul „Stradă / adresă”). */
  _a: string;
};

const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** Consumul unui rând: indexul de luna aceasta minus ultimul index cunoscut. */
export const fieldConsum = (value: number | null, lastIndex: number | null): number | null => (value != null && lastIndex != null ? round3(value - lastIndex) : null);

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
    by: x[9] ?? null,
    distanceM: x[10] ?? null,
    consum: fieldConsum(x[6], x[4]),
    _h: [x[1], x[2], x[3]].filter(Boolean).join("\n").toLowerCase(),
    _a: (x[3] ?? "").toLowerCase(),
  }));
}

// ── Filtre + sortare pentru tabelul „Citiri teren” (rulează în browser, pe toată lista) ───────────────────────────────

export type FieldFilters = {
  q: string;
  /** Stradă / adresă (conține). */
  street: string;
  /** „unread” = necitite luna aceasta (implicit), „read” = citite, „all” = toate. */
  status: "unread" | "read" | "all";
  photo: "" | "yes" | "no";
  /** De verificat: consum negativ / neobișnuit de mare / zero, sau citit departe de locația anterioară. */
  check: "" | "lower" | "high" | "zero" | "far";
  /** Cine a citit (numele). */
  by: string;
  sort: "" | "contor" | "name" | "readDesc" | "consumDesc" | "consumAsc";
};

export const EMPTY_FIELD_FILTERS: FieldFilters = { q: "", street: "", status: "unread", photo: "", check: "", by: "", sort: "" };

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T => (typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : dflt);

export function sanitizeFieldFilters(raw: Record<string, unknown>): FieldFilters {
  const txt = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");
  return {
    q: txt(raw.q),
    street: txt(raw.street),
    status: oneOf(raw.status, ["unread", "read", "all"] as const, "unread"),
    photo: oneOf(raw.photo, ["", "yes", "no"] as const, ""),
    check: oneOf(raw.check, ["", "lower", "high", "zero", "far"] as const, ""),
    by: txt(raw.by),
    sort: oneOf(raw.sort, ["", "contor", "name", "readDesc", "consumDesc", "consumAsc"] as const, ""),
  };
}

/** Câte filtre sunt active (față de starea implicită: necitite, fără alte filtre). Sortarea nu se numără. */
export function countActiveFieldFilters(f: FieldFilters): number {
  return (f.q ? 1 : 0) + (f.street ? 1 : 0) + (f.status !== "unread" ? 1 : 0) + (f.photo ? 1 : 0) + (f.check ? 1 : 0) + (f.by ? 1 : 0);
}

export function fieldFiltersToParams(f: FieldFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.street) p.set("street", f.street);
  if (f.status !== "unread") p.set("status", f.status);
  if (f.photo) p.set("photo", f.photo);
  if (f.check) p.set("check", f.check);
  if (f.by) p.set("by", f.by);
  if (f.sort) p.set("sort", f.sort);
  return p;
}

const collator = new Intl.Collator("ro", { numeric: true });

/** Rândul e „de verificat”? (consum negativ, salt mare sau citit departe de locația anterioară) */
export const fieldSuspect = (r: FieldRow): "lower" | "high" | "far" | null =>
  r.consum != null && r.consum < 0 ? "lower" : r.consum != null && r.consum > JUMP_CONFIRM_M3 ? "high" : r.distanceM != null && r.distanceM > FAR_METERS ? "far" : null;

/** Filtrează și sortează lista completă. Fără sortare explicită păstrează ordinea adreselor (cea de pe server). */
export function filterField(rows: FieldRow[], f: FieldFilters): FieldRow[] {
  const tokens = f.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5);
  const street = f.street.toLowerCase();
  const out = rows.filter((r) => {
    if (f.status === "unread" ? r.value != null : f.status === "read" ? r.value == null : false) return false;
    if (f.photo === "yes" ? !r.photo : f.photo === "no" ? r.photo : false) return false;
    if (f.by && r.by !== f.by) return false;
    if (street && !r._a.includes(street)) return false;
    for (const tk of tokens) if (!r._h.includes(tk)) return false;
    if (f.check) {
      if (r.value == null) return false;
      const ok =
        f.check === "lower" ? r.consum != null && r.consum < 0
        : f.check === "high" ? r.consum != null && r.consum > JUMP_CONFIRM_M3
        : f.check === "zero" ? r.consum === 0
        : r.distanceM != null && r.distanceM > FAR_METERS;
      if (!ok) return false;
    }
    return true;
  });
  switch (f.sort) {
    case "contor": return out.sort((a, b) => collator.compare(a.contor, b.contor));
    case "name": return out.sort((a, b) => collator.compare(a.name, b.name));
    case "readDesc": return out.sort((a, b) => (b.readAt ?? -1) - (a.readAt ?? -1));
    case "consumDesc": return out.sort((a, b) => (b.consum ?? -Infinity) - (a.consum ?? -Infinity));
    case "consumAsc": return out.sort((a, b) => (a.consum ?? Infinity) - (b.consum ?? Infinity));
    default: return out;
  }
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
