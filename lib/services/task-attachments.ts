import "server-only";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import { canViewTaskData } from "@/lib/permissions";
import { workableTask } from "@/lib/services/task-access";
import { taskFileFolder } from "@/lib/services/file-folders";
import { notifyAttachmentTelegram } from "@/lib/services/tasks";
import { toWebp } from "@/lib/services/image-webp";
import { storePublic } from "@/lib/storage";
import type { CurrentUser } from "@/lib/dal";

export const MAX_ATTACHMENT = 20 * 1024 * 1024;

const ALLOWED = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif", "application/pdf",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip", "text/plain", "text/csv",
]);

export type TaskAttachmentRow = {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string | null;
  createdAt: Date;
  userName: string;
  userId: string;
};

export type AddAttachmentResult = { ok: true; attachment: TaskAttachmentRow } | { ok: false; error: string; status: number };

/**
 * Atașează un fișier la un task: verifică dreptul, salvează pe discul serverului (pozele ca WebP, mai mici), scrie rândul în baza de date,
 * notează în istoric și anunță pe Telegram. Folosit de ruta de încărcare (/api/upload/task-attachment).
 */
export async function addTaskAttachment(user: CurrentUser, taskId: string, picked: File): Promise<AddAttachmentResult> {
  const task = canViewTaskData(user) ? await workableTask(user, taskId) : null;
  if (!task) return { ok: false, error: "Nu ai permisiunea.", status: 403 };
  if (DEMO) return { ok: false, error: "Mod demo.", status: 400 };
  if (!picked || !picked.size) return { ok: false, error: "Niciun fișier selectat.", status: 400 };
  if (picked.size > MAX_ATTACHMENT) return { ok: false, error: "Fișierul depășește 20 MB.", status: 413 };
  if (picked.type && !ALLOWED.has(picked.type)) return { ok: false, error: "Tip de fișier neacceptat.", status: 415 };

  // pozele se salvează ca WebP (mai puțin spațiu); celelalte fișiere rămân neschimbate
  const file = await toWebp(picked);
  let stored: { url: string; size: number };
  try {
    // sarcinile și cererile au foldere separate, câte un subfolder pe proiect; folderul se creează la prima încărcare
    stored = await storePublic(await taskFileFolder(task.type, task.projectId), file, file.name);
  } catch (e) {
    console.error("[task-attachments] salvarea pe disc a eșuat:", e);
    return { ok: false, error: "Fișierul nu a putut fi salvat pe server.", status: 500 };
  }

  const att = await prisma.taskAttachment.create({
    data: { taskId, userId: user.id, name: file.name, url: stored.url, size: stored.size, mimeType: file.type || null },
    select: { id: true, name: true, url: true, size: true, mimeType: true, createdAt: true, user: { select: { id: true, name: true } } },
  });
  await prisma.taskActivity
    .create({ data: { taskId, userId: user.id, action: "ATTACHMENT_ADDED", meta: { fileName: file.name, size: stored.size } } })
    .catch(() => {});

  after(() => notifyAttachmentTelegram(taskId, stored.url, file.name, file.type || null));

  return { ok: true, attachment: { id: att.id, name: att.name, url: att.url, size: att.size, mimeType: att.mimeType, createdAt: att.createdAt, userName: att.user.name, userId: att.user.id } };
}
