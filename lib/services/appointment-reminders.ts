import "server-only";
import { prisma } from "../prisma";
import { sendReminderEmail } from "../email";
import { sendMessage } from "../telegram";
import { getSettings } from "../queries/settings";
import { getQuietHoursSettings } from "../queries/company";
import { isQuietTime } from "../quiet-hours";
import { formatDate, formatTime } from "../date";
import { APPT_REMINDER_STATUSES, nextApptReminderAt, parseReminderSchedule } from "../reminder-schedule";
import { notifyUsers } from "./notifications";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** „în 3 ore”, „în 1 zi 2 ore”, „în 25 min”, „acum” — cât mai e până la începerea programării (rotunjit, ca să nu apară „29 min” la un prag de 30). */
export function timeLeftText(ms: number): string {
  let min = Math.max(0, Math.round(ms / 60_000));
  if (min >= 10) min = Math.round(min / 5) * 5;
  if (min < 2) return "acum";
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  const m = min % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d} ${d === 1 ? "zi" : "zile"}`);
  if (h) parts.push(`${h} ${h === 1 ? "oră" : "ore"}`);
  if (m && !d) parts.push(`${m} min`);
  return `în ${parts.join(" ")}`;
}

/**
 * Reamintirile programărilor cu programare / interval propriu (ca la sarcini): „înainte de începere”, zilnic, săptămânal, lunar, la interval sau
 * interval fix. Rulează la fiecare minut (temporizatorul serverului) și din cron. Pentru fiecare programare scadentă:
 *  - proprietarul primește notificare în aplicație + push + Telegram;
 *  - clientul primește email / Telegram dacă programarea are canalele bifate (nu în orele de liniște).
 * `nextReminderAt` se „revendică” atomic ÎNAINTE de trimitere, deci o reamintire nu pleacă de două ori (nici dacă rulează simultan temporizatorul și cron-ul).
 */
export async function checkAppointmentReminders(): Promise<{ checked: number; notified: number }> {
  const now = new Date();
  const candidates = await prisma.appointment.findMany({
    // `not: null` e necesar: filtrul `lte` al lui Prisma pe MongoDB potrivește și documentele cu nextReminderAt = null
    where: { status: { in: [...APPT_REMINDER_STATUSES] }, AND: [{ nextReminderAt: { not: null } }, { nextReminderAt: { lte: now } }] },
    select: {
      id: true, userId: true, assigneeId: true, title: true, message: true, status: true, startAt: true,
      clientNameSnapshot: true, categoryNameSnapshot: true,
      reminderEmailEnabled: true, reminderTelegramEnabled: true,
      reminderSchedule: true, reminderIntervalMinutes: true, nextReminderAt: true,
      client: { select: { name: true, email: true, telegramChatId: true } },
    },
    take: 200,
  });
  if (candidates.length === 0) return { checked: 0, notified: 0 };

  const quiet = isQuietTime(now, await getQuietHoursSettings());
  let notified = 0;

  for (const a of candidates) {
    try {
      const settings = await getSettings(a.userId);
      const tz = settings.timezone;
      const schedule = parseReminderSchedule(a.reminderSchedule, now, tz, { allowBefore: true });
      const nextAt = nextApptReminderAt(schedule, a.reminderIntervalMinutes, a.startAt, now, tz);
      // Revendicare atomică: doar cine mută nextReminderAt (încă egal cu valoarea citită) trimite.
      const claimed = await prisma.appointment.updateMany({ where: { id: a.id, nextReminderAt: a.nextReminderAt }, data: { nextReminderAt: nextAt } });
      if (claimed.count === 0) continue;
      // programarea a început între timp, sau nu mai are nicio programare de remindere → doar oprim
      if (a.startAt.getTime() <= now.getTime() || (!schedule && !a.reminderIntervalMinutes)) continue;

      const date = formatDate(a.startAt, tz);
      const time = formatTime(a.startAt, tz);
      const service = a.categoryNameSnapshot ?? a.title;
      const left = timeLeftText(a.startAt.getTime() - now.getTime());

      // cel care a creat programarea + cel pentru care e (dacă există)
      await notifyUsers(
        a.assigneeId ? [a.userId, a.assigneeId] : [a.userId],
        {
          title: `🔔 ${a.clientNameSnapshot} – ${left}`,
          body: `${service} · ${date} la ${time}${a.message?.trim() ? ` · ${a.message.trim()}` : ""}`,
          url: `/appointments?id=${a.id}`,
        },
        { telegram: true },
      );
      notified++;

      // clientul, pe canalele bifate (nu noaptea)
      if (!quiet) {
        if (a.reminderEmailEnabled && a.client.email) {
          await sendReminderEmail({
            to: a.client.email,
            clientName: a.client.name,
            service,
            date,
            time,
            fromName: settings.emailFromName,
            fromAddr: settings.emailFromAddr,
          }).catch((e) => console.error("[appointments] email reamintire client:", e));
        }
        if (a.reminderTelegramEnabled && a.client.telegramChatId) {
          await sendMessage(
            a.client.telegramChatId,
            `🔔 <b>Reminder</b>\nBună, ${esc(a.client.name)}. Ai programare la <b>${esc(service)}</b> pe <b>${date}</b> la <b>${time}</b>.\nTe rugăm confirmă dacă poți ajunge.`,
          ).catch((e) => console.error("[appointments] Telegram reamintire client:", e));
        }
      }
    } catch (e) {
      console.error("[appointments] reamintire programare:", a.id, e);
    }
  }
  console.log(`[appointments] checkAppointmentReminders: ${notified}/${candidates.length} programări cu reamintire scadentă`);
  return { checked: candidates.length, notified };
}
