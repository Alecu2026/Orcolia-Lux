import "server-only";
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * TOTP (RFC 6238, compatibil cu Google Authenticator, Microsoft Authenticator, Authy, 2FAS, Aegis, 1Password …): HMAC-SHA1, 6 cifre, pas de 30 s.
 * Acceptăm și intervalul dinainte / de după (ceasuri puțin decalate), iar un cod deja folosit (același interval sau mai vechi) nu mai e primit — vezi `verifyTotp`.
 */

const STEP_SEC = 30;
const DIGITS = 6;
const WINDOW = 1;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[\s=-]+/g, "")) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("base32 invalid");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Secret nou: 160 de biți (cât recomandă RFC 4226), în base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

function hotp(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const n = ((h[off] & 127) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 10 ** DIGITS).padStart(DIGITS, "0");
}

export const currentStep = (now = Date.now()): number => Math.floor(now / 1000 / STEP_SEC);

export function totpAt(secret: string, step: number): string {
  return hotp(base32Decode(secret), step);
}

/**
 * Verifică un cod de 6 cifre. Întoarce intervalul (pasul) în care s-a potrivit, doar dacă e MAI NOU decât `lastStep` (protecție la reutilizare); altfel null.
 * Comparația parcurge mereu toate intervalele, în timp constant per cod.
 */
export function verifyTotp(secret: string, code: string, lastStep: number | null | undefined, now = Date.now()): number | null {
  const c = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secret);
  const cur = currentStep(now);
  let hit: number | null = null;
  for (let d = -WINDOW; d <= WINDOW; d++) {
    const step = cur + d;
    const a = Buffer.from(hotp(key, step));
    if (timingSafeEqual(a, Buffer.from(c)) && hit === null) hit = step;
  }
  if (hit === null) return null;
  return hit > (lastStep ?? 0) ? hit : null;
}

/** Adresa `otpauth://` din codul QR (aplicațiile de autentificare o citesc direct). */
export function otpauthUri(secret: string, account: string, issuer = "CRM Apă-Canal"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SEC}`;
}

/** Secretul în grupe de 4 litere, ca să se poată scrie de mână dacă nu merge codul QR. */
export const groupSecret = (s: string): string => s.replace(/(.{4})/g, "$1 ").trim();

// ── Coduri de recuperare ────────────────────────────────────────────────────────────────────────────────────────

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // fără 0/O/1/I
export const RECOVERY_COUNT = 10;

/** 10 coduri de forma XXXXX-XXXXX (10 caractere ≈ 50 de biți fiecare); se arată o singură dată, în baza de date rămân doar hash-urile. */
export function newRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_COUNT }, () => {
    let s = "";
    for (let i = 0; i < 10; i++) s += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}

export const normalizeRecovery = (c: string): string => c.toUpperCase().replace(/[^A-Z0-9]/g, "");
export const hashRecovery = (c: string): string => createHash("sha256").update(`recovery:${normalizeRecovery(c)}`).digest("hex");
export const looksLikeRecovery = (c: string): boolean => normalizeRecovery(c).length === 10;
