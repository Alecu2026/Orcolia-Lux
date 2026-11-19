/**
 * Numărul sarcinilor și cererilor: „codul creatorului-AN/nr” (ex. 1-26/1 = prima din 2026 creată de utilizatorul cu codul 1).
 * Cele create înainte de acest număr nu-l au și rămân cu vechiul #seq. Partea comună (server + browser).
 */

export type TaskNoSource = { number?: string | null; seq?: number | null };

/** Numărul de afișat: „1-26/1”, sau „#123” pentru cele vechi; null dacă nu are nimic. */
export function taskNo(t: TaskNoSource | null | undefined): string | null {
  if (!t) return null;
  if (t.number) return t.number;
  return t.seq != null ? `#${t.seq}` : null;
}

/** „cod-AN/nr”, cu AN pe 2 cifre. */
export function formatTaskNumber(code: number, year: number, n: number): string {
  return `${code}-${String(year % 100).padStart(2, "0")}/${n}`;
}

/** Codul unui utilizator: număr întreg pozitiv, cel mult 6 cifre. */
export const USER_CODE_MAX = 999_999;
export function parseUserCode(raw: unknown): number | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{1,6}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= USER_CODE_MAX ? n : null;
}

/** Potrivire la căutare: „1-26/1”, „1-26/” sau „#123” / „123” (vechiul număr). */
export function matchesTaskNo(t: TaskNoSource, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (t.number && t.number.toLowerCase().includes(q)) return true;
  const m = q.match(/^#?(\d+)$/);
  return !!m && t.seq != null && t.seq === Number(m[1]);
}

/** Ce primesc funcțiile de afișare: vechiul `seq` (număr), un obiect cu `number` / `seq`, sau nimic. */
export type TaskNoArg = TaskNoSource | number | null | undefined;
export function taskNoOf(x: TaskNoArg): string | null {
  if (x == null) return null;
  return typeof x === "number" ? `#${x}` : taskNo(x);
}
