import "server-only";
import { prisma } from "./prisma";
import { ensureIndex } from "./log-count";

/**
 * Limitarea încercărilor de autentificare, comună tuturor proceselor și serverelor: contoarele stau în baza de date (colecția `AuthThrottle`, creată singură, cu index TTL),
 * nu în memoria unui proces — altfel un atacator ar avea limita înmulțită cu numărul de procese. Fiecare regulă = o cheie cu fereastră glisantă: după `max` eșecuri în `windowMs`
 * cheia se blochează `lockMs`. Un succes șterge doar cheile contului respectiv (nu poate reseta limitele de pe adresă).
 *
 * Citirea (`isBlocked`) e o singură interogare; înregistrarea unui eșec (`recordFailure`) e atomică (un `findAndModify` cu pipeline de actualizare per regulă, în paralel).
 * Dacă baza de date nu răspunde, nu blocăm pe nimeni din cauza asta (autentificarea însăși are nevoie de ea).
 */

export type ThrottleRule = { key: string; max: number; windowMs: number; lockMs: number };
export type ThrottleState = { blocked: boolean; retryAfterSec: number; justLocked: boolean };

const COLLECTION = "AuthThrottle";
const MIN = 60_000;

const ready = () => ensureIndex(COLLECTION, { exp: 1 }, "AuthThrottle_exp_ttl", { expireAfterSeconds: 0 });

/** Cheile pentru autentificare: pe adresă, pe cont și pe perechea cont + adresă (cea mai strictă). */
export function loginRules(scope: "staff" | "portal", account: string, ip: string | null): ThrottleRule[] {
  const acct = account.trim().toLowerCase().slice(0, 120);
  return [
    ...(ip ? [{ key: `${scope}:login:ip:${ip}`, max: 30, windowMs: 15 * MIN, lockMs: 15 * MIN }] : []),
    { key: `${scope}:login:acct:${acct}`, max: 12, windowMs: 15 * MIN, lockMs: 15 * MIN },
    ...(ip ? [{ key: `${scope}:login:pair:${acct}|${ip}`, max: 5, windowMs: 15 * MIN, lockMs: 15 * MIN }] : []),
  ];
}

/** Codul de autentificare în doi pași (după o parolă corectă): strâns pe cont — 6 cifre nu se pot ghici în 8 încercări / 15 min — și mai larg pe adresă. */
export function totpRules(userId: string, ip: string | null): ThrottleRule[] {
  return [
    { key: `staff:totp:acct:${userId}`, max: 8, windowMs: 15 * MIN, lockMs: 15 * MIN },
    ...(ip ? [{ key: `staff:totp:ip:${ip}`, max: 40, windowMs: 15 * MIN, lockMs: 15 * MIN }] : []),
  ];
}

/** Cel mai lung timp rămas dintre cheile blocate (0 = nicio cheie blocată). */
export async function isBlocked(keys: string[]): Promise<{ blocked: boolean; retryAfterSec: number }> {
  if (keys.length === 0) return { blocked: false, retryAfterSec: 0 };
  ready();
  try {
    const now = Date.now();
    const r = (await prisma.$runCommandRaw({ find: COLLECTION, filter: { _id: { $in: keys }, until: { $gt: now } }, projection: { until: 1 }, limit: keys.length })) as {
      cursor?: { firstBatch?: { until?: number }[] };
    };
    const until = Math.max(0, ...((r.cursor?.firstBatch ?? []).map((d) => Number(d.until) || 0)));
    return until > now ? { blocked: true, retryAfterSec: Math.ceil((until - now) / 1000) } : { blocked: false, retryAfterSec: 0 };
  } catch (e) {
    console.error("[auth-throttle] citire eșuată:", String((e as Error)?.message ?? e).slice(0, 160));
    return { blocked: false, retryAfterSec: 0 };
  }
}

async function bump(rule: ThrottleRule, now: number): Promise<{ n: number; until: number }> {
  const cutoff = now - rule.windowMs;
  const fresh = { $gt: [{ $ifNull: ["$ws", 0] }, cutoff] };
  const r = (await prisma.$runCommandRaw({
    findAndModify: COLLECTION,
    query: { _id: rule.key },
    update: [
      { $set: { ws: { $cond: [fresh, "$ws", now] }, n: { $cond: [fresh, { $add: [{ $ifNull: ["$n", 0] }, 1] }, 1] } } },
      { $set: { until: { $cond: [{ $gte: ["$n", rule.max] }, now + rule.lockMs, { $ifNull: ["$until", 0] }] }, exp: { $toDate: now + Math.max(rule.windowMs, rule.lockMs) + MIN } } },
    ],
    upsert: true,
    new: true,
  })) as { value?: { n?: number; until?: number } };
  return { n: Number(r.value?.n) || 0, until: Number(r.value?.until) || 0 };
}

/** Înregistrează un eșec pe toate regulile; întoarce starea după aceasta (`justLocked`: s-a atins limita chiar acum — de ex. pentru jurnal). */
export async function recordFailure(rules: ThrottleRule[]): Promise<ThrottleState> {
  if (rules.length === 0) return { blocked: false, retryAfterSec: 0, justLocked: false };
  ready();
  try {
    const now = Date.now();
    const res = await Promise.all(rules.map((rule) => bump(rule, now)));
    let until = 0, locked = false;
    res.forEach((x, i) => {
      if (x.until > now) until = Math.max(until, x.until);
      if (x.n === rules[i].max) locked = true;
    });
    return { blocked: until > now, retryAfterSec: until > now ? Math.ceil((until - now) / 1000) : 0, justLocked: locked };
  } catch (e) {
    console.error("[auth-throttle] înregistrare eșuată:", String((e as Error)?.message ?? e).slice(0, 160));
    return { blocked: false, retryAfterSec: 0, justLocked: false };
  }
}

/** Șterge contoarele cheilor date (după o autentificare reușită: cheile contului, nu cele de pe adresă). */
export async function clearFailures(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await prisma.$runCommandRaw({ delete: COLLECTION, deletes: [{ q: { _id: { $in: keys } }, limit: 0 }] });
  } catch {
    // contoarele expiră oricum
  }
}

/** Limită simplă „max cereri în fereastră" (resetări de parolă, coduri): numără FIECARE cerere; întoarce true dacă s-a depășit. Comună între procese. */
export async function hitLimit(rule: ThrottleRule): Promise<boolean> {
  ready();
  try {
    const { n } = await bump({ ...rule, max: Number.MAX_SAFE_INTEGER }, Date.now());
    return n > rule.max;
  } catch (e) {
    console.error("[auth-throttle] limită eșuată:", String((e as Error)?.message ?? e).slice(0, 160));
    return false;
  }
}
