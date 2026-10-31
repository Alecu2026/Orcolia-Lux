import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { IconChevronLeft } from "@/app/components/icons";
import PortalAccountsTable from "@/app/components/PortalAccountsTable";
import { decodeAccount } from "@/lib/portal-accounts";
import { getPortalAccountsSnap } from "@/lib/services/portal-accounts-cache";
import { getT } from "@/lib/i18n/server-t";
import { listPortalTemplates } from "@/lib/queries/portal-templates";
import PortalTemplatesManager from "@/app/components/PortalTemplatesManager";
import { teamOptions } from "@/lib/queries/teams";

export const dynamic = "force-dynamic";

/**
 * Conturile din portalul clienților. Toate conturile eligibile (cu cont personal SAU contract) se încarcă o dată; filtrele, sortarea și
 * paginarea rulează în browser, cu orice număr de rânduri pe pagină (inclusiv „Toate") — ca la Plătitori.
 */
export default async function PortalAccountsPage() {
  const t = await getT();
  const user = await requireUser();
  if (!can(user, "admin")) redirect("/settings");

  // Lista din memoria serverului (se reface la schimbări și la cel mult un minut). Un set mic vine întreg în HTML; unul mare vine ca primele 100 + totalul, iar restul îl aduce
  // browserul din /api/portal-accounts/snapshot (comprimat, cu ETag, păstrat în IndexedDB) — nu mai trimitem ~19.000 de rânduri în fiecare răspuns.
  const [snap, templates, teams] = await Promise.all([getPortalAccountsSnap(), listPortalTemplates(), teamOptions()]);
  const total = snap.tuples.length;
  const initial = snap.tuples.slice(0, total <= 300 ? total : 100).map(decodeAccount);

  return (
    <div className="flex w-full flex-col gap-3">
      <Link href="/settings" className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-4" /> {t("Înapoi la setări")}
      </Link>
      <div>
        <h1 className="text-xl font-bold">{t("Conturi portal clienți")}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {t("Plătitorii care au cont personal sau contract și pot deschide cont în portal. Alege câte rânduri vrei pe pagină și filtrează după orice criteriu.")}
        </p>
      </div>
      <PortalTemplatesManager initial={templates} teams={teams} />
      <PortalAccountsTable initial={initial} total={total} />
    </div>
  );
}
