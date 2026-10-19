import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { listTasks, taskViewFilter } from "@/lib/queries/tasks";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { getMessages } from "@/lib/i18n";
import { userOptions } from "@/lib/queries/users";
import { teamOptions } from "@/lib/queries/teams";
import { projectOptions } from "@/lib/queries/projects";
import { crmClientOptions } from "@/lib/queries/clients";
import { listCategories } from "@/lib/queries/categories";
import { getQuietHoursSettings } from "@/lib/queries/company";
import { env } from "@/lib/env";
import TasksTable from "@/app/components/TasksTable";

export const dynamic = "force-dynamic";

const SCOPE_KEYS = ["mine", "all", "created"] as const;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; create?: string; project?: string; open?: string; q?: string; proj?: string; status?: string; assignee?: string; prio?: string; due?: string; sg?: string }>;
}) {
  const user = await requirePermission("tasks.view");
  const sp = await searchParams;
  const locale = await getLocaleFromCookie();
  const m = getMessages(locale);
  // STAFF nu poate vedea "all" (task-urile tuturor); poate însă comuta între "mine" și
  // "created" — altfel tab-ul "Creat de mine" e mort pentru el (task creat, dar asignat
  // implicit altcuiva/unui proiect cu asignat propriu, nu mai apare nicăieri pentru STAFF).
  const scope = (
    SCOPE_KEYS.includes(sp.scope as typeof SCOPE_KEYS[number]) && !(user.role === "STAFF" && sp.scope === "all")
      ? sp.scope
      : "mine"
  ) as "mine" | "all" | "created";
  const initialCreate = sp.create === "task" ? "TASK" : undefined;
  const initialProjectId = typeof sp.project === "string" ? sp.project : undefined;
  const initialOpenId = typeof sp.open === "string" && sp.open ? sp.open : undefined;

  // Toate task-urile din „scope" odată; filtrarea/sortarea/paginarea rulează în browser (vezi TasksTable / DataTable).
  const [result, users, teams, projects, clients, categories, quietHoursSettings] = await Promise.all([
    listTasks({
      scope,
      userId: user.id,
      teamIds: user.teamIds,
      ...taskViewFilter(user),
      types: ["TASK"],
      sort: "default",
      page: 1,
      pageSize: 9999,
    }),
    userOptions(),
    teamOptions(),
    projectOptions(),
    crmClientOptions(),
    listCategories(),
    getQuietHoursSettings(),
  ]);

  const SCOPES = [
    { key: "mine", label: m.common.mine },
    { key: "all", label: m.common.all },
    { key: "created", label: m.common.createdByMe },
  ] as const;
  const scopeOptions = SCOPES.filter((s) => (user.role === "STAFF" ? s.key !== "all" : true));

  return (
    <div className="w-full">
      <TasksTable
        items={result.items}
        scope={scope}
        users={users}
        teams={teams}
        projects={projects}
        clients={clients}
        categories={categories}
        canCreate={can(user, "tasks.create")}
        canDelete={can(user, "tasks.delete")}
        canEdit={can(user, "tasks.edit")}
        userId={user.id}
        quietHoursEnabled={quietHoursSettings.quietHoursEnabled}
        blobEnabled={env.blob.enabled}
        canCreateProject={can(user, "projects.create")}
        initialCreate={can(user, "tasks.create") ? initialCreate : undefined}
        initialProjectId={can(user, "tasks.create") ? initialProjectId : undefined}
        initialOpenId={initialOpenId}
        scopeOptions={[...scopeOptions]}
        basePath="/tasks"
        presetValues={{
          q: sp.q,
          proj: sp.proj,
          status: sp.status,
          assignee: sp.assignee,
          prio: sp.prio,
          due: sp.due,
        }}
      />
    </div>
  );
}
