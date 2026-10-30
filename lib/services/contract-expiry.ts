import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { env } from "../env";
import { sendPayerNotificationEmail } from "../email";
import { sendSms } from "../sms";
import { withDeliveryMeta } from "../delivery-log";
import { getQuietHoursSettings } from "../queries/company";
import { isQuietTime } from "../quiet-hours";
import { addDaysToKey, DEFAULT_TZ, todayKey } from "../date";
import { isEmail, normalizePhone, stripLatinDiacritics } from "../payer-notify";
import { can } from "../permissions";
import { contractDate, contractKey, contractStage, daysUntil, stageKey, type ContractStage } from "../contract-expiry";
import { filteredAdminRecipients, notifyUsers } from "./notifications";

/**
 * Notificările de expirare a contractului plătitorilor (data o introduce personalul, în fișa plătitorului): cu 30 și cu 10 zile înainte, atât către plătitor
 * (email + SMS, dacă are și canalul e configurat), cât și către personal (o singură notificare pe etapă, cu lista contractelor și cine n-are cum fi anunțat).
 * Fiecare etapă pleacă o singură dată pentru o anumită dată de expirare: se „revendică” atomic în `Client.contractNotified` (ex. „2026-12-31:30”) ÎNAINTE de
 * trimitere, deci nu se dublează nici dacă rulează simultan temporizatorul și cron-ul; o dată schimbată reia etapele. Dacă data se introduce când mai sunt
 * ≤ 10 zile, pleacă doar etapa de 10 zile. Nu se trimite în orele de liniște (se reia la următoarea verificare).
 */

const ro = (s: string) => stripLatinDiacritics(s);
const fmt = (key: string) => key.split("-").reverse().join(".");

const whenRo = (d: number) => (d <= 0 ? "astăzi" : d === 1 ? "mâine" : `peste ${d} zile`);
const whenRu = (d: number) => (d <= 0 ? "сегодня" : d === 1 ? "завтра" : `через ${d} дн.`);

/** Mesajul către plătitor: email în română și rusă (clienții vorbesc ambele), SMS scurt în română, fără diacritice. */
export function contractMessages(name: string, key: string, days: number, company: string) {
  const co = company || "Apă-Canal";
  const date = fmt(key);
  return {
    subject: `Contractul dumneavoastră expiră ${whenRo(days)} / Срок действия договора истекает ${whenRu(days)}`,
    emailBody:
      `Stimate(ă) ${name},\n\nVă informăm că contractul dumneavoastră cu ${co} expiră la ${date} (${whenRo(days)}). ` +
      `Pentru a-l prelungi, vă rugăm să ne contactați din timp.\n\nCu respect,\n${co}\n\n— — —\n\n` +
      `Уважаемый(ая) ${name},\n\nСообщаем, что срок действия вашего договора с ${co} истекает ${date} (${whenRu(days)}). ` +
      `Чтобы продлить договор, пожалуйста, свяжитесь с нами заблаговременно.\n\nС уважением,\n${co}`,
    sms: ro(`${co}: contractul dvs. expira la ${date} (${whenRo(days)}). Contactati-ne pentru prelungire.`),
  };
}

let lastRun = 0;
const MIN_GAP_MS = 25 * 60_000;

type Due = { id: string; name: string; email: string | null; phone: string | null; key: string; days: number; stage: ContractStage };
type Sent = { due: Due; email: "sent" | "failed" | "none"; sms: "sent" | "failed" | "none" };

const errText = (e: unknown) => (e instanceof Error ? e.message : "Eroare necunoscută").slice(0, 200);

/** Staff: administratorii (cu setările lor de notificări) și utilizatorii care pot edita plătitori. */
async function staffRecipients(): Promise<string[]> {
  const [admins, users] = await Promise.all([
    filteredAdminRecipients({ eventKeys: ["payer.contract"] }),
    prisma.user.findMany({ where: { isActive: true, role: { not: "ADMIN" } }, select: { id: true, role: true, permissions: true } }),
  ]);
  const editors = users.filter((u) => can(u, "payers.edit")).map((u) => u.id);
  return [...new Set([...admins, ...editors])];
}

