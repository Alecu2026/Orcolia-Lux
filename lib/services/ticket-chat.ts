import "server-only";
import { prisma } from "../prisma";
import { env } from "../env";
import { DEMO } from "../demo";
import { getCurrentUser } from "../dal";
import { getCurrentClient } from "../client-dal";
import { can, canEditTask, canViewTask } from "../permissions";
import { sendTicketMessageEmail } from "../email";
import { filteredAdminRecipients, notifyUsers, observerRecipients } from "./notifications";
import type { ChatMessage, ChatSender, ChatState } from "../ticket-chat-shared";

const TASK_SELECT = {
  id: true, seq: true, title: true, type: true, status: true, clientId: true,
  creatorId: true, assigneeId: true, extraAssigneeIds: true, teamId: true, extraTeamIds: true,
  chatLastMsgAt: true, chatLastSender: true, chatStaffReadAt: true, chatClientReadAt: true, chatClientEmailedAt: true,
} as const;

type ChatTask = NonNullable<Awaited<ReturnType<typeof loadTask>>>;
const loadTask = (id: string) => prisma.task.findUnique({ where: { id }, select: TASK_SELECT });

export type ChatViewer = { kind: "staff" | "client"; id: string; name: string; canWrite: boolean; blockedReason: string | null };
export type ChatAccess = { ok: true; viewer: ChatViewer; task: ChatTask } | { ok: false; status: 401 | 403 | 404; error: string };

const ID_RE = /^[0-9a-f]{24}$/i;

/**
 * Cine citește conversația și ce are voie. `as` alege ce sesiune se verifică (pagina de portal vs pagina operatorilor) — important
 * când cineva e logat în aceeași fereastră și ca operator, și ca client (de ex. la testare). Un client vede doar tichetele lui; un
 * operator doar pe cele pe care are voie să le vadă (aceeași regulă ca la task-uri) și poate scrie dacă poate edita tichetul.
 */
export async function resolveChatAccess(taskId: string, as: "staff" | "client"): Promise<ChatAccess> {
  if (DEMO) return { ok: false, status: 404, error: "Mod demo." };
  if (!ID_RE.test(taskId)) return { ok: false, status: 404, error: "Tichet inexistent." };

  if (as === "staff") {
    const user = await getCurrentUser();
    if (!user) return { ok: false, status: 401, error: "Autentificare necesară." };
    if (!can(user, "tasks.view")) return { ok: false, status: 403, error: "Fără permisiune." };
    const task = await loadTask(taskId);
    if (!task || task.type !== "TICKET" || !canViewTask(user, task)) return { ok: false, status: 404, error: "Tichet inexistent." };
    let blockedReason: string | null = null;
    if (!task.clientId) blockedReason = "Tichetul nu are un client asociat, deci nu are cui să scrii.";
    else if (!canEditTask(user, task)) blockedReason = "Nu ai permisiunea să răspunzi la acest tichet.";
    else if (task.status === "CANCELLED") blockedReason = "Tichetul e anulat.";
    return { ok: true, viewer: { kind: "staff", id: user.id, name: user.name, canWrite: blockedReason == null, blockedReason }, task };
  }

  const client = await getCurrentClient();
  if (!client) return { ok: false, status: 401, error: "Autentificare necesară." };
  const task = await loadTask(taskId);
  if (!task || task.type !== "TICKET" || task.clientId !== client.id) return { ok: false, status: 404, error: "Tichet inexistent." };
  const blockedReason = task.status === "CANCELLED" ? "Tichetul a fost anulat — nu mai poți scrie aici." : null;
  return { ok: true, viewer: { kind: "client", id: client.id, name: client.name, canWrite: blockedReason == null, blockedReason }, task };
}

const toMsg = (m: { id: string; sender: string; authorName: string; body: string; createdAt: Date }): ChatMessage => ({
  id: m.id,
  sender: m.sender === "CLIENT" ? "CLIENT" : "STAFF",
  authorName: m.authorName,
  body: m.body,
  createdAt: m.createdAt.toISOString(),
});

/** Mesajele conversației (cele mai vechi primele). Cu `since`: doar cele de la acel moment încoace (se deduplică după id în browser). */
export async function listChatMessages(taskId: string, since?: Date | null): Promise<ChatMessage[]> {
  const rows = await prisma.ticketMessage.findMany({
    where: { taskId, ...(since ? { createdAt: { gte: since } } : {}) },
    orderBy: { createdAt: "asc" },
    take: since ? 200 : 500,
    select: { id: true, sender: true, authorName: true, body: true, createdAt: true },
  });
  return rows.map(toMsg);
}

