import { requireAnyPermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getT } from "@/lib/i18n/server-t";
import { sectionOptions } from "@/lib/queries/sections";
import { teamOptions } from "@/lib/queries/teams";
import { userOptions } from "@/lib/queries/users";
import { buildTaskReport, parseReportParams, reportQuery } from "@/lib/services/task-report";
import ReportFilters from "@/app/components/ReportFilters";

export const dynamic = "force-dynamic";

const FILL = ["bg-[#E2EFDA]", "bg-[#DDEBF7]", "bg-[#FFF2CC]"] as const;
const dayKey = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Bucharest" }).format(d);

/**
 * Rapoarte: „Petiții și reclamații cu privire la furnizarea serviciului” pentru cereri sau sarcini (la alegere), în forma formularului de raportare. Raportul se recalculează
 * la orice schimbare de filtru (perioadă, secție, echipă, responsabil, status, tip serviciu, tip consumator, origine) și se descarcă ca PDF sau Excel cu aceleași filtre.
 */
export default async function ReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireAnyPermission(["tickets.view", "tasks.view"]);
  const tr = await getT();
  const sp = await searchParams;
  const kinds = { tickets: can(user, "tickets.view"), tasks: can(user, "tasks.view") };
  const p = parseReportParams({ get: (k) => sp[k] ?? null }, kinds);
  // prima deschidere (fără filtre alese): luna curentă
  if (!sp.f && !sp.from && !sp.to) {
    const now = new Date();
    p.to = dayKey(now);
    p.from = `${p.to.slice(0, 8)}01`;
  }
  const canExport = p.kind === "tickets" ? can(user, "tickets.export") : can(user, "tasks.export");

  const [sections, teams, users] = await Promise.all([sectionOptions(), teamOptions(), userOptions()]);
  let report: Awaited<ReturnType<typeof buildTaskReport>> | null = null;
  let error = false;
  try {
    report = await buildTaskReport(user, p);
  } catch (e) {
    console.error("[rapoarte] eșec:", e);
    error = true;
  }

  const q = reportQuery(p);
  const rows = report?.sheet.rows ?? [];
  const head = rows[2] ?? [];
  const numbering = rows[3] ?? [];
  const body = rows.slice(4);
  const blank = body.map((r) => r.length === 0).lastIndexOf(true);
  const data = blank >= 0 ? body.slice(0, blank) : body;
  const footnote = blank >= 0 ? String(body[blank + 1]?.[0] ?? "") : "";
  // culoarea fiecărui rând = a secțiunii (1 / 2 / 3) din care face parte
  const fills: string[] = [];
  for (const r of data) {
    const isSection = r[0] !== "" && r[0] != null;
    const prev = fills[fills.length - 1] ?? FILL[0];
    fills.push(isSection ? (r[0] === 2 ? FILL[1] : r[0] === 3 ? FILL[2] : FILL[0]) : prev);
  }

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h1 className="text-base font-bold">{tr("Rapoarte")}</h1>
        <span className="text-xs text-ink-soft">{tr("Petiții și reclamații cu privire la furnizarea serviciului")}</span>
        {canExport && report && (
          <span className="ml-auto flex items-center gap-1.5">
            <a href={`/api/reports/petitions?${q}&format=pdf`} download className="tap inline-flex h-8 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong" data-report-pdf="">
              📄 {tr("Descarcă PDF")}
            </a>
            <a href={`/api/reports/petitions?${q}&format=xlsx`} download className="tap inline-flex h-8 items-center rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium text-ink-soft hover:bg-[var(--color-surface-2)]" data-report-xlsx="">
              📊 {tr("Descarcă Excel")}
            </a>
          </span>
        )}
      </div>

      <ReportFilters
        value={{ kind: p.kind, from: p.from, to: p.to, sec: p.sectionId, team: p.teamId, who: p.assigneeId, status: p.status, svc: p.service, cons: p.consumer, orig: p.origin }}
        kinds={kinds}
        sections={sections}
        teams={teams}
        users={users}
      />

      {error ? (
        <p className="rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">{tr("Nu am putut calcula raportul.")}</p>
      ) : report && (
        <>
          <p className="mb-1.5 text-xs text-ink-soft">
            <b className="text-ink">{report.count.toLocaleString("ro-RO")}</b> {p.kind === "tickets" ? tr("cereri incluse") : tr("sarcini incluse")}
            {report.truncated && <span className="ml-2 text-st-progress">{tr("Prea multe rânduri: raportul e făcut pe cele mai noi.")}</span>}
          </p>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-xs" data-report-table="">
              <thead>
                <tr>
                  {head.map((h, i) => <th key={i} className="border border-black/70 bg-[#FFE699] px-2 py-2 text-center font-bold text-black">{String(h)}</th>)}
                </tr>
                <tr>
                  {numbering.map((h, i) => <th key={i} className="border border-black/70 bg-[#FFE699] px-2 py-1 text-center font-bold text-black">{String(h)}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.map((r, ri) => {
                  const isSection = r[0] !== "" && r[0] != null;
                  return (
                    <tr key={ri} className={`${fills[ri]} text-black`}>
                      {r.map((c, ci) => (
                        <td key={ci} className={`border border-black/70 px-2 py-1 ${ci === 1 ? "text-left" : "text-center tabular-nums"} ${isSection || ci === 0 ? "font-bold" : ""}`}>
                          {typeof c === "number" ? c.toLocaleString("ro-RO", { maximumFractionDigits: 1 }) : String(c ?? "")}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {footnote && <p className="mt-2 text-[11px] text-ink-soft">{footnote}</p>}
        </>
      )}
    </div>
  );
}
