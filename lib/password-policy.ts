/**
 * Regula pentru parole NOI (la creare, resetare, schimbare — personal și portal): orice parolă de cel puțin 6 caractere. Nu se cer litere mari, cifre sau semne, iar parola poate fi orice
 * (și doar cifre, și o parolă obișnuită) — o alege fiecare. Conturile existente nu sunt atinse.
 * Întoarce mesajul de eroare (în română, tradus de interfață) sau null dacă parola e acceptată.
 */
export const PASSWORD_MIN = 6;
export const PASSWORD_MAX = 128;

export function validateNewPassword(pw: string, _ctx: { email?: string | null; name?: string | null; account?: string | null } = {}): string | null {
  if (pw.length < PASSWORD_MIN) return `Parola: minim ${PASSWORD_MIN} caractere.`;
  if (pw.length > PASSWORD_MAX) return `Parola: cel mult ${PASSWORD_MAX} de caractere.`;
  return null;
}
