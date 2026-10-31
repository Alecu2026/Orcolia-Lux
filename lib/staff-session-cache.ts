import "server-only";

/**
 * Cache scurt, în memoria procesului, pentru sesiunea personalului (căutarea după cookie + utilizatorul ei) — fiecare cerere (pagină, API, acțiune) trecea prin 1–2 interogări
 * către MongoDB (~70 ms). Același principiu ca la portal (lib/portal-cache.ts), dar cu invalidare automată:
 *
 *  - ORICE scriere pe User / Session / Team (deconectare, dezactivare, schimbare de permisiuni sau de echipe, parolă nouă, ștergere cont, login nou…) golește tot cache-ul — vezi extensia
 *    Prisma din lib/prisma.ts, deci nicio cale de scriere nu poate fi uitată. Efectul e imediat în procesul care a făcut scrierea;
 *  - o citire pornită ÎNAINTE de o scriere nu mai ajunge în cache (epocă), deci nu rămân date vechi;
 *  - sesiunile de simulare de login NU se țin aici (se reverifică la fiecare cerere, ca și până acum);
 *  - sesiunile invalide / expirate nu se țin (nu există „cache negativ”);
 *  - o intrare nu trăiește peste expirarea reală a sesiunii și cel mult `TTL`;
 *  - cererile simultane pentru același cookie așteaptă aceeași interogare (single-flight).
 *
 * La un server cu mai multe procese, fiecare proces are cache-ul lui: o modificare făcută într-un proces (sau direct în baza de date) se vede în celelalte cel mult `TTL` mai târziu.
 * `STAFF_SESSION_CACHE_TTL_MS=0` dezactivează tot (implicit 15 000).
 *
 * Starea stă pe `globalThis`: în producție paginile, rutele și acțiunile primesc instanțe separate ale modulului, iar invalidarea trebuie să ajungă peste tot.
 */

const parsed = Number(process.env.STAFF_SESSION_CACHE_TTL_MS);
export const STAFF_SESSION_TTL_MS = Number.isFinite(parsed) && parsed >= 0 ? parsed : 15_000;
const MAX_ENTRIES = 5_000;

type State = { map: Map<string, { until: number; val: unknown }>; flights: Map<string, Promise<unknown>>; epoch: number };
const g = globalThis as unknown as { __staffSession?: State };
const S: State = (g.__staffSession ??= { map: new Map(), flights: new Map(), epoch: 0 });

/** Utilizatorul din cache (copie: apelanții nu pot strica intrarea comună), sau undefined. */
export function getCachedStaffUser<T extends object>(tokenHash: string): T | undefined {
  if (STAFF_SESSION_TTL_MS === 0) return undefined;
  const hit = S.map.get(tokenHash);
  if (!hit) return undefined;
  if (hit.until <= Date.now()) {
    S.map.delete(tokenHash);
    return undefined;
  }
  return cloneUser(hit.val as T);
}

/** Epoca de la începutul citirii din baza de date: dacă între timp s-a scris ceva, rezultatul nu mai intră în cache. */
export function staffSessionEpoch(): number {
  return S.epoch;
}

export function putCachedStaffUser(tokenHash: string, val: object, expiresAtMs: number, epoch: number): void {
  if (STAFF_SESSION_TTL_MS === 0 || epoch !== S.epoch) return;
  S.map.set(tokenHash, { until: Math.min(Date.now() + STAFF_SESSION_TTL_MS, expiresAtMs), val: cloneUser(val) });
  if (S.map.size > MAX_ENTRIES) {
    let n = Math.ceil(MAX_ENTRIES / 10);
    for (const k of S.map.keys()) {
      S.map.delete(k);
      if (--n <= 0) break;
    }
  }
}

/** Cererile simultane pentru același cookie împart o singură citire (și o singură scriere în cache). */
export function staffSessionFlight<T>(tokenHash: string, run: () => Promise<T>): Promise<T> {
  const cur = S.flights.get(tokenHash);
  if (cur) return cur as Promise<T>;
  const p: Promise<T> = run().finally(() => {
    if (S.flights.get(tokenHash) === p) S.flights.delete(tokenHash);
  });
  S.flights.set(tokenHash, p);
  return p;
}

/** Ceva despre conturi / sesiuni s-a schimbat: toate intrările ies, iar citirile în curs nu se mai păstrează. Nu aruncă niciodată. */
export function clearStaffSessionCache(): void {
  S.epoch++;
  S.map.clear();
  S.flights.clear();
}

/** Copie suficient de adâncă (listele mici ale utilizatorului); `tableLook` e JSON doar-citire și rămâne comun. */
function cloneUser<T extends object>(u: T): T {
  const o = { ...(u as Record<string, unknown>) };
  for (const k of Object.keys(o)) if (Array.isArray(o[k])) o[k] = [...(o[k] as unknown[])];
  if (o.impersonation && typeof o.impersonation === "object") o.impersonation = { ...(o.impersonation as object) };
  return o as T;
}
