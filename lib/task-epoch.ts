/**
 * Contor global (pe proces) al modificărilor din colecția Task: crește la ORICE scriere făcută prin acest client Prisma — acțiuni, Telegram,
 * IMAP, portal, cron. Cache-ul listei complete (lib/services/task-dataset.ts) îl compară cu cel de la construire, deci o modificare făcută
 * pe aceeași instanță invalidează lista imediat, fără ca fiecare loc care scrie să știe de cache.
 */
const g = globalThis as unknown as { __taskEpoch?: number };

export function bumpTaskEpoch(): void {
  g.__taskEpoch = (g.__taskEpoch ?? 0) + 1;
}

export function taskEpoch(): number {
  return g.__taskEpoch ?? 0;
}
