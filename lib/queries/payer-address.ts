import "server-only";
import { prisma } from "../prisma";

/** Adresa de consum a unui plătitor (pentru completarea automată a „Adresă” la crearea unei sarcini din apel); undefined dacă nu există. */
export async function payerAddress(clientId: string | undefined): Promise<string | undefined> {
  if (!clientId || !/^[0-9a-f]{24}$/i.test(clientId)) return undefined;
  const c = await prisma.client.findUnique({ where: { id: clientId }, select: { consumAddress: true } }).catch(() => null);
  return c?.consumAddress?.trim().slice(0, 300) || undefined;
}
