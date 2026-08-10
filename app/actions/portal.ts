"use server";

import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/lib/client-dal";
import { filteredAdminRecipients, notifyUsers } from "@/lib/services/notifications";

export type PortalTicketState = { ok?: boolean; error?: string } | undefined;

/**
 * Tichet creat de un client din portal — oglindă fluxul „tichet venit prin email"
 * (lib/services/email-ticket.ts): creatorId e primul admin activ (clientul nu e un User),
 * fără assignee/team (rămâne NEW, nealocat), notificare broadcast la toți adminii calificați.
 */
export async function createPortalTicket(
  _prev: PortalTicketState,
  formData: FormData,
): Promise<PortalTicketState> {
  const client = await requireClient();

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!title) return { error: "Titlul e obligatoriu." };

  const systemUser = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (!systemUser) return { error: "Eroare internă — te rugăm încearcă mai târziu." };

  const counter = await prisma.counter.upsert({
    where: { name: "task-seq" },
    create: { name: "task-seq", value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });

  const ticket = await prisma.task.create({
    data: {
      seq: counter.value,
      type: "TICKET",
      title,
      description: description || null,
      status: "NEW",
      priority: "MEDIUM",
      creatorId: systemUser.id,
      clientId: client.id,
    },
    select: { id: true, seq: true },
  });

  after(async () => {
    try {
      const ids = await filteredAdminRecipients({ eventKeys: ["ticket.portal"] });
      if (ids.length) {
        await notifyUsers(
          ids,
          {
            title: `📨 Tichet nou de la ${client.name}: ${title}`,
            url: `/tickets/${ticket.id}`,
            taskId: ticket.id,
            seq: ticket.seq,
          },
          { telegram: true },
        );
      }
    } catch (e) {
      console.error("[portal] eșec notificare tichet nou:", e);
    }
  });

  return { ok: true };
}
