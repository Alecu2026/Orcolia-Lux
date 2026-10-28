import "server-only";
import webpush from "web-push";
import { prisma } from "./prisma";
import { env } from "./env";
import { logDelivery } from "./delivery-log";

let configured = false;

function ensureConfigured(): boolean {
  if (!env.vapid.enabled) return false;
  if (!configured) {
    webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey);
    configured = true;
  }
  return true;
}

export type PushPayload = { title: string; body: string; url?: string };

/** Trimite o notificare push către toate device-urile userului. Curăță abonamentele moarte. */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<{ sent: number; removed: number }> {
  const t0 = Date.now();
  const who = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }).catch(() => null);
  const base = { channel: "PUSH" as const, toUserId: userId, toName: who?.name ?? null, subject: payload.title, body: payload.body };
  if (!ensureConfigured()) {
    console.log("[push] omis: VAPID neconfigurat (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)");
    await logDelivery({ ...base, status: "SKIPPED", error: "VAPID neconfigurat.", durationMs: 0 });
    return { sent: 0, removed: 0 };
  }

  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subs.length === 0) {
    console.log(`[push] user ${userId} nu are niciun abonament push activ`);
    await logDelivery({ ...base, status: "SKIPPED", error: "Utilizatorul nu are niciun dispozitiv abonat la notificări push.", durationMs: Date.now() - t0 });
    return { sent: 0, removed: 0 };
  }

  let sent = 0;
  let removed = 0;
  const body = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
        );
        sent++;
      } catch (e: unknown) {
        const status = (e as { statusCode?: number })?.statusCode;
        const rawBody = (e as { body?: string })?.body ?? "";
        // 404/410 = abonament mort. VapidPkHashMismatch = abonamentul a fost creat cu o
        // pereche VAPID diferită de cea curentă (ex. chei regenerate) — nu se va repara
        // niciodată singur, deci îl curățăm la fel ca pe cele expirate.
        const vapidMismatch = status === 400 && rawBody.includes("VapidPkHashMismatch");
        if (status === 404 || status === 410 || vapidMismatch) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          removed++;
          console.log(
            `[push] abonament invalid șters (status ${status}${vapidMismatch ? ", VapidPkHashMismatch — cheile VAPID s-au schimbat" : ""}) pentru user ${userId}`,
          );
        } else {
          console.error(`[push] sendNotification eșuat pentru user ${userId} (status ${status ?? "?"})`, e);
        }
      }
    }),
  );

  if (subs.length > 0) {
    await logDelivery({
      ...base,
      status: sent > 0 ? "SENT" : "FAILED",
      to: `${sent}/${subs.length} dispozitive`,
      error: sent > 0 ? (removed > 0 ? `${removed} abonament(e) expirat(e) șterse` : null) : removed > 0 ? "Abonamentele erau expirate (șterse)." : "Trimiterea către dispozitive a eșuat.",
      durationMs: Date.now() - t0,
    });
  }
  return { sent, removed };
}
