import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";

/**
 * Parolele se păstrează cu scrypt (N=2^15, r=8, p=1 ≈ 32 MiB și ~80–150 ms), calculat în pool-ul de fire al sistemului (libuv), NU pe firul principal: o logare nu mai blochează
 * restul utilizatorilor procesului (bcryptjs, cod JavaScript pur, ținea firul ocupat 200–400 ms la fiecare verificare). Formatul stocat: `scrypt$15$8$1$<sare>$<hash>` (base64url).
 *
 * Conturile vechi au hash bcrypt (`$2…`): se verifică în continuare (bcryptjs), iar la prima logare reușită hash-ul se rescrie automat în scrypt (`rehash` din `checkPassword`).
 *
 * Protecții:
 *  - un număr limitat de calcule simultane pe proces (`AUTH_HASH_CONCURRENCY`, implicit 4) și o coadă plafonată (`AUTH_HASH_QUEUE`, implicit 400): un val de logări nu poate umple memoria
 *    (fiecare scrypt folosește ~32 MiB) și nici nu blochează serverul — peste coadă, cererea primește `HashBusyError`;
 *  - `dummyVerify`: pentru conturi inexistente / dezactivate se face același calcul, ca timpul de răspuns să nu arate dacă un cont există;
 *  - comparație în timp constant.
 */

const N_LOG2 = 15;
const R = 8;
const P = 1;
const KEYLEN = 32;
const SALTLEN = 16;
const MAXMEM = 96 * 1024 * 1024;
const PREFIX = "scrypt";

const MAX_PAR = Math.max(1, Number(process.env.AUTH_HASH_CONCURRENCY) || 4);
const MAX_QUEUE = Math.max(0, Number(process.env.AUTH_HASH_QUEUE) || 400);

export class HashBusyError extends Error {
  constructor() {
    super("Verificarea parolelor este ocupată.");
    this.name = "HashBusyError";
  }
}

const g = globalThis as unknown as { __pwSlots?: { active: number; waiting: (() => void)[] }; __pwDummy?: Promise<string> };
const slots = (g.__pwSlots ??= { active: 0, waiting: [] });

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (slots.active >= MAX_PAR) {
    if (slots.waiting.length >= MAX_QUEUE) throw new HashBusyError();
    await new Promise<void>((resolve) => slots.waiting.push(resolve)); // slotul se predă direct (active rămâne)
  } else {
    slots.active++;
  }
  try {
    return await fn();
  } finally {
    const next = slots.waiting.shift();
    if (next) next();
    else slots.active--;
  }
}

const derive = (plain: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(plain.normalize("NFKC"), salt, KEYLEN, { N: n, r, p, maxmem: MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });

export function hashPassword(plain: string): Promise<string> {
  return withSlot(async () => {
    const salt = randomBytes(SALTLEN);
    const key = await derive(plain, salt, 2 ** N_LOG2, R, P);
    return `${PREFIX}$${N_LOG2}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
  });
}

export type PasswordCheck = {
  ok: boolean;
  /** Hash nou (scrypt) de salvat în locul celui vechi — doar când parola e corectă și hash-ul e bcrypt sau cu parametri mai slabi. */
  rehash: string | null;
};

/** Verifică parola față de hash-ul stocat (scrypt sau bcrypt vechi). La succes pe un hash vechi întoarce și hash-ul nou. */
export async function checkPassword(plain: string, stored: string): Promise<PasswordCheck> {
  if (typeof stored !== "string" || stored.length < 20) return { ok: false, rehash: null };
  if (stored.startsWith(`${PREFIX}$`)) {
    const [, nLog, r, p, saltB64, hashB64] = stored.split("$");
    const n = 2 ** Number(nLog);
    if (!Number.isInteger(Number(nLog)) || Number(nLog) < 10 || Number(nLog) > 20 || !Number(r) || !Number(p) || !saltB64 || !hashB64) return { ok: false, rehash: null };
    const expected = Buffer.from(hashB64, "base64url");
    const key = await withSlot(() => derive(plain, Buffer.from(saltB64, "base64url"), n, Number(r), Number(p)));
    const ok = key.length === expected.length && timingSafeEqual(key, expected);
    const weaker = Number(nLog) < N_LOG2 || Number(r) < R;
    return { ok, rehash: ok && weaker ? await hashPassword(plain) : null };
  }
  // hash bcrypt vechi ($2a/$2b/$2y): bcryptjs (asincron, cedează periodic), sub același plafon de calcule simultane
  const ok = await withSlot(() => bcrypt.compare(plain, stored).catch(() => false));
  return { ok, rehash: ok ? await hashPassword(plain) : null };
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return (await checkPassword(plain, hash)).ok;
}

/** Același calcul ca la o verificare reală, pentru conturi inexistente / dezactivate (răspunsul nu trebuie să fie mai rapid). Întoarce mereu false. */
export async function dummyVerify(plain: string): Promise<false> {
  const dummy = await (g.__pwDummy ??= hashPassword(randomBytes(12).toString("hex")));
  await checkPassword(plain, dummy);
  return false;
}
