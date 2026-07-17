import { notFound } from "next/navigation";
import Link from "next/link";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getTask } from "@/lib/queries/tasks";
import { listTaskComments } from "@/lib/services/tasks";
import { dateKeyOf, formatDate, formatTime } from "@/lib/date";
import { userOptions } from "@/lib/queries/users";
import { teamOptions } from "@/lib/queries/teams";
import { projectOptions } from "@/lib/queries/projects";
import { listCategories } from "@/lib/queries/categories";
import TaskCommentSection from "@/app/components/TaskCommentSection";
import TaskAttachmentSection from "@/app/components/TaskAttachmentSection";
import TaskStatusChanger from "@/app/components/TaskStatusChanger";
import TaskDetailActions from "@/app/components/TaskDetailActions";
import EmailThread from "@/app/components/EmailThread";
import type { TaskStatus } from "@prisma/client";
import CloseTicketButton from "@/app/components/CloseTicketButton";

export const dynamic = "force-dynamic";

const TZ = "Europe/Bucharest";

const ST: Record<string, { label: string; dot: string; badge: string }> = {
  NEW:         { label: "Nou",            dot: "bg-st-new",       badge: "bg-st-new/15 text-st-new" },
  ASSIGNED:    { label: "Asignat",        dot: "bg-st-new",       badge: "bg-st-new/15 text-st-new" },
  READ:        { label: "Citit",          dot: "bg-st-confirmed", badge: "bg-st-confirmed/15 text-st-confirmed" },
  IN_PROGRESS: { label: "În lucru",       dot: "bg-st-progress",  badge: "bg-st-progress/15 text-st-progress" },
  ON_HOLD:     { label: "În așteptare",   dot: "bg-st-noshow",    badge: "bg-st-noshow/15 text-st-noshow" },
  REVIEW:      { label: "În verificare",  dot: "bg-st-confirmed", badge: "bg-st-confirmed/15 text-st-confirmed" },
  DONE:        { label: "Finalizat",      dot: "bg-st-done",      badge: "bg-st-done/15 text-st-done" },
  CANCELLED:   { label: "Anulat",         dot: "bg-st-cancelled", badge: "bg-st-cancelled/15 text-st-cancelled" },
};
const PRIO_RO: Record<string, string> = { LOW: "Scăzută", MEDIUM: "Medie", HIGH: "Ridicată", URGENT: "Urgentă" };
const TYPE_RO: Record<string, string>  = { TASK: "Task", TICKET: "Tichet" };

function fmtDateTime(d: Date | string) {
  const date = new Date(d);
  return `${formatDate(date, TZ)}, ${formatTime(date, TZ)}`;
}

function fmtDue(d: Date | string): string {
  const date = new Date(d);
  const key = dateKeyOf(date, TZ);
  const time = formatTime(date, TZ);
  const datePart = new Date(key + "T12:00:00Z").toLocaleDateString("ro-RO");
  return time === "00:00" ? datePart : `${datePart}, ${time}`;
}

