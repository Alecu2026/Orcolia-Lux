import "server-only";
import { prisma } from "../prisma";
import { DEFAULT_TZ } from "../date";
import { formatTaskNumber, USER_CODE_MAX } from "../task-number";

/**
 * Codul utilizatorilor și numărul sarcinilor / cererilor („cod-AN/nr”, vezi lib/task-number.ts).
 *  - Codul e un întreg unic; la un utilizator nou se dă automat primul liber, iar administratorul îl poate schimba (unicitatea o verificăm aici, nu cu index în DB).
 *  - Numărul crește pe fiecare pereche (cod, an) și e comun sarcinilor și cererilor, ca să nu existe două cu același număr. Contorul e legat de COD, nu de utilizator:
 *    dacă un cod se dă altcuiva mai târziu, numerotarea continuă de unde a rămas, fără dubluri.
 */

/** Primul cod liber (cel mai mare din uz + 1; dacă s-a umplut plaja, primul gol). */
export async function nextFreeUserCode(): Promise<number> {
  const top = await prisma.user.findFirst({ where: { code: { not: null } }, orderBy: { code: "desc" }, select: { code: true } });
  const next = (top?.code ?? 0) + 1;
  if (next <= USER_CODE_MAX) return next;
  const used = new Set((await prisma.user.findMany({ where: { code: { not: null } }, select: { code: true } })).map((u) => u.code as number));
  for (let c = 1; c <= USER_CODE_MAX; c++) if (!used.has(c)) return c;
  throw new Error("Nu mai există coduri libere.");
}

/** Cine are deja codul (în afară de `exceptUserId`), sau null dacă e liber. */
export async function userWithCode(code: number, exceptUserId?: string): Promise<{ id: string; name: string } | null> {
  const row = await prisma.user.findFirst({ where: { code, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) }, select: { id: true, name: true } });
  return row ?? null;
}

/** Codul utilizatorului; dacă încă nu are (cont mai vechi), i se dă acum primul liber. */
export async function ensureUserCode(userId: string): Promise<number> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { code: true } });
  if (u?.code != null) return u.code;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = await nextFreeUserCode();
    // condiționat de „încă fără cod”: două cereri simultane nu-i pun două coduri
    const r = await prisma.user.updateMany({ where: { id: userId, OR: [{ code: null }, { code: { isSet: false } }] }, data: { code } });
    const now = await prisma.user.findUnique({ where: { id: userId }, select: { code: true } });
    if (now?.code != null && (r.count === 1 || now.code === code)) {
      // două conturi care au luat în același timp același cod: cel creat mai târziu își ia altul
      const clash = await prisma.user.findMany({ where: { code: now.code }, select: { id: true }, orderBy: { createdAt: "asc" } });
      if (clash.length > 1 && clash[0].id !== userId) {
        await prisma.user.updateMany({ where: { id: userId }, data: { code: null } });
        continue;
      }
      return now.code;
    }
    if (now?.code != null) return now.code;
  }
  throw new Error("Nu am putut atribui un cod utilizatorului.");
}

const yearOf = (d: Date): number => Number(new Intl.DateTimeFormat("en-GB", { timeZone: DEFAULT_TZ, year: "numeric" }).format(d));

/** Următorul număr al creatorului: „cod-AN/nr”. */
export async function allocateTaskNumber(creatorId: string, at: Date = new Date()): Promise<string> {
  const code = await ensureUserCode(creatorId);
  const year = yearOf(at);
  const name = `task-no-${code}-${String(year % 100).padStart(2, "0")}`;
  const counter = await prisma.counter.upsert({ where: { name }, create: { name, value: 1 }, update: { value: { increment: 1 } }, select: { value: true } });
  return formatTaskNumber(code, year, counter.value);
}
