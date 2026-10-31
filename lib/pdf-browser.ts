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
  // Server propriu / dezvoltare: Chromium instalat cu `npx playwright-core install chromium`, sau un Chrome/Chromium existent, indicat prin CHROME_PATH.
  const { chromium: playwrightChromium } = await import("playwright-core");
  const attempts: string[] = [];
  const wrap = (browser: Awaited<ReturnType<typeof playwrightChromium.launch>>) => ({
    newPage: async (cookies: PdfCookie[] = [], url = "") => {
      const context = await browser.newContext();
      if (cookies.length) await context.addCookies(cookies.map((c) => ({ ...c, url })));
      return context.newPage();
    },
    close: () => browser.close(),
    cleanup: async () => {},
  });
  // 1. Chromium instalat pe server (playwright install) sau cel indicat prin CHROME_PATH
  try {
    return wrap(await playwrightChromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ["--no-sandbox"] }));
  } catch (e) {
    attempts.push(`Chromium instalat${process.env.CHROME_PATH ? ` (CHROME_PATH=${process.env.CHROME_PATH})` : ""}: ${short(e)}`);
  }
  // 2. binarul inclus în proiect (@sparticuz/chromium): merge fără instalare, dacă sistemul are bibliotecile de bază (nss, atk…)
  try {
    const sparticuz = (await import("@sparticuz/chromium")).default;
    return wrap(await playwrightChromium.launch({ headless: true, executablePath: await sparticuz.executablePath(), args: [...sparticuz.args, "--no-sandbox"] }));
  } catch (e) {
    attempts.push(`@sparticuz/chromium: ${short(e)}`);
  }
  throw new PdfBrowserError("Nu s-a putut porni Chromium pe server.", attempts, PDF_BROWSER_HINT);
}
