import "server-only";

/**
 * Limitează câte PDF-uri se generează deodată (fiecare ia o pagină din Chromium: CPU și ~100+ MB). Peste limită cererile așteaptă la coadă (în ordine); dacă coada e plină sau așteptarea
 * durează prea mult, cererea e respinsă (PdfBusyError → 503 cu Retry-After), nu lăsată să pornească încă un proces. Ca să nu se prăbușească serverul la un val de descărcări.
 */
export class PdfBusyError extends Error {
  constructor(public reason: "queue-full" | "wait-timeout") {
    super(reason === "queue-full" ? "Coada de PDF-uri e plină." : "Așteptarea la coada de PDF-uri a durat prea mult.");
    this.name = "PdfBusyError";
  }
}

/** Prea multe PDF-uri NOI cerute de la aceeași adresă într-un minut (descărcările din cache nu se numără). */
export class PdfRateLimitedError extends Error {
  constructor() {
    super("Prea multe cereri de PDF de la aceeași adresă.");
    this.name = "PdfRateLimitedError";
  }
}

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : d);
export const PDF_CONCURRENCY = num(process.env.PDF_CONCURRENCY, 3);
const MAX_QUEUE = num(process.env.PDF_QUEUE, 40);
const MAX_WAIT_MS = 25_000;

type Waiter = { go: () => void; drop: (e: PdfBusyError) => void };
type State = { running: number; queue: Waiter[] };
const g = globalThis as unknown as { __pdfLimiter?: State };
const S: State = (g.__pdfLimiter ??= { running: 0, queue: [] });

export async function withPdfSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (S.running >= PDF_CONCURRENCY) {
    if (S.queue.length >= MAX_QUEUE) throw new PdfBusyError("queue-full");
    await new Promise<void>((resolve, reject) => {
      const entry: Waiter = {
        go: () => {
          clearTimeout(timer);
          resolve();
        },
        drop: (e) => reject(e),
      };
      const timer = setTimeout(() => {
        const i = S.queue.indexOf(entry);
        if (i >= 0) S.queue.splice(i, 1);
        entry.drop(new PdfBusyError("wait-timeout"));
      }, MAX_WAIT_MS);
      S.queue.push(entry);
    });
    // locul ocupat a fost predat direct de cel care a terminat: `running` nu se schimbă
  } else S.running++;
  try {
    return await fn();
  } finally {
    const next = S.queue.shift();
    if (next) next.go();
    else S.running--;
  }
}
