import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSuper, requireUser } from "@/lib/dal";
import { can, homePath } from "@/lib/permissions";
import { canManageMeterIssues, issueAccess, visibleIssues } from "@/lib/meter-issue-access";
import { normalizePerPageClient } from "@/lib/payer-notify";
import { ISSUES_PP_COOKIE } from "@/lib/payer-prefs";
import { sanitizeIssueFilters } from "@/lib/meter-issue-register";
import { listIssueRegister, teamNameMap } from "@/lib/services/meter-issues";
import MeterIssuesRegister from "@/app/components/MeterIssuesRegister";
import { timed } from "@/lib/timing";
import { env } from "@/lib/env";
import { getAutoNotify, getIssueMessages } from "@/lib/services/auto-notify";

export const dynamic = "force-dynamic";

/**
 * Nereguli contoare — registrul neregulilor raportate (cititori în teren, portal): cine remediază (client / companie), secția responsabilă și termenul de remediere,
 * deschise sau rezolvate. Prima afișare vine de pe server, apoi lista rămâne în browser (ETag), cu filtre instant, paginare și rânduri virtualizate.
 */
export default async function MeterIssuesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  // vede registrul: cine are „Plătitori – Vizualizare” (toate neregulile) sau orice membru al unei secții (doar neregulile secției lui)
  const access = issueAccess(user);
  if (!access) redirect(homePath(user));
  const sp = await searchParams;
  const jar = await cookies();
  const parsed = sanitizeIssueFilters(sp);
  // implicit: doar neregulile secției lui (dacă are secție și vede toate neregulile); le poate schimba din filtrul „Secția”
  const filters = !parsed.team && access.all && access.teamIds.length > 0 ? { ...parsed, team: "mine" } : parsed;
  const perPage = normalizePerPageClient(sp.perPage ?? jar.get(ISSUES_PP_COOKIE)?.value);
  const isAdmin = can(user, "admin");
  // mesajele și canalele automate sunt setări de administrator: se citesc (și se trimit în pagină) doar pentru ei
  const [rows, teams, messages, autoNotify] = await timed("nereguli/lista", Promise.all([listIssueRegister(), teamNameMap(), isAdmin ? getIssueMessages() : Promise.resolve(null), isAdmin ? getAutoNotify() : Promise.resolve(null)]));
  return (
    <MeterIssuesRegister
      initialRows={visibleIssues(rows, access)}
      restricted={!access.all}
      ownTeamIds={access.teamIds}
      initialFilters={filters}
      initialPerPage={perPage}
      teams={[...teams].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ro"))}
      canManage={canManageMeterIssues(user)}
      canTicket={can(user, "tasks.create")}
      messages={messages}
      autoNotify={autoNotify}
      canEditMessages={isAdmin}
      isSuper={isSuper(user)}
      emailEnabled={env.smtp.enabled}
      smsEnabled={env.sms.enabled}
    />
  );
}
