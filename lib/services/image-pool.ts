import "server-only";

/**
 * Procesarea imaginilor (sharp/libvips) consumă CPU și memorie. Ca serverul să nu se blocheze când mai mulți cititori trimit poze deodată:
 * cel mult IMAGE_JOBS (implicit 2) conversii rulează simultan, restul așteaptă la coadă; libvips folosește un singur fir per conversie și nu ține cache de imagini.
 */

type Sharp = typeof import("sharp").default;

const MAX_JOBS = Math.max(1, Number(process.env.IMAGE_JOBS) || 2);
let running = 0;
const waiting: (() => void)[] = [];
let lib: Promise<Sharp> | null = null;

async function load(): Promise<Sharp> {
  const sharp = (await import("sharp")).default;
  sharp.cache(false);
  sharp.concurrency(1);
  return sharp;
}

export async function withSharp<T>(fn: (sharp: Sharp) => Promise<T>): Promise<T> {
  if (running >= MAX_JOBS) await new Promise<void>((resolve) => waiting.push(resolve));
  running++;
  try {
    return await fn(await (lib ??= load()));
  } finally {
    running--;
    waiting.shift()?.();
  }
}
