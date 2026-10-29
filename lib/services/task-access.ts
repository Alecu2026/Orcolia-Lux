import "server-only";
import { prisma } from "../prisma";
import { canViewTask, canWorkOnTask, type PermissionSubject, type TaskVisibilitySubject } from "../permissions";

type Actor = PermissionSubject & TaskVisibilitySubject & { teamIds?: string[] };
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const SELECT = { type: true, projectId: true, creatorId: true, assigneeId: true, extraAssigneeIds: true, teamId: true, extraTeamIds: true } as const;

/** Poate userul lucra pe task (status, progres, fișiere)? „Editare" sau implicat în task, și task-ul îi e vizibil. */
export async function canWorkOnTaskById(user: Actor & { id: string }, id: string): Promise<boolean> {
  return (await workableTask(user, id)) !== null;
}

/** Ca mai sus, dar întoarce tipul task-ului (TASK / TICKET) și proiectul lui când are voie, altfel null — o singură interogare. */
export async function workableTask(user: Actor & { id: string }, id: string): Promise<{ type: string; projectId: string | null } | null> {
  if (!OBJECT_ID.test(id ?? "")) return null;
  const t = await prisma.task.findUnique({ where: { id }, select: SELECT });
  return t && canViewTask(user, t) && canWorkOnTask(user, t) ? { type: t.type, projectId: t.projectId } : null;
}
