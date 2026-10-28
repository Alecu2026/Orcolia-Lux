import { requirePermission } from "@/lib/dal";
import { auditUserOptions } from "@/lib/queries/audit";
import { listRoutes } from "@/lib/services/meter-route-data";
import { getRouteOptions, getRouteReport } from "@/lib/services/meter-routes";
import { listIssues } from "@/lib/services/meter-issues";
import ReadingRoutesClient from "@/app/components/ReadingRoutesClient";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

/**
 * Rute de citire: comparația planificat / citit pe cititor și pe rută, administrarea rutelor (reguli după datele din 1C: sector, localitate, stradă; cititor; fereastra din lună)
 * și neregulile contoarelor raportate în teren. Necesită „Rute de citire …” (administrare).
 */
export default async function ReadingRoutesPage() {
  const t = await getT();
  await requirePermission("meters.manage");
  const [report, routes, options, issues, users] = await Promise.all([getRouteReport(), listRoutes(), getRouteOptions(), listIssues({ open: false, limit: 500 }), auditUserOptions()]);
  return (
    <div className="w-full">
      <div className="mb-3">
        <h1 className="text-lg font-bold">{t("Rute de citire")}</h1>
        <p className="text-xs text-ink-soft">{t("Cine citește ce, în ce zile, și cât s-a citit față de plan; plus neregulile găsite la contoare în teren.")}</p>
      </div>
      <ReadingRoutesClient report={report} routes={routes} options={options} issues={issues} users={users} />
    </div>
  );
}
