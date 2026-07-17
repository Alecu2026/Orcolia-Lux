import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { env } from "../env";
import { sendPushToUser } from "../push";
import { sendMessage, invisibleLink, type InlineButton } from "../telegram";

export type NotifyPayload = {
  title: string;
  body?: string;
  url?: string;
  taskId?: string;
  /** Id-ul scurt al task-ului (#123) — afișat + folosit pentru link-ul invizibil din Telegram. */
  seq?: number | null;
  /** Corpul complet al emailului/tichetului — afișat în mesajul Telegram. */
  emailBody?: string;
};

/**
 * Utilizatorii care vor să fie notificați (ca „observatori") pentru un anumit tip de
 * eveniment — adică au cheia evenimentului în notifyEvents. Granular, per utilizator.
 */
export async function observerRecipients(eventKey: string): Promise<string[]> {
  if (DEMO) return [];
  const users = await prisma.user.findMany({
    where: { isActive: true, notifyEvents: { has: eventKey } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export type AdminNotifyContext = {
  /** Cheile de eveniment aplicabile acestei notificări (ex. ["task.status","task.done"]). */
  eventKeys: string[];
  /** Echipe relevante (task.teamId, echipele asignatului/actorului). */
  teamIds?: (string | null | undefined)[];
  /** Persoane relevante (actorul care a făcut schimbarea, asignatul task-ului). */
  memberIds?: (string | null | undefined)[];
};

/**
 * Administratorii care trebuie notificați pentru acest eveniment, respectând
 * setările individuale: notifyScope (ALL/TEAMS/MEMBERS) + notifyEvents (tipuri).
 * notifyEvents vid = toate tipurile; altfel trebuie să intersecteze eventKeys.
 */
export async function filteredAdminRecipients(ctx: AdminNotifyContext): Promise<string[]> {
  if (DEMO) return [];
  const admins = await prisma.user.findMany({
    where: { isActive: true, role: "ADMIN" },
    select: { id: true, notifyScope: true, notifyTeamIds: true, notifyMemberIds: true, notifyEvents: true },
  });

  const teamSet = new Set((ctx.teamIds ?? []).filter((v): v is string => Boolean(v)));
  const memberSet = new Set((ctx.memberIds ?? []).filter((v): v is string => Boolean(v)));

  const ids = admins
    .filter((a) => {
      if (a.notifyEvents.length > 0 && !ctx.eventKeys.some((k) => a.notifyEvents.includes(k))) {
        return false;
      }
      if (a.notifyScope === "TEAMS") return a.notifyTeamIds.some((t) => teamSet.has(t));
      if (a.notifyScope === "MEMBERS") return a.notifyMemberIds.some((m) => memberSet.has(m));
      return true; // ALL (default)
    })
    .map((a) => a.id);

  console.log(
    `[notify] filteredAdminRecipients: ${ids.length}/${admins.length} admini calificați pentru`,
    ctx.eventKeys,
  );
  return ids;
}

/**
 * Trimite o notificare către mai mulți utilizatori pe toate canalele (best-effort):
 *  - in-app (tabel Notification, cu badge)
 *  - push web (telefon/desktop) dacă userul are abonament
 *  - Telegram dacă userul are chat legat
 */
export async function notifyUsers(
  userIds: string[],
  payload: NotifyPayload,
  opts: { telegram?: boolean } = {},
): Promise<void> {
  if (DEMO) {
    console.log("[notify] mod demo — notificare ignorată", payload.title);
    return;
  }
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) {
    console.log("[notify] niciun destinatar pentru:", payload.title);
    return;
  }

  // 1) In-app
  await prisma.notification
    .createMany({
      data: ids.map((userId) => ({
        userId,
        title: payload.title,
        body: payload.body ?? null,
        url: payload.url ?? null,
        taskId: payload.taskId ?? null,
      })),
    })
    .then(() => console.log(`[notify] in-app: ${ids.length} notificări create pentru "${payload.title}"`))
    .catch((e) => console.error("[notify] in-app: createMany a eșuat", e));

  // 2) Push + Telegram (best-effort, în paralel)
  await Promise.all(
    ids.map(async (uid) => {
      try {
        const res = await sendPushToUser(uid, {
          title: payload.title,
          body: payload.body ?? "",
          url: payload.url ?? "/notificari",
        });
        console.log(`[notify] push user=${uid}: trimise=${res.sent} șterse=${res.removed}`);
      } catch (e) {
        console.error(`[notify] push: eșuat pentru user ${uid}`, e);
      }
      if (opts.telegram) {
        try {
          const u = await prisma.user.findUnique({
            where: { id: uid },
            select: { telegramChatId: true, telegramAccounts: { select: { chatId: true }, take: 1 } },
          });
          const chat = u?.telegramChatId || u?.telegramAccounts[0]?.chatId;
          if (chat) {
            const fullUrl = payload.url
              ? payload.url.startsWith("http") ? payload.url : `${env.appUrl}${payload.url}`
              : null;

            let titleHtml = escapeHtml(payload.title);
            if (payload.seq != null && fullUrl) {
              const seqTag = `#${payload.seq}`;
              const seqLink = `<a href="${fullUrl}">${seqTag}</a>`;
              if (titleHtml.includes(seqTag)) {
                titleHtml = titleHtml.replace(seqTag, seqLink);
              } else {
                // Adaugă link invizibil la final când #N nu apare în titlu
                titleHtml = titleHtml + invisibleLink(fullUrl);
              }
            } else if (fullUrl) {
              titleHtml = titleHtml + invisibleLink(fullUrl);
            }

            let msgText = `🔔 <b>${titleHtml}</b>`;
            if (payload.body) msgText += `\n${escapeHtml(payload.body)}`;
            if (payload.emailBody) {
              const preview = payload.emailBody.slice(0, 800).trim();
              if (preview) msgText += `\n\n${escapeHtml(preview)}`;
            }

            // Telegram respinge URL-uri localhost/127.0.0.1 în butoane inline
            const isValidHttpsUrl = fullUrl && /^https:\/\//i.test(fullUrl);
            const keyboard: InlineButton[][] | undefined = isValidHttpsUrl
              ? [[{ text: payload.url?.includes("/ticket") ? "🎫 Deschide tichetul" : "🔗 Deschide", url: fullUrl }]]
              : undefined;

            const res = await sendMessage(chat, msgText, keyboard);
            if (!res) console.error(`[notify] telegram: sendMessage a eșuat pentru user ${uid}`);
          } else {
            console.log(`[notify] telegram: user ${uid} nu are chat legat — sărit`);
          }
        } catch (e) {
          console.error(`[notify] telegram: eșuat pentru user ${uid}`, e);
        }
      }
    }),
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
