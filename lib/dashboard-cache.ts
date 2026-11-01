import "server-only";
import { taskEpoch } from "./task-epoch";
import { clientEpoch, lookupEpoch } from "./lookup-memory";

/**
 * Răspunsurile Dashboard-ului (cifrele din carduri și prima pagină a listei de sarcini) păstrate în memoria procesului, pe utilizator: Dashboard e pagina pe care ajunge fiecare om după autentificare
 * și la fiecare întoarcere „acasă", iar un răspuns costă 5–6 interogări (numărători pe sarcini, grupare pe status, lista cu sortare). Un răspuns rămâne valabil cât timp nu se scrie nimic pe Task / User /
 * Team / Project / Category / Client (extensia Prisma din lib/prisma.ts schimbă epocile), dar nu mai mult de `MAX_AGE_MS` (scrieri făcute în alt proces sau direct în baza de date). Imediat după o scriere
 * răspunsul se reface la următoarea cerere (cel mult o dată pe secundă per utilizator), deci cifrele nu rămân în urmă după o acțiune proprie. Cererile identice simultane împart o singură execuție.
 * Cheia conține tot ce schimbă rezultatul (utilizator, rol, echipe, restricții de vizibilitate, filtre).
 */
const MAX_AGE_MS = 30_000;
const MIN_AGE_MS = 1000;
const MAX_ENTRIES = 3000;

type Entry = { at: number; epoch: string; value: unknown };
const g = globalThis as unknown as { __dashCache?: { map: Map<string, Entry>; flights: Map<string, Promise<unknown>> } };
const C = (g.__dashCache ??= { map: new Map(), flights: new Map() });

const epochNow = () => `${taskEpoch()}.${lookupEpoch()}.${clientEpoch()}`;

export async function dashCached<T>(key: string, run: () => Promise<T>): Promise<T> {
  const epoch = epochNow();
  const hit = C.map.get(key);
  if (hit) {
    const age = Date.now() - hit.at;
    if ((hit.epoch === epoch && age < MAX_AGE_MS) || age < MIN_AGE_MS) return hit.value as T;
  }
  const flying = C.flights.get(key);
  if (flying) return flying as Promise<T>;
  const p = run()
    .then((value) => {
      C.map.delete(key); // reinserat la sfârșit: se elimină întâi cele mai vechi
      if (C.map.size >= MAX_ENTRIES) C.map.delete(C.map.keys().next().value as string);
      C.map.set(key, { at: Date.now(), epoch, value });
      return value;
    })
    .finally(() => {
      if (C.flights.get(key) === p) C.flights.delete(key);
    });
  C.flights.set(key, p);
  return p;
}
