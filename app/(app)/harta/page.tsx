import { requirePermission } from "@/lib/dal";
import { listProjectsWithLocation } from "@/lib/queries/projects";
import ProjectsMapViewDynamic from "@/app/components/ProjectsMapViewDynamic";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { getMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function HartaPage() {
  await requirePermission("projects.view");
  const [pins, locale] = await Promise.all([listProjectsWithLocation(), getLocaleFromCookie()]);
  const m = getMessages(locale);

  return (
    <div className="w-full">
      <h1 className="mb-4 text-lg font-bold">{m.map.title}</h1>
      <ProjectsMapViewDynamic pins={pins} />
    </div>
  );
}
