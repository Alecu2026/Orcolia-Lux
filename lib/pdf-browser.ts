import "server-only";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

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
  // Server propriu / dezvoltare: Chromium instalat cu `npx playwright-core install chromium`, sau un Chrome/Chromium existent, indicat prin CHROME_PATH.
  const { chromium: playwrightChromium } = await import("playwright-core");
  const browser = await playwrightChromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox"] });
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
