"use server";

import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireClient } from "@/lib/client-dal";
import { filteredAdminRecipients, notifyUsers, observerRecipients } from "@/lib/services/notifications";
import { auditPortalAction } from "@/lib/services/impersonation";
import { DEFAULT_PORTAL_TEMPLATES, PETITION_MIN_CHARS, PORTAL_REQUEST_MAX_ADDRESS, PORTAL_REQUEST_MAX_CONSUMER, isPetitionName } from "@/lib/portal-default-templates";

export type PortalTicketState = { ok?: boolean; error?: string } | undefined;

/**
 * Tichet creat de un client din portal — oglindă fluxul „tichet venit prin email"
 * (lib/services/email-ticket.ts): creatorId e primul admin activ (clientul nu e un User),
 * fără assignee/team (rămâne NEW, nealocat), notificare broadcast la toți adminii calificați.
 */
export async function createPortalTicket(
  _prev: PortalTicketState,
  formData: FormData,
): Promise<PortalTicketState> {
  const client = await requireClient();

  const title = String(formData.get("title") ?? "").trim();
  // browserul trimite textul cu CRLF: se normalizează (altfel nu s-ar mai recunoaște punctul de pornire al petiției)
  const description = String(formData.get("description") ?? "").replace(/\r\n/g, "\n").trim();
  if (!title) return { error: "Titlul e obligatoriu." };
  // datele cererii: adresa și numele consumatorului sunt obligatorii; data depunerii se pune automat (momentul creării), data executării o completează echipa
  const address = String(formData.get("address") ?? "").replace(/\s+/g, " ").trim().slice(0, PORTAL_REQUEST_MAX_ADDRESS);
  const consumerName = String(formData.get("consumerName") ?? "").replace(/\s+/g, " ").trim().slice(0, PORTAL_REQUEST_MAX_CONSUMER);
  if (!address) return { error: "Adresa este obligatorie." };
  if (!consumerName) return { error: "Numele consumatorului este obligatoriu." };
  // petiția: textul (peste punctul de pornire din șablon) nu poate lipsi
  // secția responsabilă vine din șablon, citit aici pe server (nu din formular): clientul nu poate alege cine primește cererea
  const templateId = String(formData.get("templateId") ?? "");
  let sectionId: string | null = null;
  if (/^[0-9a-f]{24}$/i.test(templateId)) {
    const tpl = await prisma.portalRequestTemplate.findUnique({ where: { id: templateId }, select: { name: true, teamId: true } });
    sectionId = tpl?.teamId ?? null;
    if (tpl && isPetitionName(tpl.name)) {
      const starter = DEFAULT_PORTAL_TEMPLATES.find((x) => isPetitionName(x.name))?.description.trim() ?? "";
      const body = description.startsWith(starter) ? description.slice(starter.length) : description;
      if (body.trim().length < PETITION_MIN_CHARS) return { error: "Scrie textul petiției (cel puțin 20 de caractere)." };
    }
  }

  const team = sectionId ? await prisma.team.findUnique({ where: { id: sectionId }, select: { id: true, name: true, memberIds: true } }) : null;

  const systemUser = await prisma.user.findFirst({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  if (!systemUser) return { error: "Eroare internă — te rugăm încearcă mai târziu." };

  const counter = await prisma.counter.upsert({
    where: { name: "task-seq" },
    create: { name: "task-seq", value: 1 },
    update: { value: { increment: 1 } },
    select: { value: true },
  });

  const ticket = await prisma.task.create({
    data: {
      seq: counter.value,
      type: "TICKET",
      title,
      description: description || null,
      // atribuită secției responsabile (dacă șablonul are una), altfel rămâne nouă și nealocată
      status: team ? "ASSIGNED" : "NEW",
      priority: "MEDIUM",
      creatorId: systemUser.id,
      ...(team ? { teamId: team.id } : {}),
      clientId: client.id,
      address,
      consumerName,
      // Solicitantul real (clientul nu e utilizator): apare la „Creat de” în loc de administratorul-substitut.
      fromName: client.name,
      fromEmail: client.email ?? null,
    },
    select: { id: true, seq: true },
  });

  after(async () => {
    try {
      // Cerere dintr-un șablon cu secție: doar membrii activi ai acelei secții. Dacă secția n-are (încă) persoane, ca să nu se piardă cererea, o primesc administratorii.
      // Cerere fără secție (inclusiv „Altă cerere”): administratorii (după setările lor) + oricine a bifat „Tichet nou din portal”.
      const members = team ? (await prisma.user.findMany({ where: { id: { in: team.memberIds }, isActive: true }, select: { id: true } })).map((u) => u.id) : [];
      const ids = members.length > 0 ? members : [...new Set([...(await filteredAdminRecipients({ eventKeys: ["ticket.portal"] })), ...(await observerRecipients("ticket.portal"))])];
      if (ids.length) {
        await notifyUsers(
          ids,
          {
            title: `📨 Cerere nouă de la ${client.name}: ${title}`,
            body: `${team ? `Secția: ${team.name}\n` : ""}Adresă: ${address}\nConsumator: ${consumerName}`,
            url: `/tickets/${ticket.id}`,
            taskId: ticket.id,
            seq: ticket.seq,
          },
          { telegram: true },
        );
      }
    } catch (e) {
      console.error("[portal] eșec notificare tichet nou:", e);
    }
  });

  await auditPortalAction(`cerere nouă „${title}”`, ticket.id);
  return { ok: true };
}