export async function checkContractExpiry(opts: { force?: boolean } = {}): Promise<{ due: number; notified: number }> {
  if (DEMO) return { due: 0, notified: 0 };
  const now = new Date();
  if (!opts.force && now.getTime() - lastRun < MIN_GAP_MS) return { due: 0, notified: 0 };
  lastRun = now.getTime();

  const today = todayKey(DEFAULT_TZ);
  const candidates = await prisma.client.findMany({
    where: { contractExpiresAt: { not: null, gte: contractDate(today), lte: contractDate(addDaysToKey(today, 30)) } },
    select: { id: true, name: true, email: true, phone: true, contractExpiresAt: true, contractNotified: true },
    take: 5000,
  });
  const due: Due[] = [];
  for (const c of candidates) {
    const key = contractKey(c.contractExpiresAt);
    if (!key) continue;
    const days = daysUntil(key, today);
    const stage = contractStage(days);
    if (!stage || (c.contractNotified ?? []).includes(stageKey(key, stage))) continue;
    due.push({ id: c.id, name: c.name, email: c.email, phone: c.phone, key, days, stage });
  }
  if (due.length === 0) return { due: 0, notified: 0 };
  // orele de liniște: nu trimitem acum; nimic nu e revendicat, deci se reia la următoarea verificare
  if (isQuietTime(now, await getQuietHoursSettings())) return { due: due.length, notified: 0 };

  const company = (await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { companyName: true } }))?.companyName ?? "";
  const sent: Sent[] = [];
  const logs: { campaignId: string; clientId: string; clientName: string; channel: string; to: string; status: string; error: string | null; subject: string | null; body: string; userName: string }[] = [];

  for (const d of due) {
    const sk = stageKey(d.key, d.stage);
    // revendicare atomică: doar cine adaugă etapa (încă lipsă, pe aceeași dată) trimite
    const claimed = await prisma.client.updateMany({
      where: { id: d.id, contractExpiresAt: contractDate(d.key), NOT: { contractNotified: { has: sk } } },
      data: { contractNotified: { push: sk } },
    });
    if (claimed.count === 0) continue;

    const msg = contractMessages(d.name, d.key, d.days, company);
    const campaignId = `contract-${d.key}-${d.stage}`;
    const base = { campaignId, clientId: d.id, clientName: d.name, userName: "Automat · expirare contract" };
    const dmeta = { kind: "payer.contract", campaignId, toClientId: d.id, toName: d.name, objectType: "client", objectId: d.id };
    const res: Sent = { due: d, email: "none", sms: "none" };

    const email = d.email?.trim() ?? "";
    if (isEmail(email) && env.smtp.enabled) {
      try {
        await withDeliveryMeta(dmeta, () => sendPayerNotificationEmail({ to: email, subject: msg.subject, body: msg.emailBody, companyName: company || null }));
        res.email = "sent";
        logs.push({ ...base, channel: "EMAIL", to: email, status: "SENT", error: null, subject: msg.subject, body: msg.emailBody });
      } catch (e) {
        res.email = "failed";
        logs.push({ ...base, channel: "EMAIL", to: email, status: "FAILED", error: errText(e), subject: msg.subject, body: msg.emailBody });
      }
    }
    const phone = normalizePhone(d.phone);
    if (phone && env.sms.enabled) {
      try {
        await withDeliveryMeta(dmeta, () => sendSms(phone, msg.sms));
        res.sms = "sent";
        logs.push({ ...base, channel: "SMS", to: phone, status: "SENT", error: null, subject: null, body: msg.sms });
      } catch (e) {
        res.sms = "failed";
        logs.push({ ...base, channel: "SMS", to: phone, status: "FAILED", error: errText(e), subject: null, body: msg.sms });
      }
    }
    // niciun canal n-a plecat deși existau (eroare temporară): etapa nu rămâne „făcută”, se reia la următoarea verificare
    const attempted = res.email !== "none" || res.sms !== "none";
    if (attempted && res.email !== "sent" && res.sms !== "sent") {
      const cur = await prisma.client.findUnique({ where: { id: d.id }, select: { contractNotified: true } });
      await prisma.client.update({ where: { id: d.id }, data: { contractNotified: (cur?.contractNotified ?? []).filter((x) => x !== sk) } }).catch(() => {});
      continue;
    }
    sent.push(res);
  }

  if (logs.length) await prisma.payerNotificationLog.createMany({ data: logs }).catch((e) => console.error("[contract] jurnal:", e));
  if (sent.length === 0) return { due: due.length, notified: 0 };

  // personal: o notificare pe etapă
  const recipients = await staffRecipients().catch(() => [] as string[]);
  for (const stage of [...new Set(sent.map((s) => s.due.stage))].sort((a, b) => b - a)) {
    const group = sent.filter((s) => s.due.stage === stage).sort((a, b) => a.due.key.localeCompare(b.due.key) || a.due.name.localeCompare(b.due.name, "ro"));
    const noReach = group.filter((s) => s.email !== "sent" && s.sms !== "sent").length;
    const lines = group.slice(0, 10).map((s) => `• ${s.due.name} — ${fmt(s.due.key)}${s.email === "sent" || s.sms === "sent" ? "" : " (nu are email / telefon: sună-l)"}`);
    if (group.length > 10) lines.push(`… și încă ${group.length - 10}`);
    const reached = group.length - noReach;
    await notifyUsers(recipients, {
      title: group.length === 1 ? `📄 Contractul lui ${group[0].due.name} expiră în ${stage} zile` : `📄 ${group.length} contracte expiră în ${stage} zile`,
      body: `${lines.join("\n")}\n\nAnunțați automat (email / SMS): ${reached}${noReach ? ` · de contactat personal: ${noReach}` : ""}.`,
      url: `/platitori?contractExp=${stage}d`,
    }).catch((e) => console.error("[contract] notificarea personalului:", e));
  }
  return { due: due.length, notified: sent.length };
}
