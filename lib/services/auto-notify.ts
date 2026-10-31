import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { effectiveChannels, sanitizeAutoNotify, type AutoNotifyKind, type AutoNotifySettings } from "../auto-notify";
import { resolveIssueMessages, type IssueMessages } from "../issue-messages";

/** Setările notificărilor automate către clienți (Setări → „Notificări automate către clienți”), cu valorile implicite pentru ce nu e salvat. */
export async function getAutoNotify(): Promise<AutoNotifySettings> {
  if (DEMO) return sanitizeAutoNotify(null);
  const row = await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { autoNotify: true } }).catch(() => null);
  return sanitizeAutoNotify(row?.autoNotify);
}

/** Canalele către care se trimite automat un tip de notificare (email / SMS). */
export async function autoChannels(kind: AutoNotifyKind): Promise<{ email: boolean; sms: boolean }> {
  return effectiveChannels((await getAutoNotify())[kind]);
}

/** Mesajele automate pentru termenele neregulilor: textele implicite, cu modificările salvate din „Nereguli contoare” peste ele. */
export async function getIssueMessages(): Promise<IssueMessages> {
  if (DEMO) return resolveIssueMessages(null);
  const row = await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { issueMessages: true } }).catch(() => null);
  return resolveIssueMessages(row?.issueMessages);
}
