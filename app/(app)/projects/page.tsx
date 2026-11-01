import { requirePermission } from "@/lib/dal";
import { getProjectCounts, getProjectSnap } from "@/lib/services/project-cache";
import { PROJECT_HEAD_ROWS, PROJECT_INLINE_MAX, withCounts } from "@/lib/projects-snapshot";
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
  const sp = await searchParams;
  await backfillProjectSeq(); // doar după o scriere pe Project face o interogare; altfel e o verificare în memorie

  // Lista vine din memoria serverului (vezi lib/services/project-cache.ts), nu din baza de date la fiecare vizită. Până la PROJECT_INLINE_MAX proiecte vin toate în pagină (filtrarea, sortarea și
  // paginarea rulează în browser, vezi DataTable); peste, pagina primește doar primele rânduri, iar restul vine o singură dată în browser (IndexedDB).
  const [snap, counts, users, teams, clients] = await Promise.all([
    getProjectSnap(),
    getProjectCounts(),
    userOptions(),
    teamOptions(),
    crmClientOptions(),
  ]);
  const big = snap.count > PROJECT_INLINE_MAX;
  const projects = withCounts(big ? snap.rows.slice(0, PROJECT_HEAD_ROWS) : snap.rows, counts.map);
  return (
    <div className="w-full">
      <ProjectsTable canExport={can(user, "projects.export")} canImport={can(user, "projects.import")} projects={projects} total={snap.count} version={big ? snap.version : null} users={users} teams={teams} clients={clients} openCreate={sp.create === "1"} canEdit={can(user, "projects.edit")} canCreate={can(user, "projects.create")} canDelete={can(user, "projects.delete")} canCreateTask={can(user, "tasks.create")} />
    </div>
  );
}
