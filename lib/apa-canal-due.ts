/**
 * Scadența facturilor Apă-Canal (plătitori): ÎNTOTDEAUNA ziua de 25 a lunii facturii (luna datei de emitere).
 * Se salvează la prânz UTC (12:00), ca ziua să rămână 25 în orice fus orar din Europa / Moldova.
 * Cod comun server + browser (formularul de factură arată aceeași dată).
 */
export const APA_CANAL_DUE_DAY = 25;

/** Scadența pentru o dată de emitere (folosește luna / anul UTC al datei, ca restul importului 1C). */
export function apaCanalDueDate(issueDate: Date): Date {
  return new Date(Date.UTC(issueDate.getUTCFullYear(), issueDate.getUTCMonth(), APA_CANAL_DUE_DAY, 12, 0, 0));
}

/** La fel, pornind de la „YYYY-MM-DD" (câmpurile de dată din formulare); null dacă data e invalidă. */
export function apaCanalDueKey(issueKey: string): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(issueKey);
  return m ? `${m[1]}-${m[2]}-${String(APA_CANAL_DUE_DAY).padStart(2, "0")}` : null;
}
