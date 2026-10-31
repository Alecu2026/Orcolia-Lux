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
import { contractDate, contractKey, daysUntil } from "../contract-expiry";
import { ISSUE_LABELS, isIssueKind, type IssueKind } from "../meter-issues";
import { issueMessageVars, renderIssueTemplate } from "../issue-messages";
import { filteredAdminRecipients, notifyUsers } from "./notifications";
import { getMeterSnap } from "./meter-cache";
import { autoChannels, getIssueMessages } from "./auto-notify";
import { recomputeAllClientIssues } from "./meter-issues";

/**
 * Termenele de remediere ale neregulilor de contor. Fiecare neregulă deschisă are un termen (din regula tipului sau corectat de birou). Cu 3 zile înainte și la depășire:
 *  • dacă răspunde CLIENTUL — el primește email (română + rusă) și SMS, un singur mesaj pe etapă cu toate neregulile lui; personalul e anunțat doar la depășire;
 *  • dacă răspunde COMPANIA (sau e „de stabilit”) — nu se trimite nimic clientului; personalul e anunțat și înainte de termen, și la depășire.
 * Personalul = membrii secției responsabile (dacă e setată) + administratorii (după setările lor de notificări); fără secție: administratorii și cei cu drept „administrare contoare”.
 * Ca la contract / verificarea metrologică: fiecare etapă pleacă o singură dată pentru un termen (revendicată atomic în `MeterIssue.dueNotified`, ex. „2026-11-10:3”), nu se
 * trimite în orele de liniște, iar un termen nou reia etapele. Trimiterile către client apar în Jurnalul de notificări (tip „Neregulă de contor: termen de remediere”).
 */

const ro = (s: string) => stripLatinDiacritics(s);
const fmt = (key: string) => key.split("-").reverse().join(".");

let lastRun = 0;
let lastRecompute = 0;
const MIN_GAP_MS = 25 * 60_000;
const errText = (e: unknown) => (e instanceof Error ? e.message : "Eroare necunoscută").slice(0, 200);

type Claimed = { id: string; meterId: string; contor: string; kind: IssueKind; responsible: string | null; teamId: string | null; key: string; days: number; stage: 0 | 3; clientId: string | null; name: string; sk: string };

