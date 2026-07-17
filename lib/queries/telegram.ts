import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";

export type PendingTelegramContact = {
  id: string;
  telegramUserId: string;
  chatId: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  requestedAt: Date;
};

/**
 * Contacte Telegram care au apăsat /start dar nu au încă un profil CRM (userId nul).
 * Notă: filtrăm în JS, nu cu `where: { userId: null }` — pe MongoDB acel filtru nu se
 * potrivește cu documentele unde câmpul e pur și simplu absent (vezi schema.prisma).
 */
export async function pendingTelegramContacts(): Promise<PendingTelegramContact[]> {
  if (DEMO) return [];
  const rows = await prisma.telegramAccount.findMany({
    select: {
      id: true,
      telegramUserId: true,
      chatId: true,
      username: true,
      firstName: true,
      lastName: true,
      linkedAt: true,
      userId: true,
    },
    orderBy: { linkedAt: "desc" },
  });
  return rows
    .filter((r) => !r.userId)
    .map((r) => ({
      id: r.id,
      telegramUserId: r.telegramUserId,
      chatId: r.chatId,
      username: r.username,
      firstName: r.firstName,
      lastName: r.lastName,
      requestedAt: r.linkedAt,
    }));
}
