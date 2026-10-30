import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getRoutesBundle } from "@/lib/services/meter-routes";
import ReadingRoutesClient from "@/app/components/ReadingRoutesClient";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

/**
 * Rute de citire: comparația planificat / citit pe cititor și pe rută, administrarea rutelor (reguli după datele din 1C: sector, localitate, stradă; cititor; fereastra din lună)
 * și neregulile contoarelor raportate în teren. Necesită „Rute de citire …” (administrare).
 */
export default async function ReadingRoutesPage() {
  const t = await getT();
  const user = await requirePermission("meters.manage");
  // o singură trecere pe server (lista de teren o dată, nu de două ori); valorile pentru reguli (străzi, localități) se cer abia la deschiderea ferestrei unei rute
  // la deschidere mereu proaspăt (memoria de 15 s e pentru reîmprospătările din pagină)
  const bundle = await getRoutesBundle({ fresh: true });
  return (
    <div className="w-full">
      <div className="mb-3">
        <h1 className="text-lg font-bold">{t("Rute de citire")}</h1>
        <p className="text-xs text-ink-soft">{t("Cine citește ce, în ce zile, și cât s-a citit față de plan; plus neregulile găsite la contoare în teren.")}</p>
      </div>
      <ReadingRoutesClient initial={bundle} canExport={can(user, "meters.export")} />
    </div>
  );
}
