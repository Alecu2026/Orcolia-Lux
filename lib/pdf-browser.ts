import "server-only";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type { Browser, BrowserContext, Page } from "playwright-core";

/** Cookie-uri de trecut paginii deschise în Chromium (ex. sesiunea clientului din portal), valabile pentru `url`. */
export type PdfCookie = { name: string; value: string };

/**
 * Lansează un Chromium headless — binarul comprimat @sparticuz pe Vercel, Chromium local în dezvoltare.
 * Pe Lambda/Vercel, un user-data-dir unic per invocare e necesar: Playwright nu-l curăță
 * automat pe un lambda "cald", iar reutilizarea aceluiași /tmp între invocări duce la
 * ERR_INSUFFICIENT_RESOURCES după câteva descărcări. Vezi:
 * https://github.com/Sparticuz/chromium#playwright-lambda-tmp-fills-up-after-repeated-invocations
 *
 * Playwright respinge `--user-data-dir` dat ca argument brut în `args` (aruncă "Pass userDataDir
 * parameter to launchPersistentContext(...) instead") — de-asta folosim `launchPersistentContext`,
 * care întoarce direct un `BrowserContext`, nu un `Browser`. Interfața de mai jos unifică ambele
 * căi (Vercel/local) în aceeași formă (`newPage`/`close`/`cleanup`) ca handler-ele să nu ramifice.
 * `newPage(cookies, url)` deschide pagina cu acele cookie-uri (pentru pagini care cer autentificare).
 */
/** Eroare la pornirea Chromium: `attempts` = ce s-a încercat și de ce a eșuat (pentru jurnal / diagnostic), `hint` = ce trebuie făcut pe server. */
export class PdfBrowserError extends Error {
  constructor(message: string, public attempts: string[], public hint: string) {
    super(message);
    this.name = "PdfBrowserError";
  }
}

const short = (e: unknown) => (e instanceof Error ? e.message : String(e)).split("\n").filter(Boolean).slice(0, 2).join(" ").slice(0, 300);

export const PDF_BROWSER_HINT =
  "Instalează Chromium pe server: `npx playwright-core install --with-deps chromium` (sau setează CHROME_PATH spre un Chrome/Chromium existent, ex. /usr/bin/chromium-browser), apoi repornește aplicația. Testează la /api/diag/pdf.";

