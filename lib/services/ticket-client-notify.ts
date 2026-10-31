import "server-only";
import { after } from "next/server";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { env } from "../env";
import { sendTicketResolvedEmail } from "../email";

/**
 * Notificarea CLIENTULUI când cererea lui din portal e rezolvată: pe email (în română și rusă), cu linkul spre cerere în portal. Pleacă la fiecare trecere în
 * „Finalizat” (cererea executată; cu data executării, dacă există) sau „Anulat” (închisă fără execuție), indiferent de unde s-a schimbat statusul
 * (aplicație, tabel, notificări, Telegram). Doar pentru cererile create din portal: au client legat, nume de solicitant și nu vin dintr-un email
 * (cererile din email își au propriul fir de conversație). Dacă clientul n-are email sau SMTP nu e configurat, nu pleacă nimic (statusul rămâne vizibil în portal).
 */

export function isPortalTicket(t: { type: string; clientId: string | null; fromName: string | null; emailSource: boolean }): boolean {
  return t.type === "TICKET" && !!t.clientId && !!t.fromName && !t.emailSource;
}

/** Rulează după răspuns când suntem într-o cerere (serverless nu oprește funcția înainte), altfel imediat în fundal. */
function inBackground(fn: () => Promise<unknown>) {
  const safe = () => fn().catch((e) => console.error("[ticket-client-notify] eșec:", e));
  try {
    after(safe);
  } catch {
    void safe();
  }
}

export function notifyClientTicketClosed(taskId: string, outcome: "DONE" | "CANCELLED"): void {
  if (DEMO) return;
  inBackground(async () => {
    const t = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, seq: true, title: true, type: true, clientId: true, fromName: true, emailSource: true, executedAt: true, status: true, measuresTaken: true, resolutionMinutes: true },
    });
    if (!t || !isPortalTicket(t) || !t.clientId) return;
    // starea s-a schimbat între timp (redeschis imediat): nu mai trimitem „rezolvat”
    if (t.status !== outcome) return;
    const client = await prisma.client.findUnique({ where: { id: t.clientId }, select: { name: true, email: true } });
    if (!client?.email || !env.smtp.enabled) return;
    const company = await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { companyName: true } });
    await sendTicketResolvedEmail({
      to: client.email,
      clientName: client.name,
      ticketTitle: t.title,
      seq: t.seq,
      outcome,
      executedOn: t.executedAt ? t.executedAt.toISOString().slice(0, 10) : null,
      measures: t.measuresTaken,
      minutes: t.resolutionMinutes,
      url: `${env.appUrl.replace(/\/$/, "")}/portal/cereri/${t.id}`,
      companyName: company?.companyName,
    });
  });
}
