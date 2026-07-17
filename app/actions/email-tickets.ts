"use server";

import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { sendEmailReply } from "@/lib/services/email-ticket";
import { prisma } from "@/lib/prisma";

export type EmailReplyResult = { ok: boolean; error?: string };

export async function sendEmailReplyAction(
  taskId: string,
  replyBody: string,
): Promise<EmailReplyResult> {
  const user = await requireUser();
  if (!can(user, "tasks.edit")) return { ok: false, error: "Fără permisiune." };
  if (!replyBody.trim()) return { ok: false, error: "Mesajul nu poate fi gol." };

  const company = await prisma.companySettings.findFirst({
    where: { singleton: "main" },
    select: { companyName: true },
  }).catch(() => null);

  try {
    await sendEmailReply({
      taskId,
      staffUserId: user.id,
      staffName: user.name,
      replyBody: replyBody.trim(),
      companyName: company?.companyName,
      fromName: null,
      fromAddr: null,
    });
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Eroare necunoscută.";
    return { ok: false, error: msg };
  }
}

export type EmailThreadMessage = {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  body: string;
  sentAt: string;
};

export async function getEmailThreadAction(taskId: string): Promise<EmailThreadMessage[]> {
  const user = await requireUser();
  if (!can(user, "tasks.view")) return [];

  const messages = await prisma.emailMessage.findMany({
    where: { taskId },
    orderBy: { sentAt: "asc" },
    select: {
      id: true,
      direction: true,
      fromEmail: true,
      fromName: true,
      toEmail: true,
      body: true,
      sentAt: true,
    },
  });

  return messages.map((m) => ({
    ...m,
    direction: m.direction as "INBOUND" | "OUTBOUND",
    sentAt: m.sentAt.toISOString(),
  }));
}