function fmtDuration(ms: number): string {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "< 1 min";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ${mins % 60}min`;
  const days = Math.floor(hours / 24);
  const rh = hours % 24;
  return rh > 0 ? `${days}z ${rh}h` : `${days}z`;
}

type ActivityMeta = {
  changes?: { field: string; from: string | null; to: string | null }[];
  body?: string;
  fileName?: string;
  size?: number;
};

function parseMeta(m: unknown): ActivityMeta {
  if (!m || typeof m !== "object") return {};
  return m as ActivityMeta;
}

const FIELD_ICON: Record<string, string> = {
  "Titlu": "✏️",
  "Descriere": "📝",
  "Prioritate": "⚡",
  "Deadline": "📅",
  "Asignat": "👤",
  "Echipă": "👥",
  "Proiect": "📁",
};

export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("tasks.view");
  const { id } = await params;

  const { env } = await import("@/lib/env");

  const [task, comments, users, teams, projects, categories] = await Promise.all([
    getTask(id),
    listTaskComments(id),
    userOptions(),
    teamOptions(),
    projectOptions(),
    listCategories(),
  ]);

  if (!task) notFound();

  const canDelete = can(user, "tasks.delete");
  const canEdit = can(user, "tasks.edit");

  const attachments = (task.attachments ?? []).map((a) => ({
    id: a.id,
    name: a.name,
    url: a.url,
    size: a.size,
    mimeType: a.mimeType,
    createdAt: a.createdAt,
    userName: a.user.name,
    userId: a.user.id,
  }));

  const commentRows = comments.map((c) => ({
    id: c.id,
    body: c.body,
    source: c.source,
    createdAt: c.createdAt,
    user: c.user ?? null,
  }));

  // Build unified timeline: synthetic creation + all TaskActivity records (chronological)
  const activities = [...(task.activities ?? [])].reverse();

  const isOverdue =
    task.dueAt &&
    new Date(task.dueAt) < new Date() &&
    task.status !== "DONE" &&
    task.status !== "CANCELLED";

  const overdueMs = isOverdue ? Date.now() - new Date(task.dueAt!).getTime() : 0;

  type TimelineEvent = {
    key: string;
    at: Date;
    dot: string;
    action: string;
    userName: string;
    // for STATUS_CHANGED
    fromStatus?: TaskStatus | null;
    toStatus?: TaskStatus | null;
    note?: string | null;
    // for EDITED
    changes?: { field: string; from: string | null; to: string | null }[];
    // for COMMENTED
    commentBody?: string;
    // for ATTACHMENT_*
    fileName?: string;
    // duration since previous event (filled in below)
    durationMs?: number;
  };

  const timeline: TimelineEvent[] = [
    {
      key: "created",
      at: task.createdAt,
      dot: "bg-st-new",
      action: "CREATED",
      userName: task.creator.name,
    },
  ];

  for (const a of activities) {
    const action = a.action ?? "STATUS_CHANGED";
    const meta = parseMeta(a.meta);
    const base = {
      key: a.id,
      at: a.createdAt,
      userName: a.user?.name ?? "—",
      action,
    };
    if (action === "STATUS_CHANGED" || !a.action) {
      if (!a.toStatus) continue; // skip malformed old records without toStatus
      timeline.push({
        ...base,
        dot: ST[a.toStatus]?.dot ?? "bg-brand",
        fromStatus: a.fromStatus,
        toStatus: a.toStatus,
        note: a.note,
      });
    } else if (action === "EDITED") {
      timeline.push({
        ...base,
        dot: "bg-brand/60",
        changes: meta.changes ?? [],
      });
    } else if (action === "COMMENTED") {
      timeline.push({
        ...base,
        dot: "bg-st-confirmed",
        commentBody: meta.body,
      });
    } else if (action === "ATTACHMENT_ADDED") {
      timeline.push({
        ...base,
        dot: "bg-st-progress",
        fileName: meta.fileName,
      });
    } else if (action === "ATTACHMENT_DELETED") {
      timeline.push({
        ...base,
        dot: "bg-st-cancelled",
        fileName: meta.fileName,
      });
    } else {
      timeline.push({ ...base, dot: "bg-brand" });
    }
  }

  // Add duration between consecutive events
  for (let i = 1; i < timeline.length; i++) {
    timeline[i].durationMs =
      new Date(timeline[i].at).getTime() - new Date(timeline[i - 1].at).getTime();
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-4 flex items-center justify-between gap-2">
        <Link
          href={task.type === "TICKET" ? "/tickets" : "/tasks"}
          className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink"
        >
          {task.type === "TICKET" ? "← Înapoi la tichete" : "← Înapoi la task-uri"}
        </Link>
        <TaskDetailActions
          task={{
            id: task.id,
            seq: task.seq ?? null,
            title: task.title,
            description: task.description ?? null,
            priority: task.priority,
            dueAt: task.dueAt ? task.dueAt.toISOString() : null,
            reminderIntervalMinutes: task.reminderIntervalMinutes ?? null,
            assigneeId: task.assigneeId ?? null,
            teamId: task.teamId ?? null,
            extraAssigneeIds: (task.extraAssigneeIds ?? []) as string[],
            extraTeamIds: (task.extraTeamIds ?? []) as string[],
            assignmentSettingsJson: (task.assignmentSettingsJson ?? null) as string | null,
            projectId: task.projectId ?? null,
            categoryId: task.categoryId ?? null,
          }}
          users={users}
          teams={teams}
          projects={projects}
          categories={categories}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      </div>

      {/* ── Header ────────────────────────────────────────── */}
      <div className="card mb-3 p-4">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {task.seq != null && (
            <span className="rounded bg-brand/10 px-2 py-0.5 font-mono text-sm font-bold text-brand">
              #{task.seq}
            </span>
          )}
          <span className="rounded bg-[var(--color-surface-2)] px-2 py-0.5 text-[11px] text-ink-soft">
            {TYPE_RO[task.type] ?? task.type}
          </span>
          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${ST[task.status]?.badge ?? ""}`}>
            {ST[task.status]?.label ?? task.status}
          </span>
          {isOverdue && (
            <span className="rounded bg-st-cancelled/15 px-2 py-0.5 text-[11px] font-semibold text-st-cancelled">
              ⏰ Întârziere {fmtDuration(overdueMs)}
            </span>
          )}
        </div>

        <h1 className="mb-3 break-words text-xl font-bold leading-tight">{task.title}</h1>

        {task.description && (
          <p className="mb-3 whitespace-pre-wrap rounded-xl bg-[var(--color-surface-2)] px-3 py-2.5 text-sm">
            {task.description}
          </p>
        )}

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
          <MetaRow label="Prioritate" value={PRIO_RO[task.priority] ?? task.priority} />
          {task.assignee?.name && (
            <MetaRow
              label="Asignat"
              value={[task.assignee.name, ...(task.extraAssigneeIds ?? []).map((uid) => users.find((u) => u.id === uid)?.name).filter(Boolean)].join(", ")}
            />
          )}
          {task.team?.name && (
            <MetaRow
              label="Echipă"
              value={[task.team.name, ...(task.extraTeamIds ?? []).map((tid) => teams.find((t) => t.id === tid)?.name).filter(Boolean)].join(", ")}
            />
          )}
          {task.project?.name && <MetaRow label="Proiect" value={task.project.name} />}
          {task.project?.client?.name && <MetaRow label="Client" value={task.project.client.name} />}
          {(task.project as { lat?: number | null; lng?: number | null; address?: string | null } | null)?.lat != null && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">Locație</p>
              <a
                href={`https://maps.google.com/maps?q=${(task.project as { lat: number; lng: number }).lat},${(task.project as { lat: number; lng: number }).lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
              >
                📍 {(task.project as { address?: string | null }).address || "Vezi pe hartă"}
              </a>
            </div>
          )}
          {!(task.project as { lat?: number | null } | null)?.lat && (task.project as { address?: string | null } | null)?.address && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">Locație</p>
              <a
                href={`https://maps.google.com/maps?q=${encodeURIComponent((task.project as { address: string }).address)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
              >
                📍 {(task.project as { address: string }).address}
              </a>
            </div>
          )}
          {task.progress > 0 && <MetaRow label="Progres" value={`${task.progress}%`} />}
          {task.dueAt && (
            <MetaRow label="Scadent" value={fmtDue(task.dueAt)} alert={!!isOverdue} />
          )}
          <MetaRow label="Creat" value={fmtDateTime(task.createdAt)} />
          <MetaRow label="Creat de" value={task.creator.name} />
        </div>

        <div className="mt-4 border-t border-[var(--color-line)] pt-4 flex flex-col gap-3">
          <TaskStatusChanger taskId={id} initialStatus={task.status} />
          {task.type === "TICKET" && task.status !== "DONE" && task.status !== "CANCELLED" && canEdit && (
            <div className="flex justify-end">
              <CloseTicketButton taskId={id} />
            </div>
          )}
        </div>
      </div>

      {/* ── Attachments ───────────────────────────────────── */}
      <div className="mb-3">
        <TaskAttachmentSection
          taskId={id}
          initialAttachments={attachments}
          currentUserId={user.id}
          canDelete={canDelete}
          blobEnabled={env.blob.enabled}
        />
      </div>

      {/* ── Email thread (only for email-sourced tickets) ─── */}
      {task.emailSource && task.fromEmail && (
        <EmailThread
          taskId={id}
          messages={(task.emailMessages ?? []).map((m) => ({
            ...m,
            sentAt: m.sentAt.toISOString(),
          }))}
          fromEmail={task.fromEmail}
          fromName={task.fromName ?? null}
          canReply={canEdit}
        />
      )}

      {/* ── Comments ──────────────────────────────────────── */}
      <div className="mb-3">
        <TaskCommentSection taskId={id} initialComments={commentRows} />
      </div>

      {/* ── Timeline / Istoric ────────────────────────────── */}
      <div className="card mb-3 p-4">
        <h2 className="mb-4 text-sm font-bold">📋 Istoric complet</h2>
        <ol className="flex flex-col">
          {timeline.map((ev, i) => {
            const isLast = i === timeline.length - 1;
            return (
              <li key={ev.key} className="flex gap-3">
                {/* Dot + connector line */}
                <div className="flex flex-col items-center pt-1">
                  <span className={`size-2.5 shrink-0 rounded-full ${ev.dot}`} />
                  {!isLast && <span className="my-1.5 w-0.5 flex-1 bg-[var(--color-line)]" />}
                </div>

                {/* Event body */}
                <div className={`min-w-0 flex-1 ${!isLast ? "pb-5" : ""}`}>
                  {ev.action === "CREATED" && (
                    <>
                      <p className="text-sm font-semibold">🆕 Creat</p>
                      <p className="text-[11px] text-ink-soft">{ev.userName} · {fmtDateTime(ev.at)}</p>
                    </>
                  )}

                  {(ev.action === "STATUS_CHANGED" || !ev.action) && ev.toStatus && (
                    <>
                      <p className="text-sm font-semibold">
                        🔄{" "}
                        {ev.fromStatus
                          ? <>{ST[ev.fromStatus]?.label ?? ev.fromStatus} → <span className="text-ink">{ST[ev.toStatus]?.label ?? ev.toStatus}</span></>
                          : ST[ev.toStatus]?.label ?? ev.toStatus}
                      </p>
                      <p className="text-[11px] text-ink-soft">{ev.userName} · {fmtDateTime(ev.at)}</p>
                      {ev.note && <p className="mt-0.5 text-[11px] italic text-ink-soft">{ev.note}</p>}
                    </>
                  )}

                  {ev.action === "EDITED" && (
                    <>
                      <p className="text-sm font-semibold">✏️ Editat</p>
                      <p className="text-[11px] text-ink-soft">{ev.userName} · {fmtDateTime(ev.at)}</p>
                      {ev.changes && ev.changes.length > 0 && (
                        <ul className="mt-1.5 flex flex-col gap-1">
                          {ev.changes.map((c, ci) => (
                            <li key={ci} className="text-[11px]">
                              <span className="mr-1">{FIELD_ICON[c.field] ?? "•"}</span>
                              <span className="font-medium">{c.field}:</span>{" "}
                              {c.from != null
                                ? <><span className="text-ink-soft line-through">{c.from}</span> → </>
                                : <span className="text-ink-soft">— → </span>}
                              {c.to != null
                                ? <span className="font-medium">{c.to}</span>
                                : <span className="text-ink-soft italic">șters</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}

                  {ev.action === "COMMENTED" && (
                    <>
                      <p className="text-sm font-semibold">💬 Comentariu adăugat</p>
                      <p className="text-[11px] text-ink-soft">{ev.userName} · {fmtDateTime(ev.at)}</p>
                      {ev.commentBody && (
                        <p className="mt-1 truncate text-[11px] italic text-ink-soft">«{ev.commentBody}»</p>
                      )}
                    </>
                  )}

                  {ev.action === "ATTACHMENT_ADDED" && (
                    <>
                      <p className="text-sm font-semibold">📎 Atașament adăugat</p>
                      <p className="text-[11px] text-ink-soft">{ev.userName} · {fmtDateTime(ev.at)}</p>
                      {ev.fileName && <p className="mt-0.5 text-[11px] text-ink-soft">{ev.fileName}</p>}
                    </>
                  )}

                  {ev.action === "ATTACHMENT_DELETED" && (
                    <>
                      <p className="text-sm font-semibold text-st-cancelled">🗑 Atașament șters</p>
                      <p className="text-[11px] text-ink-soft">{ev.userName} · {fmtDateTime(ev.at)}</p>
                      {ev.fileName && <p className="mt-0.5 text-[11px] text-ink-soft">{ev.fileName}</p>}
                    </>
                  )}

                  {ev.durationMs !== undefined && ev.durationMs > 0 && (
                    <p className="mt-0.5 text-[10px] text-ink-soft/60">
                      ⏱ {fmtDuration(ev.durationMs)} de la evenimentul anterior
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {/* Total duration */}
        {timeline.length > 1 && (
          <div className="mt-3 border-t border-[var(--color-line)] pt-3 text-[11px] text-ink-soft">
            Durată totală de la creare:{" "}
            <span className="font-semibold text-ink">
              {fmtDuration(
                new Date(timeline[timeline.length - 1].at).getTime() -
                  new Date(timeline[0].at).getTime(),
              )}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function MetaRow({
  label,
  value,
  alert = false,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{label}</p>
      <p className={`break-all text-sm font-medium ${alert ? "text-st-cancelled" : ""}`}>{value}</p>
    </div>
  );
}
