import { requirePermission } from "@/lib/dal";
import { can, canUseAllScope } from "@/lib/permissions";
import { listTasksForPage, taskViewFilter } from "@/lib/queries/tasks";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { getMessages } from "@/lib/i18n";
import { userOptions } from "@/lib/queries/users";
import { teamOptions } from "@/lib/queries/teams";
import { projectOptions } from "@/lib/queries/projects";
import { crmClientOptionsPlus } from "@/lib/queries/clients";
import { listCategories } from "@/lib/queries/categories";
import { listTaskTemplates } from "@/lib/queries/task-templates";
import { getQuietHoursSettings } from "@/lib/queries/company";
import { env } from "@/lib/env";
import { payerAddress } from "@/lib/queries/payer-address";
import TasksTable from "@/app/components/TasksTable";

export const dynamic = "force-dynamic";

const SCOPE_KEYS = ["mine", "all", "created"] as const;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; create?: string; project?: string; open?: string; q?: string; proj?: string; status?: string; assignee?: string; prio?: string; due?: string; sg?: string; client?: string; title?: string; desc?: string; template?: string; phone?: string; at?: string }>;
}) {
  const user = await requirePermission("tasks.view");
  const sp = await searchParams;
  const locale = await getLocaleFromCookie();
  const m = getMessages(locale);
  // STAFF nu poate vedea "all" (task-urile tuturor); poate însă comuta între "mine" și
  // "created" — altfel tab-ul "Creat de mine" e mort pentru el (task creat, dar asignat
  // implicit altcuiva/unui proiect cu asignat propriu, nu mai apare nicăieri pentru STAFF).
  const scope = (
    SCOPE_KEYS.includes(sp.scope as typeof SCOPE_KEYS[number]) && !(sp.scope === "all" && !canUseAllScope(user))
      ? sp.scope
      : "mine"
  ) as "mine" | "all" | "created";
  const initialCreate = sp.create === "task" ? "TASK" : undefined;
  const initialProjectId = typeof sp.project === "string" ? sp.project : undefined;
  const initialOpenId = typeof sp.open === "string" && sp.open ? sp.open : undefined;

  // Toate task-urile din „scope" odată; filtrarea/sortarea/paginarea rulează în browser (vezi TasksTable / DataTable).
  const [result, users, teams, projects, clients, categories, quietHoursSettings, templates] = await Promise.all([
    listTasksForPage(
      {
        scope,
        userId: user.id,
        teamIds: user.teamIds,
        ...taskViewFilter(user),
        types: ["TASK"],
      },
      initialOpenId,
    ),
    userOptions(),
    teamOptions(),
    projectOptions(),
    crmClientOptionsPlus(sp.client && /^[0-9a-f]{24}$/i.test(sp.client) ? sp.client : null), // + clientul din apel (plătitorii nu sunt în lista CRM)
    listCategories(),
    getQuietHoursSettings(),
    listTaskTemplates("TASK"),
  ]);

  const SCOPES = [
    { key: "mine", label: m.common.mine },
    { key: "all", label: m.common.all },
    { key: "created", label: m.common.createdByMe },
  ] as const;
  const scopeOptions = SCOPES.filter((s) => (canUseAllScope(user) ? true : s.key !== "all"));

  // „+” din PBX / popup-ul de apel: adresa plătitorului se completează singură (o singură citire, doar când se deschide fereastra de creare).
  const initialAddress = initialCreate && can(user, "tasks.create") ? await payerAddress(sp.client) : undefined;

  return (
    <div className="w-full">
      <TasksTable
        items={result.items}
        dataset={result.dataset ? { total: result.total } : undefined}
        templates={templates}
        canAssign={can(user, "tasks.assign")}
        canClose={can(user, "tasks.close")}
        scope={scope}
        users={users}
        teams={teams}
        projects={projects}
        clients={clients}
        categories={categories}
        canCreate={can(user, "tasks.create")}
        canExport={can(user, "tasks.export")}
        canImport={can(user, "tasks.import")}
        canDelete={can(user, "tasks.delete")}
        canEdit={can(user, "tasks.edit")}
        userId={user.id}
        userTeamIds={user.teamIds}
        quietHoursEnabled={quietHoursSettings.quietHoursEnabled}
        uploadsEnabled={env.storage.enabled}
        canCreateProject={can(user, "projects.create")}
        initialCreate={can(user, "tasks.create") ? initialCreate : undefined}
        initialProjectId={can(user, "tasks.create") ? initialProjectId : undefined}
        initialClientId={sp.client && /^[0-9a-f]{24}$/i.test(sp.client) ? sp.client : undefined}
        initialTitle={sp.title?.slice(0, 200)}
        initialAddress={initialAddress}
        initialDescription={sp.desc?.slice(0, 1000)}
        initialTemplateId={can(user, "tasks.create") && sp.template && /^[0-9a-f]{24}$/i.test(sp.template) ? sp.template : undefined}
        initialCallPhone={sp.phone?.replace(/[^\d+]/g, "").slice(0, 20)}
        initialCallAt={sp.at && !Number.isNaN(Date.parse(sp.at)) ? sp.at : undefined}
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
