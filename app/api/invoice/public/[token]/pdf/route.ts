import { NextResponse, type NextRequest } from "next/server";
import { getInvoiceByToken } from "@/lib/queries/invoices";
import { PdfRateLimitedError } from "@/lib/pdf-limiter";
import { getInvoicePdf } from "@/lib/services/invoice-pdf";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * PDF-ul unei facturi publice (link cu cod în adresă). Ruta e publică, deci e protejată: limită pe adresă IP pentru PDF-urile noi, generare directă (pdfkit, fără browser) și cache pe disc (vezi lib/services/invoice-pdf.ts) — o factură descărcată a doua oară nu mai pornește niciun browser.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ip = await clientIp();
  const invoice = await getInvoiceByToken(token);
  if (!invoice) {
    return NextResponse.json({ error: "Factura nu a fost găsită." }, { status: 404 });
  }

  try {
    const { pdf, etag, cached } = await getInvoicePdf(invoice, () => {
      // doar PDF-urile NOI (cele din cache sunt ieftine) se limitează pe adresă; fără adresă cunoscută (server fără proxy configurat) nu limităm: toți ar împărți aceeași găleată
      if (ip && isRateLimited(`invoice-pdf-gen:${ip}`, 30, 60_000)) throw new PdfRateLimitedError();
    });
    const tag = `"${etag}"`;
    const headers = {
      ETag: tag,
      "Cache-Control": "private, no-cache",
      "X-Pdf-Cache": cached ? "hit" : "miss",
    };
    if (req.headers.get("if-none-match") === tag) return new NextResponse(null, { status: 304, headers });
    return new NextResponse(new Uint8Array(pdf), {
      headers: { ...headers, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Factura-${invoice.number}.pdf"` },
    });
  } catch (e) {
    if (e instanceof PdfRateLimitedError) {
      return NextResponse.json({ error: "Prea multe cereri. Încearcă din nou peste un minut." }, { status: 429, headers: { "Retry-After": "60" } });
    }
    console.error("[invoice/pdf] eșec generare PDF:", e);
    const detail = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `Nu am putut genera PDF-ul.`, detail }, { status: 500 });
  }
}
