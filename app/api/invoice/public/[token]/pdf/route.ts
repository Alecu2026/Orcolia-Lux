import { NextResponse, type NextRequest } from "next/server";
import { getInvoiceByToken } from "@/lib/queries/invoices";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Lansează un Chromium headless — binarul comprimat @sparticuz pe Vercel, Chromium local în dezvoltare. */
async function launchBrowser() {
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    const { chromium: playwrightChromium } = await import("playwright-core");
    return playwrightChromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  const { chromium: playwrightChromium } = await import("playwright");
  return playwrightChromium.launch({ headless: true });
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

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
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
    return NextResponse.json({ error: "Nu am putut genera PDF-ul." }, { status: 500 });
  } finally {
    await browser?.close().catch(() => {});
  }
}
