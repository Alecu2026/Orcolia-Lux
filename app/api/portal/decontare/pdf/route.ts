import { NextResponse } from "next/server";
import { getCurrentClient } from "@/lib/client-dal";
import { getPayerStatement } from "@/lib/services/payer-statement";
import { getCompanySettings } from "@/lib/queries/company";
import { buildStatementPdf } from "@/lib/pdf/statement-pdf";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { makeT } from "@/lib/i18n/t";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Decontarea clientului din portal, ca PDF, generată direct pe server (pdfkit) — fără Chromium / browser instalat. Un client primește DOAR propria decontare
 * (se citește din sesiune, nu dintr-un parametru).
 */
export async function GET() {
  const client = await getCurrentClient();
  if (!client) return NextResponse.json({ error: "Neautentificat." }, { status: 401 });

  try {
    const locale = await getLocaleFromCookie();
    const t = makeT(locale);
    const [statement, company] = await Promise.all([getPayerStatement(client.id, { forPortal: true }), getCompanySettings()]);
    if (!statement) return NextResponse.json({ error: "Nu există decontare." }, { status: 404 });
    const today = new Date().toLocaleDateString(locale === "ru" ? "ru-RU" : locale === "en" ? "en-GB" : "ro-RO", { timeZone: "Europe/Bucharest" });
    const pdf = await buildStatementPdf({ statement, clientName: client.name, companyName: company.companyName || "Apă-Canal", locale: locale === "ru" || locale === "en" ? locale : "ro", t, today });
    const day = new Date().toISOString().slice(0, 10);
    const who = (statement.client.account ?? client.name).replace(/[^\w.-]+/g, "_").slice(0, 40);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Decontare-${who}-${day}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error("[portal/decontare/pdf] eșec generare PDF:", e);
    return NextResponse.json({ error: "Nu am putut genera PDF-ul.", code: "PDF" }, { status: 500 });
  }
}
