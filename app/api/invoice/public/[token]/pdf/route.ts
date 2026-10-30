import { NextResponse, type NextRequest } from "next/server";
import { getInvoiceByToken } from "@/lib/queries/invoices";
import { selfBaseUrl } from "@/lib/self-url";
import { launchBrowser } from "@/lib/pdf-browser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

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
    await page.goto(`${await selfBaseUrl(_req.url)}/invoice/public/${token}`, { waitUntil: "networkidle" });
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
