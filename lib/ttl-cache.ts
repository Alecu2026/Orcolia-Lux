/**
 * Cache în memoria procesului pentru o funcție asincronă fără argumente: rezultatul se păstrează `ttlMs`, iar cererile simultane
 * așteaptă aceeași execuție (nu pornesc fiecare interogarea). Potrivit pentru interogări costisitoare care se schimbă rar
 * (ex. lista lunilor cu facturi). La un server cu mai multe procese, fiecare proces are cache-ul lui.
 */
export function cachedAsync<T>(ttlMs: number, fn: () => Promise<T>): () => Promise<T> {
  let value: { at: number; val: T } | null = null;
  let inflight: Promise<T> | null = null;
  return async () => {
    if (value && Date.now() - value.at < ttlMs) return value.val;
    if (!inflight) {
      inflight = fn()
        .then((val) => {
          value = { at: Date.now(), val };
          return val;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
}