/** Starea afișată celui care citește: mesaje, status, drept de scriere, „văzut" de cealaltă parte. */
export function chatState(access: Extract<ChatAccess, { ok: true }>, messages: ChatMessage[]): ChatState {
  const { viewer, task } = access;
  const peerRead = viewer.kind === "staff" ? task.chatClientReadAt : task.chatStaffReadAt;
  return {
    messages,
    status: task.status,
    canWrite: viewer.canWrite,
    writeBlockedReason: viewer.blockedReason,
    viewerName: viewer.name,
    peerReadAt: peerRead ? peerRead.toISOString() : null,
  };
}

/** Marchează conversația ca citită de cel care o deschide (doar dacă ultimul mesaj e al celeilalte părți și nu era deja citit). */
export async function markChatRead(access: Extract<ChatAccess, { ok: true }>): Promise<void> {
  const { viewer, task } = access;
  const lastAt = task.chatLastMsgAt;
  if (!lastAt) return;
  if (viewer.kind === "staff") {
    if (task.chatLastSender === "CLIENT" && (!task.chatStaffReadAt || task.chatStaffReadAt < lastAt)) {
      await prisma.task.update({ where: { id: task.id }, data: { chatStaffReadAt: new Date() } });
    }
  } else if (task.chatLastSender === "STAFF" && (!task.chatClientReadAt || task.chatClientReadAt < lastAt)) {
    await prisma.task.update({ where: { id: task.id }, data: { chatClientReadAt: new Date() } });
  }
}

/** Salvează un mesaj nou și actualizează tichetul (ultimul mesaj, marcajul de citire al autorului, redeschiderea dacă era finalizat). */
export async function postChatMessage(access: Extract<ChatAccess, { ok: true }>, body: string): Promise<ChatMessage> {
  const { viewer, task } = access;
  const sender: ChatSender = viewer.kind === "client" ? "CLIENT" : "STAFF";
  const msg = await prisma.ticketMessage.create({
    data: {
      taskId: task.id,
      sender,
      userId: sender === "STAFF" ? viewer.id : null,
      clientId: sender === "CLIENT" ? viewer.id : null,
      authorName: viewer.name,
      body,
    },
    select: { id: true, sender: true, authorName: true, body: true, createdAt: true },
  });
  await prisma.task.update({
    where: { id: task.id },
    data: {
      chatLastMsgAt: msg.createdAt,
      chatLastSender: sender,
      ...(sender === "STAFF" ? { chatStaffReadAt: msg.createdAt } : { chatClientReadAt: msg.createdAt }),
      // un client care scrie la un tichet finalizat îl redeschide
      ...(sender === "CLIENT" && task.status === "DONE" ? { status: "NEW" as const } : {}),
    },
  });
  return toMsg(msg);
}

const EMAIL_COOLDOWN_MS = 90_000;
const excerpt = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+/g, " ");

/**
 * După un mesaj: dacă l-a scris clientul, anunțăm operatorii (asignați; altfel adminii) în aplicație, push și Telegram; dacă l-a scris
 * un operator, trimitem clientului un email cu linkul spre conversație. Rulează după răspuns (în `after`), erorile doar se loghează.
 */
export async function notifyChatMessage(access: Extract<ChatAccess, { ok: true }>, message: ChatMessage): Promise<void> {
  const { viewer, task } = access;
  try {
    if (viewer.kind === "client") {
      const assigned = [task.assigneeId, ...task.extraAssigneeIds].filter((x): x is string => !!x);
      const ids = assigned.length
        ? assigned
        : [...new Set([
            ...(await filteredAdminRecipients({ eventKeys: ["ticket.message", "ticket.portal"] })),
            ...(await observerRecipients("ticket.message")),
          ])];
      if (ids.length) {
        await notifyUsers(
          ids,
          {
            title: `💬 ${viewer.name}: mesaj nou la tichetul${task.seq != null ? ` #${task.seq}` : ""}`,
            body: excerpt(message.body),
            url: `/tickets/${task.id}`,
            taskId: task.id,
            seq: task.seq,
          },
          { telegram: true },
        );
      }
      return;
    }

    // operator → client: email (cu pauză între emailuri, ca o rafală de mesaje să nu ducă la o avalanșă)
    if (!task.clientId) return;
    const client = await prisma.client.findUnique({ where: { id: task.clientId }, select: { name: true, email: true } });
    if (!client?.email) return;
    if (task.chatClientEmailedAt && Date.now() - task.chatClientEmailedAt.getTime() < EMAIL_COOLDOWN_MS) return;
    if (!env.smtp.enabled) return;
    const company = await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { companyName: true } });
    await sendTicketMessageEmail({
      to: client.email,
      clientName: client.name,
      ticketTitle: task.title,
      seq: task.seq,
      authorName: message.authorName,
      message: message.body,
      url: `${env.appUrl.replace(/\/$/, "")}/portal/tickets/${task.id}`,
      companyName: company?.companyName,
    });
    await prisma.task.update({ where: { id: task.id }, data: { chatClientEmailedAt: new Date() } });
  } catch (e) {
    console.error("[ticket-chat] notificarea a eșuat:", e);
  }
}
