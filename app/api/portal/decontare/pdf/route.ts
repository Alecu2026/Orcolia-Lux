import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentClient } from "@/lib/client-dal";
import { launchBrowser } from "@/lib/pdf-browser";
import { LOCALE_COOKIE } from "@/lib/i18n/locale-cookie";
import { selfBaseUrl } from "@/lib/self-url";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Decontarea clientului din portal, ca PDF: aceeași pagină de tipărire (/portal/print/decontare) deschisă într-un Chromium headless cu sesiunea
 * și limba clientului. Un client primește DOAR propria decontare (pagina o citește din sesiune, nu dintr-un parametru).
 */
export async function GET(req: Request) {
  const client = await getCurrentClient();
  if (!client) return NextResponse.json({ error: "Neautentificat." }, { status: 401 });

  const jar = await cookies();
  const session = jar.get("client_session")?.value;
  if (!session) return NextResponse.json({ error: "Neautentificat." }, { status: 401 });
  const base = await selfBaseUrl(req.url);
  const locale = jar.get(LOCALE_COOKIE)?.value;
  const pass = [{ name: "client_session", value: session }, ...(locale ? [{ name: LOCALE_COOKIE, value: locale }] : [])];

  let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage(pass, base);
    await page.goto(`${base}/portal/print/decontare`, { waitUntil: "networkidle" });
    const pdf = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });
    const day = new Date().toISOString().slice(0, 10);
    const who = (client.meterSeries ?? client.name).replace(/[^\w.-]+/g, "_").slice(0, 40);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Decontare-${who}-${day}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[portal/decontare/pdf] eșec generare PDF:", e);
    return NextResponse.json({ error: "Nu am putut genera PDF-ul." }, { status: 500 });
  } finally {
    await browser?.close().catch(() => {});
    await browser?.cleanup().catch(() => {});
  }
}
