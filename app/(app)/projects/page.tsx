import { requirePermission } from "@/lib/dal";
import { listProjects } from "@/lib/queries/projects";
import { userOptions } from "@/lib/queries/users";
import { teamOptions } from "@/lib/queries/teams";
import { invoiceClientOptions } from "@/lib/queries/invoices";
import { backfillProjectSeq } from "@/app/actions/projects";
import ProjectsManager from "@/app/components/ProjectsManager";
import type { ProjectStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUS_SET = new Set(["ACTIVE", "ON_HOLD", "DONE", "ARCHIVED"]);

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string; q?: string; status?: string; page?: string; ps?: string }>;
}) {
  await requirePermission("projects.view");
  await backfillProjectSeq();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = sp.ps === "all" ? 9999 : Math.min(9999, Math.max(1, Number(sp.ps) || 20));
  const status = sp.status && STATUS_SET.has(sp.status) ? (sp.status as ProjectStatus) : undefined;

  const [result, users, teams, clients] = await Promise.all([
    listProjects({ search: sp.q || undefined, status, page, pageSize }),
    userOptions(),
    teamOptions(),
    invoiceClientOptions(),
  ]);
  return (
    <div className="w-full">
      <ProjectsManager
        projects={result.items}
        users={users}
        teams={teams}
        clients={clients}
        page={result.page}
        hasMore={result.hasMore}
        totalPages={result.totalPages}
        filters={{ q: sp.q ?? "", status: sp.status ?? "", ps: sp.ps ?? "" }}
        openCreate={sp.create === "1"}
      />
    </div>
  );
}
