// Expirarea contractului plătitorului: data (introdusă manual), etapele de notificare (30 și 10 zile înainte) și filtrul din liste (cod partajat server / browser).

import { addDaysToKey, DEFAULT_TZ, todayKey } from "./date";

/** Cu câte zile înainte de expirare se trimite fiecare notificare (descrescător). */
export const CONTRACT_STAGES = [30, 10] as const;
export type ContractStage = (typeof CONTRACT_STAGES)[number];

/** Filtrul „Contract” din liste. */
export type ContractExpFilter = "" | "none" | "expired" | "10d" | "30d";
export const CONTRACT_EXP_OPTIONS: { value: Exclude<ContractExpFilter, "">; label: string }[] = [
  { value: "10d", label: "Expiră în 10 zile" },
  { value: "30d", label: "Expiră în 30 de zile" },
  { value: "expired", label: "Contract expirat" },
  { value: "none", label: "Fără dată de expirare" },
];

/** „YYYY-MM-DD” valid (inclusiv zile reale: 2026-02-30 nu trece), sau null. */
export function cleanContractDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim();
  const ro = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s); // și „31.12.2026”
  if (ro) s = `${ro[3]}-${ro[2].padStart(2, "0")}-${ro[1].padStart(2, "0")}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return null;
  const y = Number(s.slice(0, 4));
  return y >= 2000 && y <= 2100 ? s : null;
}

/** Data din baza de date (00:00 UTC) → „YYYY-MM-DD”. */
export const contractKey = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** Data „YYYY-MM-DD” → momentul de stocat (00:00 UTC, ca la celelalte date calendaristice). */
export const contractDate = (key: string): Date => new Date(`${key}T00:00:00Z`);

const DAY_MS = 86_400_000;

/** Câte zile calendaristice mai sunt până la data de expirare (0 = azi, negativ = expirat). */
export function daysUntil(expiresKey: string, today: string = todayKey(DEFAULT_TZ)): number {
  return Math.round((Date.parse(`${expiresKey}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
}

/** Etapa de notificare în care se află contractul acum: ≤ 10 zile → 10, ≤ 30 zile → 30; altfel (sau expirat) niciuna. */
export function contractStage(days: number): ContractStage | null {
  if (days < 0) return null;
  for (const s of [...CONTRACT_STAGES].sort((a, b) => a - b)) if (days <= s) return s;
  return null;
}

/** Cheia unei etape pentru o dată anume („2026-12-31:30”): schimbarea datei face ca notificările să pornească de la capăt. */
export const stageKey = (expiresKey: string, stage: ContractStage) => `${expiresKey}:${stage}`;

/** Un plătitor se potrivește filtrului „Contract”? (`today` = ziua de azi, „YYYY-MM-DD”.) */
export function matchesContractFilter(expiresKey: string | null | undefined, f: ContractExpFilter, today: string): boolean {
  if (!f) return true;
  if (f === "none") return !expiresKey;
  if (!expiresKey) return false;
  const d = daysUntil(expiresKey, today);
  return f === "expired" ? d < 0 : f === "10d" ? d >= 0 && d <= 10 : d >= 0 && d <= 30;
}

/** Limitele „YYYY-MM-DD” ale filtrului, pentru interogarea în baza de date. */
export function contractFilterBounds(f: ContractExpFilter, today: string = todayKey(DEFAULT_TZ)): { gte?: string; lte?: string; lt?: string } | null {
  if (f === "expired") return { lt: today };
  if (f === "10d") return { gte: today, lte: addDaysToKey(today, 10) };
  if (f === "30d") return { gte: today, lte: addDaysToKey(today, 30) };
  return null;
}

/** Textul scurt „expiră în 12 zile” / „expiră mâine” / „expiră azi” / „expirat de 3 zile”. */
export function daysLabel(days: number, t: (ro: string, v?: Record<string, string | number>) => string): string {
  if (days < 0) return t("expirat de {n} zile", { n: -days });
  if (days === 0) return t("expiră azi");
  if (days === 1) return t("expiră mâine");
  return t("expiră în {n} zile", { n: days });
}
