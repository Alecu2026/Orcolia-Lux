import Link from "next/link";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { invoiceProjectOptions } from "@/lib/queries/invoices";
import { getCompanySettings } from "@/lib/queries/company";
import { crmClientOptionsPlus } from "@/lib/queries/clients";
import { prisma } from "@/lib/prisma";
import InvoiceForm from "@/app/components/InvoiceForm";
import ApaCanalInvoiceForm, { type ApaCanalInitial } from "@/app/components/ApaCanalInvoiceForm";
import { IconChevronLeft, IconDroplet, IconFileText } from "@/app/components/icons";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

/**
 * Prefill "Trimite factură nouă" din pagina unui plătitor: identitate + adresă + contor din
 * Client, iar indicele precedent continuă din ultima factură a lui (dacă are una) — staff-ul
 * doar completează indicele actual nou.
 */
async function payerPrefill(clientId: string, currency: string): Promise<ApaCanalInitial | undefined> {
  const client = await prisma.client.findFirst({
    where: { id: clientId, meterSeries: { not: null } },
    select: { id: true, name: true, meterSeries: true, meterNumber: true, consumAddress: true },
  });
  if (!client) return undefined;

  const lastInvoice = await prisma.invoice.findFirst({
    where: { clientId, kind: "APA_CANAL" },
    orderBy: { issueDate: "desc" },
    select: { meterCurrReading: true },
  });

  return {
    id: "",
    status: "DRAFT",
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    clientId: client.id,
    currency,
    contPersonal: client.meterSeries ?? "",
    sectorNr: "",
    consumAddress: client.consumAddress ?? "",
    consumerName: client.name,
    meterNumber: client.meterNumber ?? "",
    meterPrevReading: lastInvoice?.meterCurrReading ?? "0",
    meterCurrReading: "",
    isEstimatedVolume: false,
    billingPeriodLabel: "",
    apaVolum: "",
    apaTarif: "",
    canalVolum: "",
    canalTarif: "",
    recalculari: "0",
    penalitati: "0",
    datoriiAvans: "0",
    monthlyConsumption: [],
  };
}

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; clientId?: string }>;
}) {
  const t = await getT();
  const user = await requirePermission("invoices.create");
  const { kind, clientId } = await searchParams;

  const backLink = (
    <Link href="/invoices" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
      <IconChevronLeft className="size-4" /> {t("Înapoi la facturi")}
    </Link>
  );

  if (kind !== "apa-canal" && kind !== "standard") {
    return (
      <div className="w-full">
        {backLink}
        <h1 className="mb-4 text-xl font-bold">{t("Factură nouă")}</h1>
        <p className="mb-4 text-sm text-ink-soft">{t("Alege tipul facturii pe care vrei să o creezi:")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/invoices/new?kind=standard"
            className="card tap flex flex-col items-start gap-2 p-5 hover:border-brand"
          >
            <IconFileText className="size-8 text-brand" />
            <span className="text-base font-bold">{t("Factură standard")}</span>
            <span className="text-sm text-ink-soft">{t("Rânduri libere, servicii sau produse, TVA — factura obișnuită.")}</span>
          </Link>
          <Link
            href="/invoices/new?kind=apa-canal"
            className="card tap flex flex-col items-start gap-2 p-5 hover:border-brand"
          >
            <IconDroplet className="size-8 text-brand" />
            <span className="text-base font-bold">{t("Factură Apă-Canal")}</span>
            <span className="text-sm text-ink-soft">{t("Formatul facturii de alimentare cu apă și canalizare (contor, consum, grafic).")}</span>
          </Link>
        </div>
      </div>
    );
  }

  // Doar clienții de CRM + cel din link (plătitorul, când vii din Plătitori → "Factură nouă"):
  // lista completă avea ~19.000 de opțiuni (~2,7 MB de HTML) și bloca telefonul.
  const [clients, projects, company] = await Promise.all([
    crmClientOptionsPlus(clientId),
    invoiceProjectOptions(),
    getCompanySettings(),
  ]);
  const initial = kind === "apa-canal" && clientId ? await payerPrefill(clientId, company.currency) : undefined;

  return (
    <div className="w-full">
      {backLink}
      <h1 className="mb-4 text-xl font-bold">
        {kind === "apa-canal" ? t("Factură Apă-Canal — nouă") : t("Factură standard — nouă")}
      </h1>
      {kind === "apa-canal" ? (
        <ApaCanalInvoiceForm
          initial={initial}
          clients={clients}
          currency={company.currency}
          canCreateClient={can(user, "clients.create")}
          defaultTarifApa={company.apaCanalTarifApa}
          defaultTarifCanal={company.apaCanalTarifCanal}
        />
      ) : (
        <InvoiceForm
          clients={clients}
          projects={projects}
          currency={company.currency}
          canCreateClient={can(user, "clients.create")}
          canCreateProject={can(user, "projects.create")}
        />
      )}
    </div>
  );
}