export async function launchBrowser() {
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const { chromium: playwrightChromium } = await import("playwright-core");
    const userDataDir = `/tmp/pw-${randomUUID()}`;
    const context = await playwrightChromium.launchPersistentContext(userDataDir, {
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    return {
      newPage: async (cookies: PdfCookie[] = [], url = "") => {
        if (cookies.length) await context.addCookies(cookies.map((c) => ({ ...c, url })));
        return context.newPage();
      },
      close: () => context.close(),
      cleanup: () => rm(userDataDir, { recursive: true, force: true }),
    };
  }
  // Server propriu / dezvoltare
  const browser = await launchRaw();
  return {
    newPage: async (cookies: PdfCookie[] = [], url = "") => {
      const context = await browser.newContext();
      if (cookies.length) await context.addCookies(cookies.map((c) => ({ ...c, url })));
      return context.newPage();
    },
    close: () => browser.close(),
    cleanup: async () => {},
  };
}

/** Pornește un Chromium pe serverul propriu: cel instalat (playwright install / CHROME_PATH), altfel binarul inclus (@sparticuz/chromium). */
async function launchRaw(): Promise<Browser> {
  const { chromium: playwrightChromium } = await import("playwright-core");
  const attempts: string[] = [];
  // 1. Chromium instalat pe server (playwright install) sau cel indicat prin CHROME_PATH
  try {
    return await playwrightChromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox"] });
  } catch (e) {
    attempts.push(`Chromium instalat${process.env.CHROME_PATH ? ` (CHROME_PATH=${process.env.CHROME_PATH})` : ""}: ${short(e)}`);
  }
  // 2. binarul inclus în proiect (@sparticuz/chromium): merge fără instalare, dacă sistemul are bibliotecile de bază (nss, atk…)
  try {
    const sparticuz = (await import("@sparticuz/chromium")).default;
    return await playwrightChromium.launch({ headless: true, executablePath: await sparticuz.executablePath(), args: [...sparticuz.args, "--no-sandbox"] });
  } catch (e) {
    attempts.push(`@sparticuz/chromium: ${short(e)}`);
  }
  throw new PdfBrowserError("Nu s-a putut porni Chromium pe server.", attempts, PDF_BROWSER_HINT);
}

/**
 * Un singur Chromium pornit o dată și refolosit între PDF-uri (pe serverul propriu): pornirea unui browser nou la fiecare PDF costa ~1 s și ~150–300 MB, iar un val de cereri pornea sute de procese.
 * O pagină nouă pe cerere, în același context (fișierele statice — CSS, fonturi — rămân în cache-ul browserului). Se oprește singur după `IDLE_MS` fără cereri și repornește la următoarea;
 * dacă proba pică din cauza browserului (căzut / închis), se reîncearcă o dată cu unul nou. Pe Vercel nu se folosește (acolo fiecare invocare își lansează browserul).
 */
const IDLE_MS = 5 * 60_000;
type Shared = { browser: Browser | null; ctx: BrowserContext | null; starting: Promise<BrowserContext> | null; active: number; last: number; timer: ReturnType<typeof setInterval> | null };
const gShared = globalThis as unknown as { __pdfShared?: Shared };
const SH: Shared = (gShared.__pdfShared ??= { browser: null, ctx: null, starting: null, active: 0, last: 0, timer: null });

async function sharedContext(): Promise<BrowserContext> {
  if (SH.ctx && SH.browser?.isConnected()) return SH.ctx;
  if (!SH.starting) {
    SH.starting = (async () => {
      const browser = await launchRaw();
      browser.on("disconnected", () => {
        if (SH.browser === browser) {
          SH.browser = null;
          SH.ctx = null;
        }
      });
      const ctx = await browser.newContext();
      SH.browser = browser;
      SH.ctx = ctx;
      if (!SH.timer) {
        SH.timer = setInterval(() => {
          if (SH.browser && SH.active === 0 && Date.now() - SH.last > IDLE_MS) {
            const b = SH.browser;
            SH.browser = null;
            SH.ctx = null;
            void b.close().catch(() => {});
          }
        }, 60_000);
        SH.timer.unref?.();
      }
      return ctx;
    })().finally(() => {
      SH.starting = null;
    });
  }
  return SH.starting;
}

const browserGone = (e: unknown) => /Target (page, context or browser )?has been closed|Browser has been closed|browser has disconnected|Target closed|Connection closed/i.test(e instanceof Error ? e.message : String(e));

/** Rulează `fn` cu o pagină proaspătă din browserul comun (sau, pe Vercel, dintr-un browser lansat pentru această cerere). Pagina se închide la final. */
export async function withPdfPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  if (process.env.VERCEL) {
    const session = await launchBrowser();
    try {
      return await fn(await session.newPage());
    } finally {
      await session.close().catch(() => {});
      await session.cleanup().catch(() => {});
    }
  }
  for (let attempt = 0; ; attempt++) {
    const ctx = await sharedContext();
    let page: Page | null = null;
    SH.active++;
    try {
      page = await ctx.newPage();
      return await fn(page);
    } catch (e) {
      if (attempt === 0 && browserGone(e)) {
        // browser căzut: se aruncă și se reîncearcă o dată cu unul nou
        SH.browser = null;
        SH.ctx = null;
        continue;
      }
      throw e;
    } finally {
      SH.active--;
      SH.last = Date.now();
      await page?.close().catch(() => {});
    }
  }
}
