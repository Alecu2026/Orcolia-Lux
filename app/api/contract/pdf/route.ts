import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { prisma } from "@/lib/prisma";
import { buildTenderPdf, TENDER_PDF_LANGS, TENDER_PDF_SHOWS, type TenderPdfChecks, type TenderPdfLang, type TenderPdfShow } from "@/lib/pdf/tender-pdf";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Caietul de sarcini (pagina Contract) în PDF: toate punctele cu bifele lor (cine și când), statusul în CRM și textul din „i”.
 * `lang` = both | ro | en (implicit both), `show` = all | done | todo (implicit all), `info` = 0 scoate textul din „i”. Același drept ca pagina: „Gestionare utilizatori”.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "users.manage")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const sp = new URL(req.url).searchParams;
  const lang = (TENDER_PDF_LANGS as string[]).includes(sp.get("lang") ?? "") ? (sp.get("lang") as TenderPdfLang) : "both";
  const show = (TENDER_PDF_SHOWS as string[]).includes(sp.get("show") ?? "") ? (sp.get("show") as TenderPdfShow) : "all";
  const info = sp.get("info") !== "0";

  const checks: TenderPdfChecks = {};
  let companyName = "";
  if (!DEMO) {
    const [rows, company] = await Promise.all([
      prisma.tenderCheck.findMany({ select: { id: true, byName: true, updatedAt: true } }),
      prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { companyName: true } }),
    ]);
    for (const r of rows) checks[r.id] = { by: r.byName, at: r.updatedAt.toISOString() };
    companyName = company?.companyName ?? "";
  }

  const now = new Date();
  let pdf: Buffer;
  try {
    pdf = await buildTenderPdf({ companyName, generatedBy: user.name, now, lang, show, info, checks });
  } catch (e) {
    console.error("[contract-pdf] generare eșuată:", e);
    return Response.json({ error: "Nu am putut genera PDF-ul. Încearcă din nou." }, { status: 500 });
  }

  const day = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" });
  const name = lang === "en" ? "technical-specification" : "caiet-de-sarcini";
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}-${lang === "both" ? "ro-en-" : lang === "ro" ? "ro-" : "en-"}${day}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
