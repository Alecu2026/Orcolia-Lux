"use server";

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { after } from "next/server";
import { requireUser, type CurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";
import { notifyUsers, observerRecipients } from "@/lib/services/notifications";
import type { ProjectStatus } from "@prisma/client";

export type ProjectState = { ok?: boolean; error?: string; id?: string } | undefined;

const actor = (u: CurrentUser) => ({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin });

/** Notifică observatorii care au bifat „Proiect creat" (în fundal, fără creator). */
function notifyProjectCreated(projectId: string, name: string, creatorId: string) {
  after(async () => {
    try {
      const ids = (await observerRecipients("project.created")).filter((id) => id !== creatorId);
      if (ids.length) {
        await notifyUsers(ids, { title: `Proiect nou: ${name}`, url: "/projects" }, { telegram: true });
      }
    } catch {
      /* best-effort */
    }
  });
}

const STATUSES: ProjectStatus[] = ["ACTIVE", "ON_HOLD", "DONE", "ARCHIVED"];

function parse(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;
  const clientId = (formData.get("clientId") as string) || null;
  const assigneeId = (formData.get("assigneeId") as string) || null;
  const teamId = (formData.get("teamId") as string) || null;
  const status = STATUSES.includes(formData.get("status") as ProjectStatus)
    ? (formData.get("status") as ProjectStatus)
    : "ACTIVE";
  const address = String(formData.get("address") ?? "").trim() || null;
  const latRaw = parseFloat(String(formData.get("lat") ?? ""));
  const lngRaw = parseFloat(String(formData.get("lng") ?? ""));
  const lat = isNaN(latRaw) ? null : latRaw;
  const lng = isNaN(lngRaw) ? null : lngRaw;
  return { name, description, clientId, assigneeId, teamId, status, address, lat, lng };
}

export async function createProject(
  _prev: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  const user = await requireUser();
  if (!can(user, "projects.create")) return { error: "Fără permisiune." };
  if (DEMO) return { error: "Mod demo." };
  const d = parse(formData);
  if (!d.name) return { error: "Numele e obligatoriu." };
  const counter = await prisma.counter.upsert({
    where: { name: "project-seq" },
    create: { name: "project-seq", value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  const p = await prisma.project.create({
    data: {
      seq: counter.value,
      name: d.name,
      description: d.description,
      status: d.status,
      ownerId: user.id,
      clientId: d.clientId,
      assigneeId: d.assigneeId,
      teamId: d.teamId,
      address: d.address,
      lat: d.lat,
      lng: d.lng,
    },
    select: { id: true },
  });
  await logAudit(actor(user), { action: "project.create", module: "Projects", objectId: p.id, objectName: d.name });
  notifyProjectCreated(p.id, d.name, user.id);
  revalidatePath("/projects");
  updateTag("projects");
  return { ok: true, id: p.id };
}

export type QuickCreateResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: string };

/** Creare rapidă (inline) doar cu numele — pentru dialoguri (task/factură). */
export async function quickCreateProject(name: string): Promise<QuickCreateResult> {
  const user = await requireUser();
  if (!can(user, "projects.create")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo." };
  const n = name.trim();
  if (!n) return { ok: false, error: "Numele e obligatoriu." };
  const counter = await prisma.counter.upsert({
    where: { name: "project-seq" },
    create: { name: "project-seq", value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });
  const p = await prisma.project.create({
    data: { seq: counter.value, name: n, status: "ACTIVE", ownerId: user.id },
    select: { id: true, name: true },
  });
  await logAudit(actor(user), { action: "project.create", module: "Projects", objectId: p.id, objectName: p.name });
  notifyProjectCreated(p.id, p.name, user.id);
  revalidatePath("/projects");
  updateTag("projects");
  return { ok: true, id: p.id, name: p.name };
}

export async function updateProject(
  _prev: ProjectState,
  formData: FormData,
): Promise<ProjectState> {
  const user = await requireUser();
  if (!can(user, "projects.edit")) return { error: "Fără permisiune." };
  if (DEMO) return { error: "Mod demo." };
  const id = String(formData.get("id") ?? "");
  const d = parse(formData);
  if (!d.name) return { error: "Numele e obligatoriu." };
  const before = await prisma.project.findUnique({ where: { id }, select: { name: true, status: true } });
  await prisma.project.update({
    where: { id },
    data: {
      name: d.name,
      description: d.description,
      status: d.status,
      clientId: d.clientId,
      assigneeId: d.assigneeId,
      teamId: d.teamId,
      address: d.address,
      lat: d.lat,
      lng: d.lng,
    },
  });
  await logAudit(actor(user), {
    action: "project.update",
    module: "Projects",
    objectId: id,
    objectName: d.name,
    oldValue: before ? JSON.stringify(before) : null,
    newValue: JSON.stringify({ name: d.name, status: d.status }),
  });
  revalidatePath("/projects");
  updateTag("projects");
  return { ok: true, id };
}

export async function deleteProject(id: string): Promise<void> {
  const user = await requireUser();
  if (!can(user, "projects.delete")) return;
  if (DEMO) return;
  const proj = await prisma.project.findUnique({ where: { id }, select: { name: true } });
  // Detașează task-urile (nu le ștergem)
  await prisma.task.updateMany({ where: { projectId: id }, data: { projectId: null } });
  await prisma.project.delete({ where: { id } }).catch(() => {});
  await logAudit(actor(user), { action: "project.delete", module: "Projects", objectId: id, objectName: proj?.name ?? null });
  revalidatePath("/projects");
  updateTag("projects");
}

/** Atribuie seq secvențial tuturor proiectelor care nu au încă unul. */
export async function backfillProjectSeq(): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { seq: null },
    select: { id: true },
    orderBy: { createdAt: "asc" },
  });
  if (!projects.length) return;

  // Pornește contorul de unde e acum (sau de la 0 dacă nu există)
  const existing = await prisma.counter.findUnique({ where: { name: "project-seq" }, select: { value: true } });
  let next = existing?.value ?? 0;

  for (const p of projects) {
    next += 1;
    await prisma.project.update({ where: { id: p.id }, data: { seq: next } });
  }

  await prisma.counter.upsert({
    where: { name: "project-seq" },
    create: { name: "project-seq", value: next },
    update: { value: next },
  });
}
