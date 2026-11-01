import "server-only";
import { prisma } from "./prisma";

/**
 * Ajutoare pentru jurnalele mari (audit, trimiteri, notificări plătitori), care cresc la fiecare acțiune și nu se mai opresc:
 *
 *  - `cappedCount`: totalul pentru un filtru, dar numărând cel mult `LOG_COUNT_CAP` + 1 rânduri (nu toată colecția). Fără filtre, totalul exact vine din metadatele colecției (instant, indiferent de mărime).
 *  - `memoQuery`: același răspuns (pagină + total) cerut de mai multe ori în câteva secunde (pagina înapoi / înainte, mai mulți administratori, reîncărcări) se calculează o singură dată,
 *    cu o singură interogare în zbor; „Reîmprospătează" (`fresh`) îl ocolește.
 *  - `swr`: valoare calculată în fundal (ex. rezumatul ultimelor 24 h): se servește imediat ce există, se reîmprospătează fără ca cineva să aștepte.
 *  - `ensureIndex`: indexuri create o singură dată, la rulare, idempotent (aceleași nume ca în schema Prisma, deci un `db push` ulterior nu le dublează); nu blochează și nu aruncă.
 *
 * Starea stă pe globalThis (pachetele Next de producție nu partajează variabilele de modul).
 */

/** Peste atâtea rânduri totalul se afișează „50.000+": pagina nu mai are rost să numere (și să sară) mai departe; restrângerea filtrelor / exportul rămân calea spre restul. */
export const LOG_COUNT_CAP = Math.max(100, Number(process.env.LOG_COUNT_CAP) || 50_000);

type Model = "auditLog" | "deliveryLog" | "payerNotificationLog";
const COLLECTION: Record<Model, string> = { auditLog: "AuditLog", deliveryLog: "DeliveryLog", payerNotificationLog: "PayerNotificationLog" };

type State = {
  memo: Map<string, { at: number; v: unknown }>;
  flights: Map<string, Promise<unknown>>;
  swr: Map<string, { at: number; v: unknown; loading: Promise<unknown> | null }>;
  indexes: Set<string>;
};
const g = globalThis as unknown as { __logCache?: State };
const S: State = (g.__logCache ??= { memo: new Map(), flights: new Map(), swr: new Map(), indexes: new Set() });

export type CountResult = { n: number; capped: boolean };

/** Total pentru `where`: fără filtre → numărul exact din metadate; cu filtre → până la LOG_COUNT_CAP (peste: `capped`). */
export async function cappedCount(model: Model, where: object): Promise<CountResult> {
  if (Object.keys(where).length === 0) {
    try {
      const r = (await prisma.$runCommandRaw({ count: COLLECTION[model] })) as { n?: number };
      if (typeof r.n === "number") return { n: r.n, capped: false };
    } catch {
      // comanda nu e disponibilă → numărătoare obișnuită, plafonată
    }
  }
  const n = await (prisma[model] as unknown as { count: (a: object) => Promise<number> }).count({ where, take: LOG_COUNT_CAP + 1 });
  return n > LOG_COUNT_CAP ? { n: LOG_COUNT_CAP, capped: true } : { n, capped: false };
}

/** Cel mult `LOG_COUNT_CAP` rânduri se pot parcurge pe pagini: numărul de pagini se calculează din total plafonat. */
export const pageableTotal = (n: number) => Math.min(n, LOG_COUNT_CAP);

/** Răspuns memorat `ttlMs`; cererile identice simultane împart o singură execuție. `fresh` sare peste memorie (și îl reînnoiește). */
export function memoQuery<T>(key: string, ttlMs: number, fresh: boolean, run: () => Promise<T>): Promise<T> {
  const hit = S.memo.get(key);
  if (!fresh && hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.v as T);
  const flying = S.flights.get(key);
  if (flying && !fresh) return flying as Promise<T>;
  const p = run()
    .then((v) => {
      if (S.memo.size >= 120) S.memo.delete(S.memo.keys().next().value as string);
      S.memo.set(key, { at: Date.now(), v });
      return v;
    })
    .finally(() => {
      if (S.flights.get(key) === p) S.flights.delete(key);
    });
  S.flights.set(key, p);
  return p;
}

/** Stale-while-revalidate: dacă există o valoare (oricât de veche, până la `maxStaleMs`), se întoarce imediat; dacă are peste `freshMs`, se reîmprospătează în fundal. */
export async function swr<T>(key: string, freshMs: number, maxStaleMs: number, run: () => Promise<T>): Promise<T> {
  const cur = S.swr.get(key);
  const refresh = () => {
    const entry = S.swr.get(key) ?? { at: 0, v: undefined, loading: null };
    if (entry.loading) return entry.loading as Promise<T>;
    entry.loading = run()
      .then((v) => {
        S.swr.set(key, { at: Date.now(), v, loading: null });
        return v;
      })
      .catch((e) => {
        const e2 = S.swr.get(key);
        if (e2) e2.loading = null;
        throw e;
      });
    S.swr.set(key, entry);
    return entry.loading as Promise<T>;
  };
  if (cur && cur.at > 0 && Date.now() - cur.at < maxStaleMs) {
    if (Date.now() - cur.at >= freshMs) void refresh().catch(() => {});
    return cur.v as T;
  }
  return refresh();
}

/** Golește rezultatele memorate (după ștergerea jurnalului, de exemplu). */
export function clearLogMemo(): void {
  S.memo.clear();
  S.swr.clear();
}

/** Creează un index o singură dată per proces (idempotent). Cheia: `{ câmp: 1, … }`. */
export function ensureIndex(collection: string, key: Record<string, 1 | -1>, name: string, extra: Record<string, unknown> = {}): void {
  if (S.indexes.has(name)) return;
  S.indexes.add(name);
  void prisma
    .$runCommandRaw({ createIndexes: collection, indexes: [{ key, name, ...extra }] })
    .catch((e) => console.error(`[log-count] nu am putut crea indexul ${name} (merge și fără, mai lent):`, String(e?.message ?? e).slice(0, 200)));
}
