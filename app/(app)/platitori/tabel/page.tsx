import Link from "next/link";
import { cookies } from "next/headers";
import { preload } from "react-dom";
import { requirePermission } from "@/lib/dal";
import { ONEC_V_COOKIE } from "@/lib/payer-prefs";
import { getOneCSnap, peekOneCVersion } from "@/lib/services/onec-cache";
import { can } from "@/lib/permissions";
import { IconChevronLeft } from "@/app/components/icons";
import OneCTable from "@/app/components/OneCTable";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

export default async function OneCTablePage() {
  const t = await getT();
  const user = await requirePermission("payers.view");
  // Lista (luna cea mai recentă) se construiește în fundal, fără să țină pagina în așteptare; browserul începe descărcarea ei chiar de la primirea HTML-ului
  // (în paralel cu JS-ul), doar dacă nu are deja versiunea curentă (cookie).
  void getOneCSnap("latest").catch(() => {});
  const v = peekOneCVersion("latest");
  const jar = await cookies();
  if (!v || jar.get(ONEC_V_COOKIE)?.value !== v.replace(/[^0-9a-zA-Z]/g, "")) preload("/api/platitori/tabel/snapshot?period=latest", { as: "fetch", crossOrigin: "anonymous" });
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
