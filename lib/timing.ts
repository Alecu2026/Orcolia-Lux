/**
 * Măsoară o operație asincronă și scrie în log o linie dacă durează mai mult de `warnMs` (implicit 1 s):
 * `[lent] notificari-platitori/listPayerMonths: 18342 ms`. Ajută să vezi exact ce interogare încetinește o pagină, fără să iei la
 * ochi tot codul. Nu schimbă rezultatul și nu aruncă erori proprii.
 */
export async function timed<T>(label: string, work: Promise<T>, warnMs = 1000): Promise<T> {
  const t0 = Date.now();
  try {
    return await work;
  } finally {
    const ms = Date.now() - t0;
    if (ms >= warnMs) console.log(`[lent] ${label}: ${ms} ms`);
  }
}
