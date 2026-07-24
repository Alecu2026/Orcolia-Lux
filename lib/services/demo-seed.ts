import "server-only";
import { prisma } from "../prisma";
import { createTask } from "./tasks";
import { createInvoice } from "./invoices";

/**
 * Populează contul nou (bootstrap) cu date demonstrative — câte un exemplu pentru
 * fiecare secțiune principală (client, proiect, task, factură) — ca ecranele să
 * nu fie goale la prima utilizare și userul să vadă cum arată fiecare.
 */
export async function seedDemoData(userId: string): Promise<void> {
  const client = await prisma.client.create({
    data: {
      userId,
      name: "Client Demo SRL",
      phone: "+373 69 000 000",
      email: "client-demo@example.com",
      notes: "Acesta este un client de exemplu — poate fi editat sau șters oricând.",
    },
    select: { id: true },
  });

  const project = await prisma.project.create({
    data: {
      name: "Proiect Demo",
      description: "Exemplu de proiect, pentru a arăta cum se leagă task-urile și facturile de un client.",
      status: "ACTIVE",
      ownerId: userId,
      clientId: client.id,
      assigneeId: userId,
      address: "Str. Exemplu 1, Chișinău",
    },
    select: { id: true },
  });

  const task = await createTask(userId, {
    title: "Task Demo — verificare instalație",
    description: "Exemplu de task, legat de proiectul demo. Îl poți edita, schimba statusul sau șterge.",
    priority: "MEDIUM",
    assigneeId: userId,
    projectId: project.id,
    dueAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
  });

  await createInvoice(userId, {
    status: "DRAFT",
    issueDate: new Date(),
    dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    clientId: client.id,
    projectId: project.id,
    taskIds: task.ok ? [task.id] : [],
    notes: "Factură de exemplu (ciornă) — poate fi editată sau ștearsă.",
    terms: "",
    items: [{ description: "Serviciu demo", quantity: 1, unitPrice: 100, taxRate: 0 }],
  });
}
