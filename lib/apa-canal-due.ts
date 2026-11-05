/**
 * Scadența facturilor Apă-Canal (plătitori): ÎNTOTDEAUNA ziua de 25 a lunii URMĂTOARE celei în care s-a emis factura (facturile se emit la sfârșitul lunii pentru consumul lunii,
 * iar plata se face până pe 25 a lunii următoare: emisă 31.10 → scadentă 25.11).
 * Se salvează la prânz UTC (12:00), ca ziua să rămână 25 în orice fus orar din Europa / Moldova.
 * Cod comun server + browser (formularul de factură arată aceeași dată).
 */
export const APA_CANAL_DUE_DAY = 25;

/** Scadența pentru o dată de emitere (folosește luna / anul UTC al datei, ca restul importului 1C): 25 a lunii următoare. */
export function apaCanalDueDate(issueDate: Date): Date {
  return new Date(Date.UTC(issueDate.getUTCFullYear(), issueDate.getUTCMonth() + 1, APA_CANAL_DUE_DAY, 12, 0, 0));
}

/** Scadența („AAAA-LL-ZZ”) pentru o lună de emitere „AAAA-LL”; null dacă luna e invalidă. */
export function apaCanalDueKeyForMonth(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return null;
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const d = new Date(Date.UTC(Number(m[1]), mo, APA_CANAL_DUE_DAY, 12, 0, 0)); // luna următoare (luna 12 → ianuarie anul următor)
  return d.toISOString().slice(0, 10);
}

/** La fel, pornind de la „YYYY-MM-DD" (câmpurile de dată din formulare); null dacă data e invalidă. */
export function apaCanalDueKey(issueKey: string): string | null {
  const m = /^(\d{4}-\d{2})-\d{2}$/.exec(issueKey);
  return m ? apaCanalDueKeyForMonth(m[1]) : null;
}
