import "server-only";

/**
 * Cache în memoria procesului pentru portalul clienților — scopul: o cerere de pagină să atingă baza de date cât mai puțin (cu mii de clienți conectați,
 * fiecare cerere în plus la MongoDB e o călătorie prin rețea și o cotă de procesor).
 *
 *  - sesiunile (căutarea după cookie): ținute `TTL` secunde; ieșirea din cont / resetarea accesului le scot imediat din procesul curent;
 *  - datele paginii principale ale unui client (facturi + contoare): ținute `TTL` secunde, invalidate la orice scriere cunoscută (citire nouă, factură
 *    modificată, neregulă raportată) și golite pentru toți clienții după un import 1C (`bumpPortalEpoch`);
 *  - șabloanele de cereri (aceleași pentru toți clienții): un minut, golite când un administrator le modifică;
 *  - cererile simultane pentru aceeași cheie așteaptă aceeași execuție (single-flight).
 *
 * IMPORTANT: în producție paginile și acțiunile serverului primesc instanțe SEPARATE ale unui modul (pachete diferite), deci o variabilă obișnuită de modul
 * nu ar fi comună: o invalidare făcută dintr-o acțiune n-ar ajunge la cache-ul paginii. De aceea toată starea stă pe `globalThis`, unică în proces.
 *
 * La un server cu mai multe procese, fiecare proces are cache-ul lui: o scriere făcută într-un proces se vede în celelalte cel mult `TTL` secunde mai târziu.
 * `PORTAL_CACHE_TTL_MS=0` dezactivează tot (valoare implicită: 30 000).
 */

const parsed = Number(process.env.PORTAL_CACHE_TTL_MS);
export const PORTAL_TTL_MS = Number.isFinite(parsed) && parsed >= 0 ? parsed : 30_000;
const MAX_ENTRIES = 20_000;
const TEMPLATES_TTL_MS = 60_000;

type Box = { until: number; epoch: number; val: unknown };
type State = {
  sessions: Map<string, { until: number; val: unknown }>;
  sessionsByClient: Map<string, Set<string>>;
  data: Map<string, Box>;
  flights: Map<string, Promise<unknown>>;
  epoch: number;
  templates: { until: number; val: unknown } | null;
};
const g = globalThis as unknown as { __portalCache?: State };
const S: State = (g.__portalCache ??= { sessions: new Map(), sessionsByClient: new Map(), data: new Map(), flights: new Map(), epoch: 0, templates: null });

/** Elimină cele mai vechi ~10 % din intrări când harta depășește plafonul (ordinea de inserare = ordinea vechimii). */
function prune(m: Map<string, unknown>) {
  if (m.size <= MAX_ENTRIES) return;
  let n = Math.ceil(MAX_ENTRIES / 10);
  for (const k of m.keys()) {
    m.delete(k);
    if (--n <= 0) break;
  }
}

// ── sesiuni ─────────────────────────────────────────────────────────────────────────────────────
export function getCachedSession<T>(tokenHash: string): T | undefined {
  if (PORTAL_TTL_MS === 0) return undefined;
  const hit = S.sessions.get(tokenHash);
  if (!hit) return undefined;
  if (hit.until <= Date.now()) {
    S.sessions.delete(tokenHash);
    return undefined;
  }
  return hit.val as T;
}

/** `expiresAtMs`: sesiunea nu e ținută în cache peste expirarea ei reală. */
export function putCachedSession(tokenHash: string, clientId: string, val: unknown, expiresAtMs: number) {
  if (PORTAL_TTL_MS === 0) return;
  S.sessions.set(tokenHash, { until: Math.min(Date.now() + PORTAL_TTL_MS, expiresAtMs), val });
  let set = S.sessionsByClient.get(clientId);
  if (!set) S.sessionsByClient.set(clientId, (set = new Set()));
  set.add(tokenHash);
  prune(S.sessions);
  if (S.sessionsByClient.size > MAX_ENTRIES) S.sessionsByClient.clear(); // indexul secundar e doar o plasă de siguranță; se reface la următoarele cereri
}

export function evictCachedSession(tokenHash: string) {
  S.sessions.delete(tokenHash);
}

/** Toate sesiunile unui client (reset de acces, schimbare de parolă): ies imediat din cache-ul acestui proces. */
export function evictClientSessions(clientId: string) {
  const set = S.sessionsByClient.get(clientId);
  if (set) for (const h of set) S.sessions.delete(h);
  S.sessionsByClient.delete(clientId);
}

// ── date ale clientului ─────────────────────────────────────────────────────────────────────────
/** Tipurile de date păstrate pe client (`kind`): invalidarea unui client le șterge pe toate. */
const KINDS = ["home"] as const;
export type PortalKind = (typeof KINDS)[number];

export async function cachedForClient<T>(kind: PortalKind, clientId: string, build: () => Promise<T>): Promise<T> {
  if (PORTAL_TTL_MS === 0) return build();
  const key = `${kind}:${clientId}`;
  const hit = S.data.get(key);
  if (hit && hit.epoch === S.epoch && hit.until > Date.now()) return hit.val as T;
  const inflight = S.flights.get(key);
  if (inflight) return inflight as Promise<T>;
  const startEpoch = S.epoch;
  const p: Promise<T> = build()
    .then((val) => {
      // dacă între timp s-a invalidat ceva, rezultatul e servit acestei cereri, dar nu rămâne în cache
      if (S.epoch === startEpoch && S.flights.get(key) === p) {
        S.data.set(key, { until: Date.now() + PORTAL_TTL_MS, epoch: S.epoch, val });
        prune(S.data);
      }
      return val;
    })
    .finally(() => {
      if (S.flights.get(key) === p) S.flights.delete(key);
    });
  S.flights.set(key, p);
  return p;
}

/** Un client are date noi (citire, factură, neregulă): următoarea cerere le citește din baza de date. */
export function invalidatePortalClient(clientId: string | null | undefined) {
  if (!clientId) return;
  for (const k of KINDS) {
    const key = `${k}:${clientId}`;
    S.data.delete(key);
    S.flights.delete(key); // o execuție pornită înainte de scriere nu mai are voie să pună în cache date vechi
  }
}

/** Date schimbate în masă (import / sincronizare 1C, scadențe): cache-ul tuturor clienților e depășit. */
export function bumpPortalEpoch() {
  S.epoch++;
  S.data.clear();
  S.flights.clear();
}

// ── șabloanele de cereri (comune tuturor clienților) ────────────────────────────────────────────
export function getCachedTemplates<T>(): T | undefined {
  if (PORTAL_TTL_MS === 0) return undefined;
  return S.templates && S.templates.until > Date.now() ? (S.templates.val as T) : undefined;
}
export function putCachedTemplates(val: unknown) {
  if (PORTAL_TTL_MS > 0) S.templates = { until: Date.now() + TEMPLATES_TTL_MS, val };
}
export function invalidatePortalTemplates() {
  S.templates = null;
}
