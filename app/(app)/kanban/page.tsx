import { requirePermission } from "@/lib/dal";
import { can, canUseAllScope } from "@/lib/permissions";
import { listTasksForPage, taskViewFilter } from "@/lib/queries/tasks";
import { userOptions } from "@/lib/queries/users";
import { teamOptions } from "@/lib/queries/teams";
import { projectOptions } from "@/lib/queries/projects";
import { listCategories } from "@/lib/queries/categories";
import TaskKanban from "@/app/components/TaskKanban";

export const dynamic = "force-dynamic";

/**
 * Kanban: lista mică (≤ ~1500 de sarcini) vine întreagă în HTML; lista mare vine ca primele 100 (cele mai noi) + totalul, iar restul îl aduce browserul din
 * /api/tasks/dataset (cache pe server, IndexedDB cu ETag, memoria paginii). Filtrele rulează pe toată lista, iar câte carduri se afișează (20 … 1000, Toate) se alege din pagină.
 */
export default async function KanbanPage() {
  const user = await requirePermission("kanban.view");

  // STAFF vede doar task-urile proprii/echipei lui; ADMIN vede tot
  const kanbanScope = canUseAllScope(user) ? "all" : "mine";
  const [result, users, teams, projects, categories] = await Promise.all([
    listTasksForPage({ scope: kanbanScope, userId: user.id, teamIds: user.teamIds, ...taskViewFilter(user) }),
    userOptions(),
    teamOptions(),
    projectOptions(),
    listCategories(),
  ]);

  return (
    <div className="w-full">
      <TaskKanban
        items={result.items}
        dataset={result.dataset ? { total: result.total } : undefined}
        scope={kanbanScope}
        mover={{ id: user.id, teamIds: user.teamIds ?? [], canEdit: can(user, "tasks.edit"), canClose: can(user, "tasks.close") }}
        users={users}
        teams={teams}
        projects={projects}
        categories={categories}
      />
    </div>
  );
}
