import "server-only";
import { prisma } from "../prisma";
import { canViewTask, canWorkOnTask, type PermissionSubject, type TaskVisibilitySubject } from "../permissions";

type Actor = PermissionSubject & TaskVisibilitySubject & { teamIds?: string[] };
const OBJECT_ID = /^[0-9a-f]{24}$/i;

const SELECT = { creatorId: true, assigneeId: true, extraAssigneeIds: true, teamId: true, extraTeamIds: true } as const;

/** Poate userul lucra pe task (status, progres, fișiere)? „Editare" sau implicat în task, și task-ul îi e vizibil. */
export async function canWorkOnTaskById(user: Actor & { id: string }, id: string): Promise<boolean> {
  if (!OBJECT_ID.test(id ?? "")) return false;
  const t = await prisma.task.findUnique({ where: { id }, select: SELECT });
  return !!t && canViewTask(user, t) && canWorkOnTask(user, t);
}
