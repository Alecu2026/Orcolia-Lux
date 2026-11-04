import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { buildTaskReport, parseReportParams, reportFilterLines } from "@/lib/services/task-report";
import { buildReportPdf } from "@/lib/pdf/report-pdf";
import { getCompanySettings } from "@/lib/queries/company";
import { sheetsToXLSX } from "@/lib/export-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Raportul „Petiții și reclamații” pentru cereri sau sarcini, ca PDF sau Excel, cu aceleași filtre ca pagina Rapoarte (vezi parseReportParams) și `format` (pdf | xlsx).
 * Cere „Vizualizare” și „Export” pe tipul ales.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Autentificare necesară." }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const p = parseReportParams(sp, { tickets: can(user, "tickets.view") && can(user, "tickets.export"), tasks: can(user, "tasks.view") && can(user, "tasks.export") });
  const kindOk = p.kind === "tickets" ? can(user, "tickets.view") && can(user, "tickets.export") : can(user, "tasks.view") && can(user, "tasks.export");
  if (!kindOk) return NextResponse.json({ error: "Fără permisiune de export." }, { status: 403 });
  const format = sp.get("format") === "xlsx" ? "xlsx" : "pdf";

  try {
    const r = await buildTaskReport(user, p);
    const day = new Date().toISOString().slice(0, 10);
    const base = `Raport-${p.kind === "tickets" ? "cereri" : "sarcini"}-${day}`;
    if (format === "xlsx") {
      const blob = sheetsToXLSX([r.sheet]);
      return new NextResponse(blob.stream() as ReadableStream<Uint8Array>, {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${base}.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }
    const [company, team, assignee] = await Promise.all([
      getCompanySettings(),
      p.teamId ? prisma.team.findUnique({ where: { id: p.teamId }, select: { name: true } }) : null,
      p.assigneeId ? prisma.user.findUnique({ where: { id: p.assigneeId }, select: { name: true } }) : null,
    ]);
    const lines = [
      ...reportFilterLines(p, { section: r.sectionName, team: team?.name ?? null, assignee: assignee?.name ?? null }),
      `${p.kind === "tickets" ? "Cereri" : "Sarcini"} incluse: ${r.count.toLocaleString("ro-RO")}${r.truncated ? " (raport pe cele mai noi; au fost prea multe)" : ""}`,
    ];
    const today = new Date().toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" });
    const pdf = await buildReportPdf({ sheet: r.sheet, companyName: company.companyName || "Apă-Canal", lines, today });
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${base}.pdf"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[reports/petitions] eșec:", e);
    return NextResponse.json({ error: "Nu am putut genera raportul." }, { status: 500 });
  }
}
