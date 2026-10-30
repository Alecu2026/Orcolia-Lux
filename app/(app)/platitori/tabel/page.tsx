import Link from "next/link";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { IconChevronLeft } from "@/app/components/icons";
import OneCTable from "@/app/components/OneCTable";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

export default async function OneCTablePage() {
  const t = await getT();
  const user = await requirePermission("payers.view");
  return (
    <div className="w-full">
      <Link href="/platitori" className="mb-3 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-4" /> {t("Înapoi la plătitori")}
      </Link>
      <div className="mb-4">
        <h1 className="text-xl font-bold">{t("Tabel 1C — toate datele din export")}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {t("Cele 6 tabele din exportul 1C (Документы, Абоненты, Потребители, ИзмерительныеПриборы, Потребления, РасчетСумм) combinate într-un singur rând per UID. Filtrezi pe orice coloană, iar rândul se poate deschide ca să vezi toate rândurile lui din fiecare tabel. Ultimele 3 coloane compară cu factura din PWA.")}
        </p>
      </div>
      <OneCTable canExport={can(user, "payers.export")} />
    </div>
  );
}
