import { cookies } from "next/headers";
import { requireSuperAdmin } from "@/lib/dal";
import { auditUserOptions, filterFromState, listAuditChunk, listAuditLogs, normalizeAuditPageSize } from "@/lib/queries/audit";
import { AUDIT_FIRST_CHUNK, AUDIT_PS_COOKIE, normalizeAuditPs, sanitizeAuditState } from "@/lib/audit-meta";
import AuditLogsClient from "@/app/components/AuditLogsClient";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  await requireSuperAdmin();
  const sp = await searchParams;
  const filters = sanitizeAuditState(sp);
  // Fără ?ps= în adresă se folosește ultima alegere (cookie): „Toate” / 1000 apar cu mărimea potrivită din prima afișare.
  const jar = await cookies();
  const ps = normalizeAuditPs(sp.ps ?? jar.get(AUDIT_PS_COOKIE)?.value);
  const page = ps === "all" ? 1 : Math.max(1, Math.floor(Number(sp.page)) || 1);

  // Primul cadru vine de pe server (pagina nu se deschide goală): o pagină, sau — la „Toate” — prima bucată; restul se aduce apoi în fundal.
  const [initial, users] = await Promise.all([
    ps === "all"
      ? listAuditChunk(filterFromState(filters), { limit: AUDIT_FIRST_CHUNK }).then((c) => ({ ...c, page: 1, pageSize: AUDIT_FIRST_CHUNK, totalPages: 1 }))
      : listAuditLogs(filterFromState(filters, page, normalizeAuditPageSize(ps))),
    auditUserOptions(),
  ]);

  return (
    <div className="w-full">
      <div className="mb-3">
        <h1 className="text-lg font-bold">{t("Jurnal de audit")}</h1>
        <p className="text-xs text-ink-soft">{t("Istoric complet al acțiunilor — vizibil doar pentru super-admini.")}</p>
      </div>
      <AuditLogsClient initial={JSON.parse(JSON.stringify(initial))} users={users} initialFilters={filters} initialPage={initial.page} initialPs={ps} />
    </div>
  );
}
