import "server-only";
import { after } from "next/server";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { FEEDBACK_LOW, FEEDBACK_MAX, validateFeedback } from "../ticket-feedback";
import { filteredAdminRecipients, notifyUsers, observerRecipients } from "./notifications";

/**
 * Feedback-ul clientului după închiderea cererii lui din portal: nota 1–5 + comentariu opțional, salvate pe cerere (`Task.feedback*`). Se poate da doar după „Finalizat”
 * și doar de clientul căruia îi aparține cererea; îl poate corecta ulterior. La fiecare trimitere primesc notificare (aplicație, push, Telegram) administratorii (după setările
 * lor), cei asignați cererii și observatorii evenimentului „ticket.feedback”; o notă mică (≤ 2) e marcată ca nemulțumire.
 */

type Client = { id: string; name: string };

export type FeedbackResult = { ok: true; rating: number; comment: string | null } | { ok: false; error: string };

export async function submitTicketFeedback(client: Client, taskId: string, rating: number, commentRaw: string): Promise<FeedbackResult> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  const comment = commentRaw.replace(/\r\n/g, "\n").trim().slice(0, FEEDBACK_MAX) || null;
  const bad = validateFeedback(rating, comment);
  if (bad) return { ok: false, error: bad };
  if (!/^[0-9a-f]{24}$/i.test(taskId)) return { ok: false, error: "Cerere inexistentă." };

  const task = await prisma.task.findFirst({
    where: { id: taskId, clientId: client.id, type: "TICKET" },
    select: { id: true, seq: true, title: true, status: true, assigneeId: true, extraAssigneeIds: true, teamId: true, feedbackAt: true },
  });
  if (!task) return { ok: false, error: "Cerere inexistentă." };
  if (task.status !== "DONE") return { ok: false, error: "Poți evalua cererea după ce este finalizată." };

  await prisma.task.update({ where: { id: task.id }, data: { feedbackRating: rating, feedbackComment: comment, feedbackAt: new Date() } });

  const safe = () =>
    notifyStaff(client, task, rating, comment, !!task.feedbackAt).catch((e) => console.error("[ticket-feedback] notificarea personalului:", e));
  try {
    after(safe);
  } catch {
    void safe();
  }
  return { ok: true, rating, comment };
}

async function notifyStaff(
  client: Client,
  task: { id: string; seq: number | null; title: string; assigneeId: string | null; extraAssigneeIds: string[]; teamId: string | null },
  rating: number,
  comment: string | null,
  updated: boolean,
) {
  const assigned = [task.assigneeId, ...task.extraAssigneeIds].filter((x): x is string => !!x);
  const ids = [
    ...new Set([
      ...assigned,
      ...(await filteredAdminRecipients({ eventKeys: ["ticket.feedback"], teamIds: [task.teamId], memberIds: assigned })),
      ...(await observerRecipients("ticket.feedback")),
    ]),
  ];
  if (ids.length === 0) return;
  const low = rating <= FEEDBACK_LOW;
  const ref = task.seq != null ? ` #${task.seq}` : "";
  await notifyUsers(
    ids,
    {
      title: `${low ? "⚠️" : "⭐"} ${client.name}: feedback ${rating}/5 la cererea${ref}${updated ? " (modificat)" : ""}`,
      body: `${"★".repeat(rating)}${"☆".repeat(5 - rating)} · ${task.title}${comment ? `\n${comment.length > 300 ? `${comment.slice(0, 300)}…` : comment}` : ""}${low ? "\n\nClient nemulțumit: se recomandă să-l contactați." : ""}`,
      url: `/tickets/${task.id}`,
      taskId: task.id,
      seq: task.seq,
    },
    { telegram: true },
  );
}
