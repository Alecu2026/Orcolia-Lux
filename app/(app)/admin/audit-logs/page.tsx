import { requireSuperAdmin } from "@/lib/dal";
import { listAuditLogs } from "@/lib/queries/audit";
import { userOptions } from "@/lib/queries/users";
import AuditLogsClient from "@/app/components/AuditLogsClient";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    user?: string;
    role?: string;
    action?: string;
    module?: string;
    page?: string;
    ps?: string;
  }>;
}) {
  const t = await getT();
  await requireSuperAdmin();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = sp.ps === "all" ? 9999 : Math.min(9999, Math.max(1, Number(sp.ps) || 20));

  const [result, users] = await Promise.all([
    listAuditLogs({
      userId: sp.user || undefined,
      role: sp.role || undefined,
      action: sp.action || undefined,
      module: sp.module || undefined,
      page,
      pageSize,
    }),
    userOptions(),
  ]);

  return (
    <div className="w-full">
      <div className="mb-3">
        <h1 className="text-lg font-bold">{t("Jurnal de audit")}</h1>
        <p className="text-xs text-ink-soft">{t("Istoric complet al acțiunilor — vizibil doar pentru super-admini.")}</p>
      </div>
      <AuditLogsClient
        items={result.items}
        users={users}
        page={result.page}
        hasMore={result.hasMore}
        totalPages={result.totalPages}
        filters={{
          user: sp.user ?? "",
          role: sp.role ?? "",
          action: sp.action ?? "",
          module: sp.module ?? "",
          ps: sp.ps ?? "",
        }}
      />
    </div>
  );
}
