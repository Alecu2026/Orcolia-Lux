import { requirePermission } from "@/lib/dal";
import { listProjects } from "@/lib/queries/projects";
import { userOptions } from "@/lib/queries/users";
import { teamOptions } from "@/lib/queries/teams";
import { crmClientOptions } from "@/lib/queries/clients";
import { backfillProjectSeq } from "@/lib/services/project-seq";
import ProjectsTable from "@/app/components/ProjectsTable";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const user = await requirePermission("projects.view");
  await backfillProjectSeq();
  const sp = await searchParams;

  // Toate proiectele odată; filtrarea, sortarea și paginarea rulează în browser (vezi DataTable).
  const [result, users, teams, clients] = await Promise.all([
    listProjects({ page: 1, pageSize: 20000 }),
    userOptions(),
    teamOptions(),
    crmClientOptions(),
  ]);
  return (
    <div className="w-full">
      <ProjectsTable canExport={can(user, "projects.export")} canImport={can(user, "projects.import")} projects={result.items} users={users} teams={teams} clients={clients} openCreate={sp.create === "1"} canEdit={can(user, "projects.edit")} canCreate={can(user, "projects.create")} canDelete={can(user, "projects.delete")} canCreateTask={can(user, "tasks.create")} />
    </div>
  );
}
