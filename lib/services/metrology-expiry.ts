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
import { METROLOGY_STAGES, METROLOGY_YEARS, metrologyDate, metrologyDueKey, metrologyKey, metrologyStage, metrologyStageKey, daysUntil, type MetrologyStage } from "../metrology";
import { filteredAdminRecipients, notifyUsers } from "./notifications";
import { getMeterSnap } from "./meter-cache";
import { recomputeAllMetrology } from "./metrology-admin";
import { autoChannels } from "./auto-notify";

/**
 * Notificările de expirare a verificării metrologice (data ultimei verificări o introduce personalul, per contor; scadența = + 5 ani): cu 60, 30 și 10 zile înainte, atât către
 * plătitor (email + SMS, dacă are și canalul e configurat — UN mesaj pe plătitor și etapă, cu toate contoarele lui care ajung la scadență), cât și către personal (o singură
 * notificare pe etapă, cu lista contoarelor și cine n-are cum fi anunțat). Ca la expirarea contractului: fiecare etapă pleacă o singură dată pentru o anumită scadență — se
 * „revendică” atomic în `MeterMetrology.notified` (ex. „2031-05-01:60”) ÎNAINTE de trimitere, deci nu se dublează între temporizator și cron; o dată nouă reia etapele; nu se
 * trimite în orele de liniște; contoarele scoase din uz nu se anunță. Dacă data se introduce când mai sunt ≤ 10 zile, pleacă doar etapa de 10 zile.
 */

const ro = (s: string) => stripLatinDiacritics(s);
const fmt = (key: string) => key.split("-").reverse().join(".");
const whenRo = (d: number) => (d <= 0 ? "astăzi" : d === 1 ? "mâine" : `peste ${d} zile`);
const whenRu = (d: number) => (d <= 0 ? "сегодня" : d === 1 ? "завтра" : `через ${d} дн.`);

type MeterDue = { meterId: string; contor: string; key: string; days: number };

/** Mesajul către plătitor: email în română și rusă (clienții vorbesc ambele), SMS scurt în română, fără diacritice. */
export function metrologyMessages(name: string, meters: { contor: string; key: string }[], days: number, company: string) {
  const co = company || "Apă-Canal";
  const many = meters.length > 1;
  const listRo = meters.map((m) => `• contor nr. ${m.contor} — ${fmt(m.key)}`).join("\n");
  const listRu = meters.map((m) => `• счётчик № ${m.contor} — ${fmt(m.key)}`).join("\n");
  const first = meters[0];
  return {
    subject: `Verificarea metrologică a contorului expiră ${whenRo(days)} / Срок метрологической поверки счётчика истекает ${whenRu(days)}`,
    emailBody:
      `Stimate(ă) ${name},\n\nVă informăm că verificarea metrologică ${many ? "a contoarelor dumneavoastră expiră" : `a contorului nr. ${first.contor} expiră`} (${whenRo(days)}):\n${listRo}\n\n` +
      `Verificarea metrologică se repetă la fiecare ${METROLOGY_YEARS} ani. Vă rugăm să ne contactați din timp, pentru a programa verificarea.\n\nCu respect,\n${co}\n\n— — —\n\n` +
      `Уважаемый(ая) ${name},\n\nСообщаем, что срок метрологической поверки ${many ? "ваших счётчиков истекает" : `вашего счётчика № ${first.contor} истекает`} (${whenRu(days)}):\n${listRu}\n\n` +
      `Метрологическая поверка проводится каждые ${METROLOGY_YEARS} лет. Пожалуйста, свяжитесь с нами заблаговременно, чтобы назначить поверку.\n\nС уважением,\n${co}`,
    sms: ro(
      many
        ? `${co}: verificarea metrologica a ${meters.length} contoare expira in curand (cel mai devreme ${fmt(first.key)}). Contactati-ne pentru programare.`
        : `${co}: verificarea metrologica a contorului ${first.contor} expira la ${fmt(first.key)} (${whenRo(days)}). Contactati-ne pentru programare.`,
    ),
  };
}

let lastRun = 0;
let lastRecompute = 0;
const MIN_GAP_MS = 25 * 60_000;
const RECOMPUTE_GAP_MS = 6 * 60 * 60_000;

type Group = { clientId: string | null; stage: MetrologyStage; meters: MeterDue[] };
type Sent = { group: Group; name: string; email: "sent" | "failed" | "none"; sms: "sent" | "failed" | "none" };

const errText = (e: unknown) => (e instanceof Error ? e.message : "Eroare necunoscută").slice(0, 200);

