/**
 * Contoarele LoRaWAN: tipuri comune (server + pagină) și normalizarea datelor primite de la serverul de noduri.
 * Serverul întoarce o listă `[{ name: "S09840657", volume_m3: 31.259, ts: 1793538001000, ts_string: "2026-11-01T13:00:01.000Z" }, …]`;
 * în CRM contoarele nu au prefixul „S”, deci se scoate. Doar transmisiile din luna curentă (fusul firmei) se păstrează ca citiri; restul se ignoră.
 */

/** Momentul (ora:minutul, în fusul firmei) de la care pornește extragerea zilnică. */
export const LORAWAN_HOUR = 23;
export const LORAWAN_MINUTE = 30;
/** Sursa afișată în lista de contoare și pe citiri. */
export const LORAWAN_LABEL = "LoRaWAN";
/** Valoarea `source` a citirilor salvate din LoRaWAN (MeterReading.source). */
export const LORAWAN_SOURCE = "LORAWAN";

export type LorawanRow = { name: string; volume: number; ts: Date };

export type LorawanParsed = { rows: LorawanRow[]; invalid: number; duplicates: number };

/** Numărul contorului ca în CRM: fără spații și fără prefixul „S” al LoRaWAN. */
export const normalizeMeterName = (raw: string): string => raw.trim().replace(/^s(?=\d)/i, "");

/** Același număr fără zerourile din față — pentru potrivirea când unul dintre sisteme nu le scrie. */
export const stripLeadingZeros = (n: string): string => n.replace(/^0+(?=.)/, "");

/**
 * Răspunsul serverului → rânduri curate. Un rând fără nume, cu volum negativ / nenumeric sau cu moment invalid se numără ca invalid; același contor de două ori
 * (nu ar trebui) rămâne cu transmisia cea mai recentă.
 */
export function parseLorawan(payload: unknown): LorawanParsed {
  if (!Array.isArray(payload)) throw new Error("Răspuns neașteptat de la serverul LoRaWAN (nu e o listă).");
  const byName = new Map<string, LorawanRow>();
  let invalid = 0;
  let duplicates = 0;
  for (const it of payload as unknown[]) {
    const o = it && typeof it === "object" ? (it as Record<string, unknown>) : null;
    const name = typeof o?.name === "string" ? normalizeMeterName(o.name) : "";
    const volume = typeof o?.volume_m3 === "number" ? o.volume_m3 : typeof o?.volume_m3 === "string" ? Number(o.volume_m3) : NaN;
    const tsRaw = typeof o?.ts === "number" ? o.ts : typeof o?.ts_string === "string" ? Date.parse(o.ts_string) : NaN;
    const ts = new Date(tsRaw);
    if (!name || !Number.isFinite(volume) || volume < 0 || volume > 99_999_999 || !Number.isFinite(ts.getTime())) {
      invalid++;
      continue;
    }
    const prev = byName.get(name);
    if (prev) {
      duplicates++;
      if (prev.ts.getTime() >= ts.getTime()) continue;
    }
    byName.set(name, { name, volume: Math.round(volume * 1000) / 1000, ts });
  }
  return { rows: [...byName.values()], invalid, duplicates };
}

export type LorawanStats = {
  received: number;
  invalid: number;
  /// contoare înregistrate pe serverul de noduri, dar care n-au transmis niciodată (0 m³, dată de pornire din altă lună): nu se marchează și nu se numără ca LoRaWAN
  placeholders: number;
  /// transmisii din altă lună decât cea curentă: ignorate
  stale: number;
  /// contoare din luna curentă găsite în CRM
  matched: number;
  /// găsite în CRM, dar scoase din uz
  removed: number;
  /// nu există în CRM
  unmatched: number;
  /// găsite în CRM fără plătitor legat
  noPayer: number;
  /// număr de contor care apare la mai multe contoare active din CRM (s-a luat primul cu plătitor)
  ambiguous: number;
  saved: number;
  unchanged: number;
  /// luna are deja o citire făcută de cititor / operator: nu se suprascrie
  skippedField: number;
  /// indexul primit e mai mic decât cel anterior (contor înlocuit sau eroare de transmisie) — se salvează, dar se semnalează
  lowerThanPrev: number;
  errors: number;
};

export type LorawanStatus = {
  configured: boolean;
  /** administratorul a pornit prima extragere („Activează”): de atunci rulează și cea automată zilnică */
  activated: boolean;
  lastRunAt: string | null;
  lastOk: boolean;
  lastTrigger: string;
  message: string;
  durationMs: number;
  running: boolean;
  stats: LorawanStats | null;
  unmatched: string[];
  /// câte contoare sunt marcate LoRaWAN în CRM
  known: number;
};
