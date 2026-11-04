import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { buildTaskReport, parseReportParams, reportFilterLines, type TaskReportParams } from "@/lib/services/task-report";
import { buildReportPdf } from "@/lib/pdf/report-pdf";
import { getCompanySettings } from "@/lib/queries/company";
import { sheetsToXLSX } from "@/lib/export-utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const mayExport = (user: User, kind: "tickets" | "tasks") => (kind === "tickets" ? can(user, "tickets.view") && can(user, "tickets.export") : can(user, "tasks.view") && can(user, "tasks.export"));

/** Generează raportul (PDF sau Excel) pentru filtrele / rândurile date. `tableLines` = filtrele din tabel (la raportul făcut din Export), ca text pentru antetul PDF-ului. */
async function render(user: User, p: TaskReportParams, format: "pdf" | "xlsx", tableLines?: string[]): Promise<Response> {
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
      ...(tableLines
        ? ["Raport pe rândurile din tabel, cu filtrele aplicate:", ...(tableLines.length ? [tableLines.join(" · ")] : ["fără filtre (toate rândurile)"])]
        : reportFilterLines(p, { section: r.sectionName, team: team?.name ?? null, assignee: assignee?.name ?? null })),
      `${p.kind === "tickets" ? "Cereri" : "Sarcini"} incluse: ${r.count.toLocaleString("ro-RO")}${r.truncated ? " (raport pe cele mai noi; au fost prea multe)" : ""}`,
    ];
    const today = new Date().toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" });
    const pdf = await buildReportPdf({ sheet: r.sheet, companyName: company.companyName || "Apă-Canal", lines, today });
    return new NextResponse(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${base}.pdf"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    console.error("[reports/petitions] eșec:", e);
    return NextResponse.json({ error: "Nu am putut genera raportul." }, { status: 500 });
  }
}

/**
 * Raportul „Petiții și reclamații” pentru cereri sau sarcini, cu aceleași filtre ca pagina Rapoarte (vezi parseReportParams) și `format` (pdf | xlsx).
 * Cere „Vizualizare” și „Export” pe tipul ales.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Autentificare necesară." }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const p = parseReportParams(sp, { tickets: mayExport(user, "tickets"), tasks: mayExport(user, "tasks") });
  if (!mayExport(user, p.kind)) return NextResponse.json({ error: "Fără permisiune de export." }, { status: 403 });
  return render(user, p, sp.get("format") === "xlsx" ? "xlsx" : "pdf");
}

/**
 * Raportul din butonul „Export” al listelor Cereri / Sarcini: `{ kind, ids, lines, format }` — exact rândurile rămase în tabel după filtrele din browser
 * (vizibilitatea contului rămâne aplicată), cu filtrele active în antetul PDF-ului.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Autentificare necesară." }, { status: 401 });
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Cerere invalidă." }, { status: 400 });
  }
  const kind = body.kind === "tasks" ? "tasks" : "tickets";
  if (!mayExport(user, kind)) return NextResponse.json({ error: "Fără permisiune de export." }, { status: 403 });
  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f]{24}$/i.test(x)).slice(0, 50_000) : [];
  const lines = Array.isArray(body.lines) ? body.lines.filter((x): x is string => typeof x === "string").slice(0, 20).map((x) => x.slice(0, 160)) : [];
  const p: TaskReportParams = { ...parseReportParams({ get: () => null }, { tickets: true, tasks: true }), kind, ids };
  return render(user, p, body.format === "xlsx" ? "xlsx" : "pdf", lines);
}
