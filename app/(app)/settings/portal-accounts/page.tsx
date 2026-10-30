import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { IconChevronLeft } from "@/app/components/icons";
import PortalAccountsTable, { type PortalAccountRow } from "@/app/components/PortalAccountsTable";
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

  // Fără orderBy în baza de date (sortarea pe zeci de mii de rânduri depășește limita MongoDB): sortează tabelul în browser.
  const clients = await prisma.client.findMany({
    where: { OR: [{ meterSeries: { not: null } }, { apaCanalContract: { not: null } }] },
    select: {
      id: true,
      name: true,
      meterSeries: true,
      apaCanalContract: true,
      email: true,
      portalPasswordHash: true,
      portalActivatedAt: true,
      portalLastLoginAt: true,
      createdAt: true,
    },
  });

  const templates = await listPortalTemplates();

  const rows: PortalAccountRow[] = clients.map((c) => ({
    id: c.id,
    name: c.name,
    account: c.meterSeries,
    contract: c.apaCanalContract,
    email: c.email || null,
    activated: !!c.portalPasswordHash,
    activatedAt: c.portalActivatedAt?.toISOString() ?? null,
    lastLoginAt: c.portalLastLoginAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
  }));

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
      <PortalTemplatesManager initial={templates} teams={await teamOptions()} />
      <PortalAccountsTable rows={rows} />
    </div>
  );
}
