import "server-only";
import { prisma } from "../prisma";
import { cachedForClient } from "../portal-cache";
import { listPortalMeters } from "./portal-meters";
import type { PortalMeterDto } from "../portal-meters";

/** O factură așa cum o vede clientul în portal (doar text și numere: trece direct către componenta din browser). */
export type PortalInvoiceItem = {
  id: string;
  number: string;
  status: string;
  grandTotal: number;
  currency: string;
  /** ISO */
  issue: string;
  due: string | null;
  token: string;
};

export type PortalHome = { invoices: PortalInvoiceItem[]; period: string; meters: PortalMeterDto[] };

/**
 * Tot ce arată pagina principală a portalului pentru un client: facturile (fără ciorne — rămân interne) și contoarele cu citirile lor.
 * Ținut câteva secunde în memorie (lib/portal-cache.ts) și golit la orice scriere care îl privește: pe un acces repetat nu se atinge baza de date.
 */
export function getPortalHome(clientId: string): Promise<PortalHome> {
  return cachedForClient("home", clientId, async () => {
    const [invoices, meters] = await Promise.all([
      prisma.invoice.findMany({
        where: { clientId, status: { not: "DRAFT" } },
        orderBy: { issueDate: "desc" },
        select: { id: true, number: true, status: true, grandTotal: true, currency: true, issueDate: true, dueDate: true, publicToken: true },
      }),
      listPortalMeters(clientId).catch((e) => {
        console.error("[portal] contoarele plătitorului:", e);
        return { period: "", meters: [] as PortalMeterDto[] };
      }),
    ]);
    return {
      invoices: invoices.map((i) => ({
        id: i.id,
        number: i.number,
        status: i.status,
        grandTotal: i.grandTotal,
        currency: i.currency,
        issue: i.issueDate.toISOString(),
        due: i.dueDate ? i.dueDate.toISOString() : null,
        token: i.publicToken,
      })),
      period: meters.period,
      meters: meters.meters,
    };
  });
}
