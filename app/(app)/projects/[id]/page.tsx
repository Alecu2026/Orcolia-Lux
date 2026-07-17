import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getProject } from "@/lib/queries/projects";
import { listTasks } from "@/lib/queries/tasks";
import { userOptions } from "@/lib/queries/users";
import { teamOptions } from "@/lib/queries/teams";
import { invoiceClientOptions } from "@/lib/queries/invoices";
import ProjectMap from "@/app/components/ProjectMapDynamic";
import ProjectDetailHeader from "@/app/components/ProjectDetailHeader";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { getMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const TASK_STATUS_DOT: Record<string, string> = {
  NEW: "bg-st-new", ASSIGNED: "bg-st-new", READ: "bg-st-confirmed",
  IN_PROGRESS: "bg-st-progress", ON_HOLD: "bg-st-noshow",
  REVIEW: "bg-st-confirmed", DONE: "bg-st-done", CANCELLED: "bg-st-cancelled",
};

const PRIO_CLS: Record<string, string> = {
  URGENT: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400",
  HIGH:   "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400",
  MEDIUM: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400",
  LOW:    "bg-[var(--color-surface-2)] text-ink-soft",
};

function fmtDue(d: Date) {
  return d.toLocaleDateString("ro-RO", { day: "numeric", month: "short" });
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("projects.view");
  const { id } = await params;
  const canEdit = can(user, "projects.edit");

  const [project, users, teams, clients, tasksResult, locale] = await Promise.all([
    getProject(id),
    userOptions(),
    teamOptions(),
    invoiceClientOptions(),
    listTasks({
      scope: "all",
      userId: user.id,
      teamIds: user.teamIds,
      projectId: id,
      pageSize: 200,
      page: 1,
    }),
    getLocaleFromCookie(),
  ]);
  const m = getMessages(locale);

  if (!project) notFound();

  const assignee = users.find((u) => u.id === project.assigneeId);
  const team = teams.find((t) => t.id === project.teamId);
  const client = clients.find((c) => c.id === project.clientId);
  const hasLocation = project.lat != null && project.lng != null;

  const tasks = tasksResult.items;
  const activeTasks = tasks.filter((t) => t.status !== "DONE" && t.status !== "CANCELLED");
  const doneTasks = tasks.filter((t) => t.status === "DONE" || t.status === "CANCELLED");

  return (
    <div className="mx-auto w-full max-w-2xl">
      <Link
        href="/projects"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink"
      >
        ← {m.nav.projects}
      </Link>

      {/* ── Info proiect ── */}
      <div className="card mb-4 p-5">
        <ProjectDetailHeader
          project={project}
          users={users}
          teams={teams}
          clients={clients}
          canEdit={canEdit}
        />

        {project.description && (
          <p className="mb-3 text-sm text-ink-soft">{project.description}</p>
        )}

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-soft">
          {client && <span>{m.projects.clientLabel2}: <span className="font-medium text-ink">{client.name}</span></span>}
          {assignee && <span>{m.projects.responsibleLabel}: <span className="font-medium text-ink">{assignee.name}</span></span>}
          {team && <span>{m.projects.teamLabel}: <span className="font-medium text-ink">{team.name}</span></span>}
        </div>
      </div>

      {/* ── Hartă ── */}
      {hasLocation && (
        <div className="card mb-4 p-5">
          <h2 className="mb-3 text-sm font-semibold">{m.projects.locationHeading}</h2>
          {project.address && (
            <p className="mb-2 text-sm text-ink-soft">{project.address}</p>
          )}
          <ProjectMap lat={project.lat!} lng={project.lng!} address={project.address} />
        </div>
      )}

      {/* ── Task-uri ── */}
      <div className="card mb-4 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold">
            {m.nav.tasks}
            {tasks.length > 0 && (
              <span className="ml-1.5 rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs font-semibold text-ink-soft">
                {tasks.length}
              </span>
            )}
          </h2>
          <Link
            href={`/tasks?create=task&project=${id}`}
            className="tap inline-flex h-8 items-center gap-1 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong"
          >
            {m.tasks.newButton}
          </Link>
        </div>

        {tasks.length === 0 ? (
          <p className="py-4 text-center text-sm text-ink-soft">
            {m.projects.noTasksInProject}
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {activeTasks.map((t) => {
              const dot = TASK_STATUS_DOT[t.status] ?? "bg-brand";
              const prioCls = PRIO_CLS[t.priority];
              const prioLabel = m.priority[t.priority as keyof typeof m.priority];
              const due = t.dueAt ? new Date(t.dueAt) : null;
              const overdue = due && due < new Date();
              return (
                <Link
                  key={t.id}
                  href={`/tasks/${t.id}`}
                  className="tap flex items-center gap-2.5 rounded-xl px-2.5 py-2 hover:bg-[var(--color-surface-2)]"
                >
                  <span className={`size-2 shrink-0 rounded-full ${dot}`} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                  {prioLabel && t.priority !== "LOW" && (
                    <span className={`hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold sm:inline ${prioCls}`}>
                      {prioLabel}
                    </span>
                  )}
                  {t.assigneeName && (
                    <span className="hidden shrink-0 text-[11px] text-ink-soft sm:inline">{t.assigneeName}</span>
                  )}
                  {due && (
                    <span className={`shrink-0 text-[11px] font-mono ${overdue ? "text-st-cancelled font-semibold" : "text-ink-soft"}`}>
                      {fmtDue(due)}
                    </span>
                  )}
                  <span className="hidden shrink-0 text-[11px] text-ink-soft sm:inline">
                    {m.status[t.status as keyof typeof m.status]}
                  </span>
                </Link>
              );
            })}

            {doneTasks.length > 0 && (
              <>
                <p className="mt-2 px-2.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                  {m.projects.doneAndCancelled} ({doneTasks.length})
                </p>
                {doneTasks.map((t) => {
                  const dot = TASK_STATUS_DOT[t.status] ?? "bg-brand";
                  return (
                    <Link
                      key={t.id}
                      href={`/tasks/${t.id}`}
                      className="tap flex items-center gap-2.5 rounded-xl px-2.5 py-2 opacity-50 hover:bg-[var(--color-surface-2)] hover:opacity-100"
                    >
                      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
                      <span className="min-w-0 flex-1 truncate text-sm line-through">{t.title}</span>
                      <span className="shrink-0 text-[11px] text-ink-soft">{m.status[t.status as keyof typeof m.status]}</span>
                    </Link>
                  );
                })}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
