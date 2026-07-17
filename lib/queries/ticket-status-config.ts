import "server-only";
import { prisma } from "@/lib/prisma";
import { parseStatusConfigs, type StatusConfig } from "@/lib/ticket-status-config";

export async function loadStatusConfigs(): Promise<StatusConfig[]> {
  const settings = await prisma.companySettings.findFirst({
    where: { singleton: "main" },
    select: { ticketStatusConfig: true },
  });
  return parseStatusConfigs(settings?.ticketStatusConfig);
}