export async function checkMeterIssueDeadlines(opts: { force?: boolean } = {}): Promise<{ due: number; notified: number }> {
  if (DEMO) return { due: 0, notified: 0 };
  const now = new Date();
  if (!opts.force && now.getTime() - lastRun < MIN_GAP_MS) return { due: 0, notified: 0 };
  lastRun = now.getTime();

  if (opts.force || now.getTime() - lastRecompute > 6 * 60 * 60_000) {
    lastRecompute = now.getTime();
    await recomputeAllClientIssues().catch((e) => console.error("[nereguli] recalcularea pe plătitori:", e));
  }

  const today = todayKey(DEFAULT_TZ);
  const rows = await prisma.meterIssue.findMany({
    // `not: null`: pe MongoDB filtrul `lte` al lui Prisma potrivește și documentele cu câmpul null
    where: { resolvedAt: null, dueAt: { not: null, lte: contractDate(addDaysToKey(today, 3)) } },
    select: { id: true, meterId: true, contor: true, kind: true, responsible: true, teamId: true, dueAt: true, dueNotified: true },
    take: 3000,
  });
  const snap = rows.length ? await getMeterSnap() : null;
  const live = new Map((snap?.rows ?? []).map((r) => [r.id, r] as const));
  const due: Claimed[] = [];
  for (const r of rows) {
    const key = contractKey(r.dueAt);
    if (!key) continue;
    const days = daysUntil(key, today);
    const stage: 0 | 3 = days < 0 ? 0 : 3;
    const sk = `${key}:${stage}`;
    if ((r.dueNotified ?? []).includes(sk)) continue;
    const m = live.get(r.meterId);
    due.push({ id: r.id, meterId: r.meterId, contor: r.contor, kind: isIssueKind(r.kind) ? r.kind : "OTHER", responsible: r.responsible, teamId: r.teamId, key, days, stage, clientId: m?.clientId ?? null, name: m?.name ?? "—", sk });
  }
  if (due.length === 0) return { due: 0, notified: 0 };
  if (isQuietTime(now, await getQuietHoursSettings())) return { due: due.length, notified: 0 };

  // revendicare atomică, pe neregulă: doar cine adaugă etapa (încă lipsă, pe același termen) trimite
  const claimed: Claimed[] = [];
  for (const d of due) {
    const res = await prisma.meterIssue.updateMany({
      where: { id: d.id, resolvedAt: null, dueAt: contractDate(d.key), NOT: { dueNotified: { has: d.sk } } },
      data: { dueNotified: { push: d.sk } },
    });
    if (res.count > 0) claimed.push(d);
  }
  if (claimed.length === 0) return { due: due.length, notified: 0 };
  const unclaim = async (list: Claimed[]) => {
    for (const d of list) {
      const cur = await prisma.meterIssue.findUnique({ where: { id: d.id }, select: { dueNotified: true } });
      await prisma.meterIssue.update({ where: { id: d.id }, data: { dueNotified: (cur?.dueNotified ?? []).filter((x) => x !== d.sk) } }).catch(() => {});
    }
  };

  // ── clientul (doar când el răspunde): un mesaj pe client și etapă ──
  const failed = new Set<string>();
  const chan = await autoChannels("issue"); // din Setări: pornit / oprit, email, SMS
  const messages = await getIssueMessages();
  const clientGroups = new Map<string, Claimed[]>();
  for (const d of claimed) {
    if (d.responsible !== "CLIENT" || !d.clientId) continue;
    const gk = `${d.clientId}:${d.stage}`;
    (clientGroups.get(gk) ?? clientGroups.set(gk, []).get(gk)!).push(d);
  }
  if (clientGroups.size) {
    const clients = await prisma.client.findMany({ where: { id: { in: [...new Set([...clientGroups.values()].map((g) => g[0].clientId!))] } }, select: { id: true, name: true, email: true, phone: true } });
    const by = new Map(clients.map((c) => [c.id, c] as const));
    const company = (await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { companyName: true } }))?.companyName ?? "";
    const logs: { campaignId: string; clientId: string; clientName: string; channel: string; to: string; status: string; error: string | null; subject: string | null; body: string; userName: string }[] = [];
    for (const g of clientGroups.values()) {
      const c = by.get(g[0].clientId!);
      if (!c) continue;
      const stage = g[0].stage;
      const items = g.map((d) => ({ contor: d.contor, kind: d.kind, key: d.key, days: d.days })).sort((a, b) => a.key.localeCompare(b.key));
      // un singur mesaj pe client și etapă: șablonul tipului (o neregulă) sau șablonul comun (mai multe), din „Nereguli contoare” → Mesaje automate
      const { key: mk, vars } = issueMessageVars(c.name, company, items);
      const tpl = messages[mk][stage === 0 ? "overdue" : "before"];
      const msg = { subject: renderIssueTemplate(tpl.subject, vars).replace(/\s+/g, " ").trim(), emailBody: renderIssueTemplate(tpl.email, vars), sms: ro(renderIssueTemplate(tpl.sms, vars)) };
      const campaignId = `issue-${stage}-${today}`;
      const base = { campaignId, clientId: c.id, clientName: c.name, userName: "Automat · termen remediere neregulă" };
      const dmeta = { kind: "meter.issue_deadline", campaignId, toClientId: c.id, toName: c.name, objectType: "client", objectId: c.id };
      let emailSent = false, smsSent = false, attempted = false;
      const email = c.email?.trim() ?? "";
      if (chan.email && isEmail(email) && env.smtp.enabled) {
        attempted = true;
        try {
          await withDeliveryMeta(dmeta, () => sendPayerNotificationEmail({ to: email, subject: msg.subject, body: msg.emailBody, companyName: company || null, deliveryKind: "meter.issue_deadline" }));
          emailSent = true;
          logs.push({ ...base, channel: "EMAIL", to: email, status: "SENT", error: null, subject: msg.subject, body: msg.emailBody });
        } catch (e) {
          logs.push({ ...base, channel: "EMAIL", to: email, status: "FAILED", error: errText(e), subject: msg.subject, body: msg.emailBody });
        }
      }
      const phone = normalizePhone(c.phone);
      if (chan.sms && phone && env.sms.enabled) {
        attempted = true;
        try {
          await withDeliveryMeta(dmeta, () => sendSms(phone, msg.sms));
          smsSent = true;
          logs.push({ ...base, channel: "SMS", to: phone, status: "SENT", error: null, subject: null, body: msg.sms });
        } catch (e) {
          logs.push({ ...base, channel: "SMS", to: phone, status: "FAILED", error: errText(e), subject: null, body: msg.sms });
        }
      }
      // niciun canal n-a plecat deși existau (eroare temporară): etapa nu rămâne „făcută”, se reia la următoarea verificare
      if (attempted && !emailSent && !smsSent) {
        await unclaim(g);
        for (const d of g) failed.add(d.id);
      }
    }
    if (logs.length) await prisma.payerNotificationLog.createMany({ data: logs }).catch((e) => console.error("[nereguli] jurnal:", e));
  }

  // ── personalul ──
  const forStaff = claimed.filter((d) => !failed.has(d.id) && (d.stage === 0 || d.responsible !== "CLIENT"));
  if (forStaff.length) {
    const teamIds = [...new Set(forStaff.map((d) => d.teamId).filter((x): x is string => !!x))];
    const [teams, admins, managers] = await Promise.all([
      teamIds.length ? prisma.team.findMany({ where: { id: { in: teamIds } }, select: { id: true, memberIds: true } }) : Promise.resolve([]),
      filteredAdminRecipients({ eventKeys: ["meter.issue_deadline"], teamIds }).catch(() => [] as string[]),
      prisma.user.findMany({ where: { isActive: true, role: { not: "ADMIN" } }, select: { id: true, role: true, permissions: true } }).then((us) => us.filter((u) => can(u, "meters.manage")).map((u) => u.id)),
    ]);
    const members = new Map(teams.map((t) => [t.id, t.memberIds] as const));
    for (const stage of [3, 0] as const) {
      const part = forStaff.filter((d) => d.stage === stage);
      if (part.length === 0) continue;
      const byUser = new Map<string, Claimed[]>();
      for (const d of part) {
        const rec = new Set<string>(admins);
        if (d.teamId) for (const m of members.get(d.teamId) ?? []) rec.add(m);
        else for (const m of managers) rec.add(m);
        for (const u of rec) (byUser.get(u) ?? byUser.set(u, []).get(u)!).push(d);
      }
      for (const [uid, list] of byUser) {
        list.sort((a, b) => a.key.localeCompare(b.key) || a.contor.localeCompare(b.contor, "ro", { numeric: true }));
        const lines = list.slice(0, 10).map((d) => `• ${d.contor} — ${ISSUE_LABELS[d.kind]} — ${d.responsible === "CLIENT" ? "răspunde clientul" : d.responsible === "COMPANY" ? "răspunde compania" : "responsabil de stabilit"} — ${fmt(d.key)}${d.clientId ? ` (${d.name})` : ""}`);
        if (list.length > 10) lines.push(`… și încă ${list.length - 10}`);
        await notifyUsers([uid], {
          title: stage === 0
            ? (list.length === 1 ? `⏰ Termen depășit: neregulă la contorul ${list[0].contor}` : `⏰ ${list.length} nereguli de contor cu termenul de remediere depășit`)
            : (list.length === 1 ? `🔧 Se apropie termenul: neregulă la contorul ${list[0].contor}` : `🔧 ${list.length} nereguli de contor ajung la termenul de remediere`),
          body: lines.join("\n"),
          url: `/contoare/nereguli?due=${stage === 0 ? "overdue" : "7d"}`,
        }).catch((e) => console.error("[nereguli] notificarea personalului:", e));
      }
    }
  }
  return { due: due.length, notified: claimed.length - failed.size };
}
