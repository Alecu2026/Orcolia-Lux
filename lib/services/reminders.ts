import "server-only";
import { prisma } from "../prisma";
import { sendReminderEmail } from "../email";
import { sendMessage } from "../telegram";
import { getSettings } from "../queries/settings";
import { getQuietHoursSettings } from "../queries/company";
import { isQuietTime } from "../quiet-hours";
import { formatDate, formatTime } from "../date";

const MAX_ATTEMPTS = 3;

/**
 * Procesează reminderele scadente (status PENDING, sendAt <= acum).
 * - succes → SENT
 * - eșec → attempts++ ; PENDING până la 3 încercări, apoi FAILED
 */
export async function processDueReminders(limit = 50) {
  const now = new Date();
  const due = await prisma.reminder.findMany({
    where: { status: "PENDING", sendAt: { lte: now } },
    take: limit,
    orderBy: { sendAt: "asc" },
    select: {
      id: true,
      type: true,
      attempts: true,
      userId: true,
      appointmentId: true,
      appointment: {
        select: {
          startAt: true,
          title: true,
          status: true,
          categoryNameSnapshot: true,
          client: { select: { name: true, email: true, telegramChatId: true } },
        },
      },
    },
  });

  let sent = 0;
  let failed = 0;

  const qhConfig = await getQuietHoursSettings();

  for (const r of due) {
    const appt = r.appointment;

    // Ore de somn activ → sari, va fi procesat la următoarea rulare cron
    if (isQuietTime(now, qhConfig)) continue;

    // Programare anulată / absentă / finalizată → reminder fără rost
    if (!appt || ["CANCELLED", "NO_SHOW", "DONE"].includes(appt.status)) {
      await prisma.reminder.update({ where: { id: r.id }, data: { status: "CANCELLED" } });
      continue;
    }

    const settings = await getSettings(r.userId);
    const tz = settings.timezone;
    const date = formatDate(appt.startAt, tz);
    const time = formatTime(appt.startAt, tz);
    const service = appt.categoryNameSnapshot ?? appt.title;
    const client = appt.client;

    try {
      if (r.type === "EMAIL") {
        if (!client.email) throw new Error("Clientul nu are email.");
        await sendReminderEmail({
          to: client.email,
          clientName: client.name,
          service,
          date,
          time,
          fromName: settings.emailFromName,
          fromAddr: settings.emailFromAddr,
        });
      } else if (r.type === "TELEGRAM") {
        if (!client.telegramChatId) throw new Error("Clientul nu are Telegram.");
        const ok = await sendMessage(
          client.telegramChatId,
          `🔔 <b>Reminder</b>\nBună, ${client.name}. Ai programare la <b>${service}</b> pe <b>${date}</b> la <b>${time}</b>.\nTe rugăm confirmă dacă poți ajunge.`,
        );
        if (ok === null) throw new Error("Trimitere Telegram eșuată.");
      } else {
        // PWA — gestionat separat de push; marcăm trimis
      }

      await prisma.reminder.update({ where: { id: r.id }, data: { status: "SENT" } });
      await logNotification(r.userId, r.type, client.email ?? client.telegramChatId, r.appointmentId, r.id, true);
      sent++;
    } catch (e) {
      const attempts = r.attempts + 1;
      const status = attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING";
      await prisma.reminder.update({
        where: { id: r.id },
        data: { attempts, status, lastError: e instanceof Error ? e.message : "eroare" },
      });
      await logNotification(
        r.userId,
        r.type,
        client.email ?? client.telegramChatId,
        r.appointmentId,
        r.id,
        false,
        e instanceof Error ? e.message : "eroare",
      );
      failed++;
    }
  }

  return { processed: due.length, sent, failed };
}

async function logNotification(
  userId: string,
  channel: "EMAIL" | "TELEGRAM" | "PWA",
  target: string | null,
  appointmentId: string,
  reminderId: string,
  success: boolean,
  error?: string,
) {
  await prisma.notificationLog
    .create({
      data: { userId, channel, target: target ?? null, appointmentId, reminderId, success, error: error ?? null },
    })
    .catch(() => {});
}
