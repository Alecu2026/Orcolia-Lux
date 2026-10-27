import { requireSuperAdmin } from "@/lib/dal";
import { auditUserOptions, filterFromState, listAuditLogs, normalizeAuditPageSize } from "@/lib/queries/audit";
import { sanitizeAuditState } from "@/lib/audit-meta";
import AuditLogsClient from "@/app/components/AuditLogsClient";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  await requireSuperAdmin();
  const sp = await searchParams;
  const filters = sanitizeAuditState(sp);
  const page = Math.max(1, Math.floor(Number(sp.page)) || 1);
  const pageSize = normalizeAuditPageSize(sp.ps);

  // Primul cadru vine de pe server (pagina nu se deschide goală); filtrele și paginile următoare se cer apoi fără reîncărcarea paginii.
  const [initial, users] = await Promise.all([listAuditLogs(filterFromState(filters, page, pageSize)), auditUserOptions()]);

  return (
    <div className="w-full">
      <div className="mb-3">
        <h1 className="text-lg font-bold">{t("Jurnal de audit")}</h1>
        <p className="text-xs text-ink-soft">{t("Istoric complet al acțiunilor — vizibil doar pentru super-admini.")}</p>
      </div>
      <AuditLogsClient initial={JSON.parse(JSON.stringify(initial))} users={users} initialFilters={filters} initialPage={initial.page} initialPageSize={pageSize} />
    </div>
  );
}
