import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { env } from "./env";

/**
 * Linkul din emailul de verificare a unei citiri: un cod semnat (HMAC) care conține citirea ȘI indexul trimis. Dacă indexul se modifică ulterior, codul vechi nu mai e valabil
 * (plătitorul vede că citirea s-a schimbat și că a primit alt email), deci nu se poate confirma o valoare pe care n-a văzut-o. Valabil `TTL_DAYS` zile.
 */
const TTL_DAYS = 14;
const key = () => createHash("sha256").update(`reading-verify:${env.sessionSecret}`).digest();
const mac = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

export type ReadingVerifyClaim = { readingId: string; value: number };

export function signReadingToken(claim: ReadingVerifyClaim): string {
  const payload = Buffer.from(JSON.stringify({ r: claim.readingId, v: claim.value, e: Date.now() + TTL_DAYS * 86_400_000 })).toString("base64url");
  return `${payload}.${mac(payload)}`;
}

/** Null dacă codul e fals, alterat sau expirat. */
export function verifyReadingToken(token: string): ReadingVerifyClaim | null {
  if (typeof token !== "string" || token.length > 400) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(mac(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { r?: unknown; v?: unknown; e?: unknown };
    if (typeof j.r !== "string" || !/^[0-9a-f]{24}$/i.test(j.r) || typeof j.v !== "number" || typeof j.e !== "number" || j.e < Date.now()) return null;
    return { readingId: j.r, value: j.v };
  } catch {
    return null;
  }
}

/**
 * Linkul din emailul „Confirmă citirea” (citire trimisă din portal, încă neînregistrată): codul conține doar id-ul citirii în așteptare. Valabil `PENDING_TTL_DAYS` zile (cât și citirea în așteptare).
 * Altă cheie decât la verificarea citirilor deja salvate, ca un cod să nu poată fi folosit în locul celuilalt.
 */
export const PENDING_TTL_DAYS = 7;
const pendingKey = () => createHash("sha256").update(`reading-confirm:${env.sessionSecret}`).digest();
const pendingMac = (payload: string) => createHmac("sha256", pendingKey()).update(payload).digest("base64url");

export function signPendingToken(pendingId: string): string {
  const payload = Buffer.from(JSON.stringify({ p: pendingId, e: Date.now() + PENDING_TTL_DAYS * 86_400_000 })).toString("base64url");
  return `${payload}.${pendingMac(payload)}`;
}

/** Id-ul citirii în așteptare; null dacă codul e fals, alterat sau expirat. */
export function verifyPendingToken(token: string): string | null {
  if (typeof token !== "string" || token.length > 400) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(pendingMac(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const j = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { p?: unknown; e?: unknown };
    if (typeof j.p !== "string" || !/^[0-9a-f]{24}$/i.test(j.p) || typeof j.e !== "number" || j.e < Date.now()) return null;
    return j.p;
  } catch {
    return null;
  }
}
