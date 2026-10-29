"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can, canViewTask, canViewTaskData } from "@/lib/permissions";
import { canWorkOnTaskById } from "@/lib/services/task-access";
import { deleteStored } from "@/lib/storage";

export type AttachmentRow = {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string | null;
  createdAt: Date;
  userName: string;
};

export type ProjectAttachmentRow = {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string | null;
  createdAt: Date;
  userName: string;
  taskId: string;
  taskTitle: string;
  taskSeq: number | null;
};

export async function getTaskAttachments(taskId: string): Promise<AttachmentRow[]> {
  await requireUser();
  const rows = await prisma.taskAttachment.findMany({
    where: { taskId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      url: true,
      size: true,
      mimeType: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    size: r.size,
    mimeType: r.mimeType,
    createdAt: r.createdAt,
    userName: r.user.name,
  }));
}

export async function deleteTaskAttachment(id: string): Promise<void> {
  const user = await requireUser();

  const attachment = await prisma.taskAttachment.findUnique({
    where: { id },
    select: { url: true, userId: true, taskId: true, name: true },
  });
  if (!attachment) return;

  if (attachment.userId !== user.id && !can(user, "tasks.delete")) {
    throw new Error("Nu ai permisiunea să ștergi acest fișier");
  }

  await deleteStored(attachment.url);
  await prisma.taskAttachment.delete({ where: { id } });

  await prisma.taskActivity.create({
    data: {
      taskId: attachment.taskId,
      userId: user.id,
      action: "ATTACHMENT_DELETED",
      meta: { name: attachment.name },
    },
  }).catch(() => {});
}

export async function getProjectAttachments(projectId: string): Promise<ProjectAttachmentRow[]> {
  const user = await requireUser();
  // Fișierele sunt atașate la task-uri: aceleași condiții ca pentru task-urile proiectului (proiecte + task-uri vizibile).
  if (!can(user, "projects.view") || !canViewTaskData(user) || !/^[0-9a-f]{24}$/i.test(projectId ?? "")) return [];
  const rowsAll = await prisma.taskAttachment.findMany({
    where: { task: { projectId } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      url: true,
      size: true,
      mimeType: true,
      createdAt: true,
      user: { select: { name: true } },
      task: { select: { id: true, title: true, seq: true, creatorId: true, assigneeId: true, extraAssigneeIds: true, teamId: true, extraTeamIds: true } },
    },
  });
  const rows = rowsAll.filter((r) => canViewTask(user, r.task));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    size: r.size,
    mimeType: r.mimeType,
    createdAt: r.createdAt,
    userName: r.user.name,
    taskId: r.task.id,
    taskTitle: r.task.title,
    taskSeq: r.task.seq ?? null,
  }));
}
