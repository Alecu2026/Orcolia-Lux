/**
 * Regulile pentru parole NOI (la creare, resetare, schimbare — personal și portal). Conturile existente nu sunt atinse până la următoarea schimbare a parolei.
 * Întoarce mesajul de eroare (în română, tradus de interfață) sau null dacă parola e acceptată.
 */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

// cele mai folosite parole (lista scurtă, cu variante românești și șabloane de tastatură); comparația se face cu litere mici, fără spații
const COMMON = new Set(
  [
    "password", "password1", "password123", "passw0rd", "parola", "parola123", "parola1234", "parolamea", "parolamea123", "parola12345", "qwerty", "qwerty123", "qwertyuiop", "qwerty12345",
    "azerty", "azerty123", "asdfgh", "asdfghjkl", "zxcvbnm", "1q2w3e4r", "1q2w3e4r5t", "1qaz2wsx", "q1w2e3r4", "qazwsx", "iloveyou", "welcome", "welcome1", "welcome123", "admin", "admin123",
    "administrator", "administrator1", "root", "toor", "letmein", "monkey", "dragon", "football", "baseball", "master", "sunshine", "princess", "shadow", "superman", "batman", "trustno1",
    "abc123", "abcd1234", "abc12345", "abcdefgh", "abcdefghij", "aaaaaaaa", "123456", "1234567", "12345678", "123456789", "1234567890", "12345678910", "0123456789", "0987654321",
    "1111111111", "0000000000", "1234512345", "9876543210", "parolaparola", "salut123", "buna123", "bunaziua", "romania", "romania123", "moldova", "moldova123", "chisinau", "cahul", "cahul123",
    "apacanal", "apacanal123", "apa-canal", "apacanalcahul", "apacanal2026", "apacanal2025", "cahul2026", "cahul2025", "moldova2026", "iloveyou1", "freedom", "whatever", "qweasdzxc",
  ].map((p) => p.toLowerCase()),
);

function simpleSequence(s: string): boolean {
  // doar cifre / litere în șir crescător sau descrescător (123456789, abcdefghij) sau un singur caracter repetat
  if (/^(.)\1+$/.test(s)) return true;
  let up = true, down = true;
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (d !== 1) up = false;
    if (d !== -1) down = false;
  }
  return up || down;
}

export function validateNewPassword(pw: string, ctx: { email?: string | null; name?: string | null; account?: string | null } = {}): string | null {
  if (pw.length < PASSWORD_MIN) return `Parola: minim ${PASSWORD_MIN} caractere.`;
  if (pw.length > PASSWORD_MAX) return `Parola: cel mult ${PASSWORD_MAX} de caractere.`;
  if (/^\s|\s$/.test(pw)) return "Parola nu poate începe sau se termina cu spațiu.";
  const low = pw.toLowerCase().replace(/\s+/g, "");
  if (/^\d+$/.test(low)) return "Parola nu poate fi formată doar din cifre. Adaugă litere.";
  if (COMMON.has(low) || simpleSequence(low)) return "Parola este prea ușor de ghicit. Alege alta.";
  const bare = low.replace(/[^a-z0-9ăâîșşțţ]/g, "");
  if (COMMON.has(bare.replace(/\d+$/, "")) && bare.length <= 14) return "Parola este prea ușor de ghicit. Alege alta.";
  // să nu conțină datele contului
  const bits: string[] = [];
  const local = ctx.email?.split("@")[0]?.toLowerCase();
  if (local && local.length >= 4) bits.push(local);
  for (const part of (ctx.name ?? "").toLowerCase().split(/\s+/)) if (part.length >= 4) bits.push(part);
  const acct = (ctx.account ?? "").toLowerCase().replace(/\s+/g, "");
  if (acct.length >= 4) bits.push(acct);
  if (bits.some((b) => low.includes(b))) return "Parola nu trebuie să conțină numele, emailul sau contul tău.";
  return null;
}
