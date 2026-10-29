import "server-only";
import { prisma } from "../prisma";
import type { PayerTemplateData } from "../task-template";

const OID = /^[0-9a-f]{24}$/i;
const money = (n: number, cur = "MDL") => `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
const pretty = (p: string | null | undefined) => (p ? (p.replace(/\s+/g, "").startsWith("373") ? `+${p.replace(/\s+/g, "")}` : p) : null);

/**
 * Datele plătitorului pentru variabilele șabloanelor ({nume}, {telefon}, {adresa}, {cont}, {datorie}, …). `phone` = numărul de pe care sună (are prioritate față de cel din fișă).
 * null dacă plătitorul nu există. Valorile lipsă rămân null (în text devin „—").
 */
export async function loadPayerTemplateData(clientId: string | undefined | null, phone?: string | null): Promise<PayerTemplateData | null> {
  if (!clientId || !OID.test(clientId)) return null;
  const c = await prisma.client
    .findUnique({
      where: { id: clientId },
      select: { name: true, phone: true, email: true, meterSeries: true, consumAddress: true, meterNumber: true, meterCurrReading: true, lastInvoiceGrandTotal: true, lastInvoiceStatus: true, lastInvoiceSectorNr: true },
    })
    .catch(() => null);
  if (!c) return null;
  const last = await prisma.invoice.findFirst({ where: { clientId, status: { not: "DRAFT" } }, orderBy: { issueDate: "desc" }, select: { number: true, currency: true } }).catch(() => null);
  const owes = c.lastInvoiceStatus === "SENT" || c.lastInvoiceStatus === "OVERDUE";
  return {
    nume: c.name || null,
    telefon: pretty(phone) ?? pretty(c.phone),
    adresa: c.consumAddress?.trim() || null,
    cont: c.meterSeries,
    email: c.email,
    datorie: c.lastInvoiceGrandTotal == null ? null : money(owes ? c.lastInvoiceGrandTotal : 0, last?.currency ?? "MDL"),
    factura: last?.number ?? null,
    nr_contor: c.meterNumber,
    index: c.meterCurrReading == null ? null : String(c.meterCurrReading).replace(".", ","),
    sector: c.lastInvoiceSectorNr,
  };
}
