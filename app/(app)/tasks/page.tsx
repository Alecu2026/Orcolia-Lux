import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { listTasks } from "@/lib/queries/tasks";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { getMessages } from "@/lib/i18n";
import { userOptions } from "@/lib/queries/users";
import { teamOptions } from "@/lib/queries/teams";
import { projectOptions } from "@/lib/queries/projects";
import { invoiceClientOptions } from "@/lib/queries/invoices";
import { listCategories } from "@/lib/queries/categories";
import { getQuietHoursSettings } from "@/lib/queries/company";
import { env } from "@/lib/env";
import TasksManager from "@/app/components/TasksManager";
import type { TaskStatus, TaskType, TaskPriority } from "@prisma/client";

export const dynamic = "force-dynamic";

const SCOPE_KEYS = ["mine", "all", "created"] as const;

const STATUS_SET = new Set(["NEW", "ASSIGNED", "READ", "IN_PROGRESS", "ON_HOLD", "REVIEW", "DONE", "CANCELLED"]);
const TYPE_SET = new Set(["TASK", "TICKET"]);
const PRIO_SET = new Set(["LOW", "MEDIUM", "HIGH", "URGENT"]);

function pick<T extends string>(v: string | undefined, set: Set<string>): T | undefined {
  return v && set.has(v) ? (v as T) : undefined;
}

const DUE_RANGES = new Set(["overdue", "today", "tomorrow", "week", "month"]);
const SORTS = new Set(["dueAsc", "dueDesc"]);

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{
    scope?: string; page?: string; create?: string; project?: string;
    q?: string; status?: string; type?: string; assignee?: string;
    team?: string; proj?: string; client?: string; prio?: string;
    due?: string; sort?: string; open?: string; category?: string; ps?: string;
  }>;
}) {
  const user = await requirePermission("tasks.view");
  const sp = await searchParams;
  const locale = await getLocaleFromCookie();
  const m = getMessages(locale);
  // STAFF vede mereu doar propriile task-uri; ADMIN poate comuta scope din URL
  const scope = (
    user.role === "STAFF"
      ? "mine"
      : SCOPE_KEYS.includes(sp.scope as typeof SCOPE_KEYS[number]) ? sp.scope : "mine"
  ) as "mine" | "all" | "created";
  const page = Math.max(1, Number(sp.page) || 1);
  const pageSize = sp.ps === "all" ? 9999 : Math.min(9999, Math.max(1, Number(sp.ps) || 20));
  const initialCreate =
    sp.create === "task" ? "TASK" : undefined;
  const initialProjectId = typeof sp.project === "string" ? sp.project : undefined;
  const initialOpenId = typeof sp.open === "string" && sp.open ? sp.open : undefined;

  const dueRange = DUE_RANGES.has(sp.due ?? "")
    ? (sp.due as "overdue" | "today" | "tomorrow" | "week" | "month")
    : undefined;
  const sort = SORTS.has(sp.sort ?? "") ? (sp.sort as "dueAsc" | "dueDesc") : "default";

  const [result, users, teams, projects, clients, categories, quietHoursSettings] = await Promise.all([
    listTasks({
      scope,
      userId: user.id,
      teamIds: user.teamIds,
      types: ["TASK"],
      status: pick<TaskStatus>(sp.status, STATUS_SET),
      priority: pick<TaskPriority>(sp.prio, PRIO_SET),
      assigneeId: sp.assignee || undefined,
      teamId: sp.team || undefined,
      projectId: sp.proj || undefined,
      clientId: sp.client || undefined,
      categoryId: sp.category || undefined,
      dueRange,
      sort,
      search: sp.q || undefined,
      page,
      pageSize,
    }),
    userOptions(),
    teamOptions(),
    projectOptions(),
    invoiceClientOptions(),
    listCategories(),
    getQuietHoursSettings(),
  ]);

  const SCOPES = [
    { key: "mine", label: m.common.mine },
    { key: "all", label: m.common.all },
    { key: "created", label: m.common.createdByMe },
  ] as const;
  const scopeOptions = SCOPES.filter((s) => user.role === "STAFF" ? s.key !== "all" : true);

  return (
    <div className="w-full">
      <TasksManager
        items={result.items}
        hasMore={result.hasMore}
        page={result.page}
        totalPages={result.totalPages}
        scope={scope}
        users={users}
        teams={teams}
        projects={projects}
        clients={clients}
        categories={categories}
        filters={{
          q: sp.q ?? "",
          status: sp.status ?? "",
          type: sp.type ?? "",
          assignee: sp.assignee ?? "",
          team: sp.team ?? "",
          proj: sp.proj ?? "",
          client: sp.client ?? "",
          prio: sp.prio ?? "",
          due: sp.due ?? "",
          sort: sp.sort ?? "",
          category: sp.category ?? "",
          ps: sp.ps ?? "",
        }}
        canCreate={can(user, "tasks.create")}
        canDelete={can(user, "tasks.delete")}
        canEdit={can(user, "tasks.edit")}
        quietHoursEnabled={quietHoursSettings.quietHoursEnabled}
        blobEnabled={env.blob.enabled}
        canCreateProject={can(user, "projects.create")}
        initialCreate={can(user, "tasks.create") ? initialCreate : undefined}
        initialProjectId={can(user, "tasks.create") ? initialProjectId : undefined}
        initialOpenId={initialOpenId}
        scopeOptions={scopeOptions}
        basePath="/tasks"
        createButtons={can(user, "tasks.create") ? [
          { label: m.tasks.newButton, type: "TASK" },
        ] : []}
      />
    </div>
  );
}
