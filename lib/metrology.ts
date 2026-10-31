// Verificarea metrologică a contoarelor: data ultimei verificări (introdusă manual), scadența la 5 ani, etapele de notificare și filtrul din liste (cod partajat server / browser).

import { addDaysToKey, DEFAULT_TZ, todayKey } from "./date";
import { cleanContractDate, contractDate, contractKey, daysUntil } from "./contract-expiry";

export { cleanContractDate as cleanMetrologyDate, contractDate as metrologyDate, contractKey as metrologyKey, daysUntil };

/** La câți ani trebuie repetată verificarea metrologică. */
export const METROLOGY_YEARS = 5;

/** Cu câte zile înainte de scadență se trimite fiecare notificare (descrescător): timp să fie scos contorul și dus la laborator. */
export const METROLOGY_STAGES = [60, 30, 10] as const;
export type MetrologyStage = (typeof METROLOGY_STAGES)[number];

/** Filtrul „Verificare metrologică” din liste (pe scadență). */
export type MetrologyFilter = "" | "none" | "expired" | "10d" | "30d" | "60d";
export const METROLOGY_FILTER_OPTIONS: { value: Exclude<MetrologyFilter, "">; label: string }[] = [
  { value: "10d", label: "Verificare metrologică: expiră în 10 zile" },
  { value: "30d", label: "Verificare metrologică: expiră în 30 de zile" },
  { value: "60d", label: "Verificare metrologică: expiră în 60 de zile" },
  { value: "expired", label: "Verificare metrologică expirată" },
  { value: "none", label: "Fără dată de verificare metrologică" },
];
export const METROLOGY_FILTER_VALUES = ["none", "expired", "10d", "30d", "60d"] as const;

/** Data următoarei verificări: data ultimei + 5 ani (29 februarie → 28 februarie în anii fără 29). */
export function metrologyDueKey(verifiedKey: string): string {
  const y = Number(verifiedKey.slice(0, 4)) + METROLOGY_YEARS;
  const md = verifiedKey.slice(5);
  if (md === "02-29") {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    return `${y}-${leap ? "02-29" : "02-28"}`;
  }
  return `${y}-${md}`;
}

/** Etapa de notificare în care se află scadența: ≤ 10 zile → 10, ≤ 30 → 30, ≤ 60 → 60; altfel (sau expirat) niciuna. */
export function metrologyStage(days: number): MetrologyStage | null {
  if (days < 0) return null;
  for (const s of [...METROLOGY_STAGES].sort((a, b) => a - b)) if (days <= s) return s;
  return null;
}

/** Cheia unei etape pentru o scadență anume („2031-05-01:60”): o dată nouă face ca notificările să pornească de la capăt. */
export const metrologyStageKey = (dueKey: string, stage: MetrologyStage) => `${dueKey}:${stage}`;

/** Un contor / plătitor se potrivește filtrului? `dueKey` = scadența („YYYY-MM-DD”) sau null când nu există nicio dată introdusă. */
export function matchesMetrologyFilter(dueKey: string | null | undefined, f: MetrologyFilter, today: string): boolean {
  if (!f) return true;
  if (f === "none") return !dueKey;
  if (!dueKey) return false;
  const d = daysUntil(dueKey, today);
  return f === "expired" ? d < 0 : d >= 0 && d <= (f === "10d" ? 10 : f === "30d" ? 30 : 60);
}

/** Limitele „YYYY-MM-DD” ale filtrului pe scadență, pentru interogarea în baza de date. */
export function metrologyFilterBounds(f: MetrologyFilter, today: string = todayKey(DEFAULT_TZ)): { gte?: string; lte?: string; lt?: string } | null {
  if (f === "expired") return { lt: today };
  if (f === "10d" || f === "30d" || f === "60d") return { gte: today, lte: addDaysToKey(today, f === "10d" ? 10 : f === "30d" ? 30 : 60) };
  return null;
}

/** Cea mai apropiată dintre mai multe scadențe („YYYY-MM-DD”) sau null. */
export function earliestKey(keys: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const k of keys) if (k && (best === null || k < best)) best = k;
  return best;
}
