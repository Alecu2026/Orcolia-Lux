import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { TaskTemplate, TaskTemplateType } from "../task-template";

type Row = {
  id: string; type: string; name: string; title: string; description: string | null; priority: string;
  categoryId: string | null; projectId: string | null; clientId: string | null; address: string | null; assigneeIds: string[]; teamIds: string[];
  dueDays: number | null; reminderIntervalMinutes: number | null; counter: number;
};

export const toTaskTemplate = (r: Row): TaskTemplate => ({
  id: r.id,
  type: r.type === "TICKET" ? "TICKET" : "TASK",
  name: r.name,
  title: r.title,
  description: r.description ?? "",
  priority: (["LOW", "MEDIUM", "HIGH", "URGENT"].includes(r.priority) ? r.priority : "MEDIUM") as TaskTemplate["priority"],
  categoryId: r.categoryId ?? "",
  projectId: r.projectId ?? "",
  clientId: r.clientId ?? "",
  address: r.address ?? "",
  assigneeIds: r.assigneeIds ?? [],
  teamIds: r.teamIds ?? [],
  dueDays: r.dueDays ?? null,
  reminderIntervalMinutes: r.reminderIntervalMinutes ?? 0,
  counter: r.counter,
});

export const TEMPLATE_SELECT = {
  id: true, type: true, name: true, title: true, description: true, priority: true, categoryId: true, projectId: true, clientId: true, address: true,
  assigneeIds: true, teamIds: true, dueDays: true, reminderIntervalMinutes: true, counter: true,
} as const;

/** Șabloanele unui tip (task-uri sau tichete), în ordine alfabetică. */
export async function listTaskTemplates(type: TaskTemplateType): Promise<TaskTemplate[]> {
  if (DEMO) return [];
  const rows = await prisma.taskTemplate.findMany({ where: { type }, orderBy: { name: "asc" }, take: 300, select: TEMPLATE_SELECT });
  return rows.map(toTaskTemplate);
}
