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