/** Staff: administratorii (cu setările lor de notificări) și utilizatorii care pot edita plătitori sau administra contoare. */
async function staffRecipients(): Promise<string[]> {
  const [admins, users] = await Promise.all([
    filteredAdminRecipients({ eventKeys: ["payer.metrology"] }),
    prisma.user.findMany({ where: { isActive: true, role: { not: "ADMIN" } }, select: { id: true, role: true, permissions: true } }),
  ]);
  const editors = users.filter((u) => can(u, "payers.edit") || can(u, "meters.manage")).map((u) => u.id);
  return [...new Set([...admins, ...editors])];
}

/** „YYYY-MM-DD” cu METROLOGY_YEARS ani în urmă (29 februarie → 28 februarie). */
const yearsBack = (key: string) => {
  const y = Number(key.slice(0, 4)) - METROLOGY_YEARS;
  return `${y}-${key.slice(5) === "02-29" ? "02-28" : key.slice(5)}`;
};

export async function checkMetrologyExpiry(opts: { force?: boolean } = {}): Promise<{ due: number; notified: number }> {
  if (DEMO) return { due: 0, notified: 0 };
  const now = new Date();
  if (!opts.force && now.getTime() - lastRun < MIN_GAP_MS) return { due: 0, notified: 0 };
  lastRun = now.getTime();

  // scadențele plătitorilor depind de contoarele active (cele scoase la sincronizarea 1C nu mai contează): le reluăm din când în când
  if (opts.force || now.getTime() - lastRecompute > RECOMPUTE_GAP_MS) {
    lastRecompute = now.getTime();
    await recomputeAllMetrology().catch((e) => console.error("[metrologie] recalcularea scadențelor:", e));
  }

  const today = todayKey(DEFAULT_TZ);
  const maxStage = Math.max(...METROLOGY_STAGES);
  // scadența = verificare + 5 ani ⇒ verificările care ajung la scadență în următoarele 60 de zile (± 2 zile de rezervă; filtrăm exact mai jos)
  const lo = yearsBack(addDaysToKey(today, -2));
  const hi = yearsBack(addDaysToKey(today, maxStage + 2));
  const candidates = await prisma.meterMetrology.findMany({
    where: { verifiedAt: { gte: metrologyDate(lo), lte: metrologyDate(hi) } },
    select: { id: true, meterId: true, contor: true, clientId: true, verifiedAt: true, notified: true },
    take: 5000,
  });
  if (candidates.length === 0) return { due: 0, notified: 0 };

  const snap = await getMeterSnap();
  const live = new Map(snap.rows.map((r) => [r.id, r] as const));
  const due: (MeterDue & { id: string; clientId: string | null; verifiedKey: string; stage: MetrologyStage })[] = [];
  for (const c of candidates) {
    const verifiedKey = metrologyKey(c.verifiedAt);
    const row = live.get(c.meterId);
    if (!verifiedKey || !row || row.removedAt) continue; // contor scos din uz sau dispărut din 1C: nu-l anunțăm
    const key = metrologyDueKey(verifiedKey);
    const days = daysUntil(key, today);
    const stage = metrologyStage(days);
    if (!stage || (c.notified ?? []).includes(metrologyStageKey(key, stage))) continue;
    due.push({ id: c.id, meterId: c.meterId, contor: c.contor, key, days, clientId: row.clientId ?? c.clientId, verifiedKey, stage });
  }
  if (due.length === 0) return { due: 0, notified: 0 };
  // orele de liniște: nu trimitem acum; nimic nu e revendicat, deci se reia la următoarea verificare
  if (isQuietTime(now, await getQuietHoursSettings())) return { due: due.length, notified: 0 };

  // revendicare atomică, pe contor: doar cine adaugă etapa (încă lipsă, pe aceeași dată de verificare) trimite
  const claimed: typeof due = [];
  for (const d of due) {
    const sk = metrologyStageKey(d.key, d.stage);
    const res = await prisma.meterMetrology.updateMany({
      where: { id: d.id, verifiedAt: metrologyDate(d.verifiedKey), NOT: { notified: { has: sk } } },
      data: { notified: { push: sk } },
    });
    if (res.count > 0) claimed.push(d);
  }
  if (claimed.length === 0) return { due: due.length, notified: 0 };
  const unclaim = async (list: typeof due) => {
    for (const d of list) {
      const cur = await prisma.meterMetrology.findUnique({ where: { id: d.id }, select: { notified: true } });
      const sk = metrologyStageKey(d.key, d.stage);
      await prisma.meterMetrology.update({ where: { id: d.id }, data: { notified: (cur?.notified ?? []).filter((x) => x !== sk) } }).catch(() => {});
    }
  };

  // un mesaj pe plătitor și etapă
  const groups = new Map<string, Group & { items: typeof due }>();
  for (const d of claimed) {
    const gk = `${d.clientId ?? "-"}:${d.stage}`;
    const g = groups.get(gk) ?? { clientId: d.clientId, stage: d.stage, meters: [], items: [] };
    g.meters.push({ meterId: d.meterId, contor: d.contor, key: d.key, days: d.days });
    g.items.push(d);
    groups.set(gk, g);
  }
  const clientIds = [...new Set([...groups.values()].map((g) => g.clientId).filter((x): x is string => !!x))];
  const clients = clientIds.length ? await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true, email: true, phone: true } }) : [];
  const clientBy = new Map(clients.map((c) => [c.id, c] as const));
  const company = (await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { companyName: true } }))?.companyName ?? "";

  const chan = await autoChannels("metrology"); // din Setări: pornit / oprit, email, SMS
  const sent: Sent[] = [];
  const logs: { campaignId: string; clientId: string; clientName: string; channel: string; to: string; status: string; error: string | null; subject: string | null; body: string; userName: string }[] = [];

  for (const g of groups.values()) {
    const client = g.clientId ? clientBy.get(g.clientId) : undefined;
    const sortedMeters = [...g.meters].sort((a, b) => a.key.localeCompare(b.key) || a.contor.localeCompare(b.contor));
    const res: Sent = { group: { ...g, meters: sortedMeters }, name: client?.name ?? sortedMeters[0].contor, email: "none", sms: "none" };
    if (client) {
      const days = Math.min(...sortedMeters.map((m) => m.days));
      const msg = metrologyMessages(client.name, sortedMeters, days, company);
      const campaignId = `metrology-${g.stage}-${today}`;
      const base = { campaignId, clientId: client.id, clientName: client.name, userName: "Automat · verificare metrologică" };
      const dmeta = { kind: "payer.metrology", campaignId, toClientId: client.id, toName: client.name, objectType: "client", objectId: client.id };
      const email = client.email?.trim() ?? "";
      if (chan.email && isEmail(email) && env.smtp.enabled) {
        try {
          await withDeliveryMeta(dmeta, () => sendPayerNotificationEmail({ to: email, subject: msg.subject, body: msg.emailBody, companyName: company || null, deliveryKind: "payer.metrology" }));
          res.email = "sent";
          logs.push({ ...base, channel: "EMAIL", to: email, status: "SENT", error: null, subject: msg.subject, body: msg.emailBody });
        } catch (e) {
          res.email = "failed";
          logs.push({ ...base, channel: "EMAIL", to: email, status: "FAILED", error: errText(e), subject: msg.subject, body: msg.emailBody });
        }
      }
      const phone = normalizePhone(client.phone);
      if (chan.sms && phone && env.sms.enabled) {
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
        await unclaim(g.items);
        continue;
      }
    }
    sent.push(res);
  }

  if (logs.length) await prisma.payerNotificationLog.createMany({ data: logs }).catch((e) => console.error("[metrologie] jurnal:", e));
  if (sent.length === 0) return { due: due.length, notified: 0 };

  // personal: o notificare pe etapă
  const recipients = await staffRecipients().catch(() => [] as string[]);
  for (const stage of [...new Set(sent.map((s) => s.group.stage))].sort((a, b) => b - a)) {
    const part = sent.filter((s) => s.group.stage === stage);
    const lines: string[] = [];
    let total = 0;
    let noReach = 0;
    for (const s of part.sort((a, b) => a.group.meters[0].key.localeCompare(b.group.meters[0].key) || a.name.localeCompare(b.name, "ro"))) {
      const reached = s.email === "sent" || s.sms === "sent";
      for (const m of s.group.meters) {
        total++;
        if (!reached) noReach++;
        lines.push(`• ${m.contor} — ${s.group.clientId ? s.name : "fără plătitor legat"} — ${fmt(m.key)}${reached ? "" : s.group.clientId ? " (nu are email / telefon: sună-l)" : ""}`);
      }
    }
    const shown = lines.slice(0, 10);
    if (lines.length > 10) shown.push(`… și încă ${lines.length - 10}`);
    await notifyUsers(recipients, {
      title: total === 1 ? `🔧 Verificarea metrologică a contorului ${part[0].group.meters[0].contor} expiră în ${stage} zile` : `🔧 ${total} contoare au verificarea metrologică ce expiră în ${stage} zile`,
      body: `${shown.join("\n")}\n\nAnunțați automat (email / SMS): ${total - noReach}${noReach ? ` · de contactat personal: ${noReach}` : ""}.`,
      url: `/contoare?metrology=${stage}d`,
    }).catch((e) => console.error("[metrologie] notificarea personalului:", e));
  }
  return { due: due.length, notified: sent.reduce((n, s) => n + s.group.meters.length, 0) };
}
