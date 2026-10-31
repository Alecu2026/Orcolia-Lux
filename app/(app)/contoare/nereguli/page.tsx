import { cookies } from "next/headers";
import { isSuper, requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
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
  const user = await requirePermission("payers.view");
  const sp = await searchParams;
  const jar = await cookies();
  const filters = sanitizeIssueFilters(sp);
  const perPage = normalizePerPageClient(sp.perPage ?? jar.get(ISSUES_PP_COOKIE)?.value);
  const isAdmin = can(user, "admin");
  // mesajele și canalele automate sunt setări de administrator: se citesc (și se trimit în pagină) doar pentru ei
  const [rows, teams, messages, autoNotify] = await timed("nereguli/lista", Promise.all([listIssueRegister(), teamNameMap(), isAdmin ? getIssueMessages() : Promise.resolve(null), isAdmin ? getAutoNotify() : Promise.resolve(null)]));
  return (
    <MeterIssuesRegister
      initialRows={rows}
      initialFilters={filters}
      initialPerPage={perPage}
      teams={[...teams].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ro"))}
      canManage={can(user, "meters.manage")}
      messages={messages}
      autoNotify={autoNotify}
      canEditMessages={isAdmin}
      isSuper={isSuper(user)}
      emailEnabled={env.smtp.enabled}
      smsEnabled={env.sms.enabled}
    />
  );
}
