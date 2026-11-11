/**
 * Adrese care se repetă: câte înregistrări (cereri, sarcini, apeluri) au aceeași adresă. Adresa se compară normalizat (fără diacritice, majuscule, semne de punctuație),
 * deci „str. Ștefan cel Mare 5” și „Str Stefan cel Mare 5” sunt aceeași adresă. Cod partajat server / browser.
 */
import { addressKey } from "./meters";

export function addressCounts<T>(rows: readonly T[], get: (r: T) => string | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) {
    const k = addressKey(get(r));
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

/** Valorile filtrului „Adresă repetată”: de câte ori trebuie să apară adresa. */
export const REPEAT_OPTIONS = [
  { value: "2", label: "Repetate: 2+ la aceeași adresă" },
  { value: "3", label: "Repetate: 3+ la aceeași adresă" },
  { value: "5", label: "Repetate: 5+ la aceeași adresă" },
];

/** Adresa apare de cel puțin `min` ori în `counts`? */
export function repeatsAtLeast(counts: Map<string, number>, address: string | null | undefined, min: string): boolean {
  const k = addressKey(address);
  return !!k && (counts.get(k) ?? 0) >= Number(min);
}
