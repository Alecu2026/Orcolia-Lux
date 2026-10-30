import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import FieldReadings from "@/app/components/FieldReadings";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

/**
 * Citiri teren: persoana responsabilă merge la fiecare contor și scrie indexul lunii curente (m³); locația se ia automat, poza contorului se adaugă pe loc.
 * Tabel ca la Contoare / Plătitori (filtre instant, paginare, pop-up), dar și mod telefon cu carduri. Necesită „Citiri contoare” (nu și acces la Plătitori).
 */
export default async function FieldReadingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const user = await requirePermission("meters.read");
  const sp = await searchParams;
  return (
    <div className="w-full">
      <div className="mb-3">
        <h1 className="text-xl font-bold">{t("Citiri teren")}</h1>
        <p className="mt-0.5 text-sm text-ink-soft">{t("Alege contorul, scrie indexul (m³) de luna aceasta — locația se ia automat — și, dacă vrei, fă o poză contorului.")}</p>
      </div>
      <FieldReadings openId={sp.meter ?? null} canViewMeter={can(user, "payers.view")} canExport={can(user, "meters.export")} initialQuery={sp} meId={user.id} />
    </div>
  );
}
