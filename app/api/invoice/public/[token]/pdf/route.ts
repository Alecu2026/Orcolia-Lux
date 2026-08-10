import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { getInvoiceByToken } from "@/lib/queries/invoices";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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
 * căi (Vercel/local) în aceeași formă (`newPage`/`close`/`cleanup`) ca handler-ul GET să nu ramifice.
 */
async function launchBrowser() {
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
      newPage: () => context.newPage(),
      close: () => context.close(),
      cleanup: () => rm(userDataDir, { recursive: true, force: true }),
    };
  }
  const { chromium: playwrightChromium } = await import("playwright");
  const browser = await playwrightChromium.launch({ headless: true });
  return {
    newPage: () => browser.newPage(),
    close: () => browser.close(),
    cleanup: async () => {},
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const invoice = await getInvoiceByToken(token);
  if (!invoice) {
    return NextResponse.json({ error: "Factura nu a fost găsită." }, { status: 404 });
  }

  let session: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  try {
    session = await launchBrowser();
    const page = await session.newPage();
    await page.goto(`${env.appUrl}/invoice/public/${token}`, { waitUntil: "networkidle" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      landscape: invoice.kind === "APA_CANAL",
      preferCSSPageSize: true,
      printBackground: true,
    });
    return new NextResponse(new Uint8Array(pdfBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Factura-${invoice.number}.pdf"`,
      },
    });
  } catch (e) {
    console.error("[invoice/pdf] eșec generare PDF:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Nu am putut genera PDF-ul.`, detail }, { status: 500 });
  } finally {
    await session?.close().catch(() => {});
    await session?.cleanup().catch(() => {});
  }
}
