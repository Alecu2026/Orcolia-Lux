import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getCompanySettings } from "@/lib/queries/company";

const TARIF_APA = 23;
const TARIF_CANAL = 7;
const LUNI_RO = [
  "IANUARIE", "FEBRUARIE", "MARTIE", "APRILIE", "MAI", "IUNIE",
  "IULIE", "AUGUST", "SEPTEMBRIE", "OCTOMBRIE", "NOIEMBRIE", "DECEMBRIE",
];

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function genToken(): string {
  return randomBytes(18).toString("base64url");
}

async function genNumber(prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const count = await prisma.invoice.count({ where: { createdAt: { gte: start, lt: end } } });
  let n = count + 1;
  let number = `${prefix}-${year}-${String(n).padStart(4, "0")}`;
  while (await prisma.invoice.findUnique({ where: { number }, select: { id: true } })) {
    n++;
    number = `${prefix}-${year}-${String(n).padStart(4, "0")}`;
  }
  return number;
}

/**
 * Prima factură Apă-Canal, generată automat exact când clientul își activează contul din
 * portal (vezi confirmClientRegistration). Indicele precedent e mereu 0 — nu avem o citire
 * anterioară reală (un singur instantaneu Axioma la import) — vezi scripts/import-axioma-water-meters.mjs
 * pentru originea meterNumber/meterCurrReading/consumAddress salvate pe Client.
 *
 * No-op (silent) dacă clientul nu are un instantaneu de contor (nu vine din Axioma) sau
 * dacă are deja cel puțin o factură — best-effort, nu trebuie să blocheze înregistrarea.
 */
export async function generateFirstApaCanalInvoice(clientId: string): Promise<void> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      id: true,
      userId: true,
      name: true,
      meterSeries: true,
      meterNumber: true,
      meterCurrReading: true,
      meterReadingEstimated: true,
      consumAddress: true,
    },
  });
  if (!client?.meterNumber || client.meterCurrReading == null) return;

  const existing = await prisma.invoice.count({ where: { clientId } });
  if (existing > 0) return;

  const company = await getCompanySettings();
  const prefix = company.invoicePrefix || "INV";
  const currency = company.currency || "MDL";

  const now = new Date();
  const consum = round2(client.meterCurrReading);
  const apaSubtotal = round2(consum * TARIF_APA);
  const canalSubtotal = round2(consum * TARIF_CANAL);
  const subtotal = round2(apaSubtotal + canalSubtotal);
  const number = await genNumber(prefix);

  await prisma.invoice.create({
    data: {
      number,
      status: "SENT",
      kind: "APA_CANAL",
      issueDate: now,
      clientId: client.id,
      userId: client.userId,
      currency,
      subtotal,
      taxTotal: 0,
      grandTotal: subtotal,
      publicToken: genToken(),
      contPersonal: client.meterSeries,
      consumAddress: client.consumAddress,
      consumerName: client.name,
      meterNumber: client.meterNumber,
      meterPrevReading: "0",
      meterCurrReading: String(consum),
      isEstimatedVolume: client.meterReadingEstimated,
      billingPeriodLabel: `${LUNI_RO[now.getMonth()]} ${now.getFullYear()}`,
      recalculari: 0,
      penalitati: 0,
      datoriiAvans: 0,
      monthlyConsumption: [{ label: String(now.getMonth() + 1), value: consum }],
      items: {
        create: [
          {
            description: "Serviciul de alimentare cu apa",
            quantity: consum,
            unitPrice: TARIF_APA,
            taxRate: 0,
            lineSubtotal: apaSubtotal,
            lineTotal: apaSubtotal,
            position: 0,
          },
          {
            description: "Serviciul de canalizare",
            quantity: consum,
            unitPrice: TARIF_CANAL,
            taxRate: 0,
            lineSubtotal: canalSubtotal,
            lineTotal: canalSubtotal,
            position: 1,
          },
        ],
      },
    },
  });
}
