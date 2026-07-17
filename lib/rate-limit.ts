/** Sliding-window rate limiter în memorie. Potrivit pentru Vercel Edge/Node. */

type Window = { count: number; resetAt: number };
const store = new Map<string, Window>();

/** Curăță intrările expirate periodic. */
function prune() {
  const now = Date.now();
  for (const [key, win] of store) {
    if (win.resetAt < now) store.delete(key);
  }
}

/**
 * Verifică dacă cheia (ex. adresă email sau IP) depășește limita.
 * @param key     Identificatorul unic (email, IP)
 * @param max     Număr maxim de cereri permise în fereastră
 * @param windowMs Durata ferestrei în milisecunde
 * @returns true dacă este blocat (depășit limita)
 */
export function isRateLimited(key: string, max: number, windowMs: number): boolean {
  if (store.size > 5000) prune();
  const now = Date.now();
  const win = store.get(key);
  if (!win || win.resetAt < now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  win.count++;
  return win.count > max;
}
