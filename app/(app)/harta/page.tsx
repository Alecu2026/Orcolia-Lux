import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { listProjectsWithLocation } from "@/lib/queries/projects";
import ProjectsMapViewDynamic from "@/app/components/ProjectsMapViewDynamic";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { getMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function HartaPage() {
  const user = await requirePermission("map.view");
  const [pins, locale] = await Promise.all([listProjectsWithLocation(), getLocaleFromCookie()]);
  const m = getMessages(locale);
  // stratul „Contoare” (cu filtre): doar cine are acces la contoare; punctele se aduc abia când stratul e pornit
  const meters = can(user, "payers.view") || can(user, "meters.read") || can(user, "meters.manage");

  return (
    <div className="w-full">
      <h1 className="mb-4 text-lg font-bold">{m.map.title}</h1>
      <ProjectsMapViewDynamic pins={pins} meters={meters} />
    </div>
  );
}
