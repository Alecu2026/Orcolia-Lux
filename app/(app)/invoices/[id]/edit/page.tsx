import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getApaCanalMonthlyForForm, getInvoice, invoiceProjectOptions } from "@/lib/queries/invoices";
import { getCompanySettings } from "@/lib/queries/company";
import { crmClientOptionsPlus } from "@/lib/queries/clients";
import { prisma } from "@/lib/prisma";
import InvoiceForm, { type InvoiceInitial } from "@/app/components/InvoiceForm";
import ApaCanalInvoiceForm, { type ApaCanalInitial } from "@/app/components/ApaCanalInvoiceForm";
import { IconChevronLeft } from "@/app/components/icons";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const t = await getT();
  const user = await requirePermission("invoices.edit");
  const { id } = await params;
  const [invoice, projects, company] = await Promise.all([
    getInvoice(id),
    invoiceProjectOptions(),
    getCompanySettings(),
  ]);
  if (!invoice) notFound();
  // Clienții de CRM + al facturii (plătitorul rămâne selectat); lista completă avea ~19.000 de opțiuni.
  const clients = await crmClientOptionsPlus(invoice.clientId);

  if (invoice.kind === "APA_CANAL") {
    // "ap[aă]" — acceptă și "apă" (cu diacritic), cum apar descrierile facturilor importate din
    // exportul 1C — vezi explicația din ApaCanalInvoicePublic.tsx.
    const apaItem = invoice.items.find((it) => /alimentare cu ap[aă]/i.test(it.description));
    const canalItem = invoice.items.find((it) => /canalizare/i.test(it.description));
    const rawConsumption = Array.isArray(invoice.monthlyConsumption)
      ? (invoice.monthlyConsumption as { label: string; value: number }[])
      : [];

    // Grila „Consum lunar": valorile salvate pe factură au prioritate, dar o lună rămasă goală sau 0 se completează din facturile celorlalte
    // luni ale plătitorului (altfel formularul arată doar luna facturii curente, deși plătitorul are consum în celelalte).
    const history = invoice.clientId ? await getApaCanalMonthlyForForm(invoice.clientId, invoice.issueDate) : [];
    const consumByLabel = new Map<string, number>();
    for (const p of history) consumByLabel.set(String(p.label), p.value);
    for (const p of rawConsumption) {
      const label = String(p.label);
      const own = Number(p.value);
      if (Number.isFinite(own) && own !== 0) consumByLabel.set(label, own);
      else if (!consumByLabel.has(label)) consumByLabel.set(label, Number.isFinite(own) ? own : 0);
    }
    const monthlyConsumptionInitial = [...consumByLabel.entries()].map(([label, value]) => ({ label, value: String(value) }));

    // Facturile create de importuri mai vechi pot avea contul personal / adresa goale, deși plătitorul le are pe fișă —
    // le completăm din fișa lui (doar în formular; se salvează pe factură abia când apeși Salvează).
    const needFill = !invoice.contPersonal || !invoice.consumAddress;
    const payer =
      needFill && invoice.clientId
        ? await prisma.client.findUnique({ where: { id: invoice.clientId }, select: { meterSeries: true, consumAddress: true } })
        : null;
    const prefilled = {
      contPersonal: !invoice.contPersonal && !!payer?.meterSeries,
      consumAddress: !invoice.consumAddress && !!payer?.consumAddress,
    };

    const apaCanalInitial: ApaCanalInitial = {
      id: invoice.id,
      status: invoice.status,
      issueDate: invoice.issueDate.toISOString().slice(0, 10),
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : "",
      clientId: invoice.clientId,
      currency: invoice.currency,
      contPersonal: invoice.contPersonal ?? payer?.meterSeries ?? "",
      sectorNr: invoice.sectorNr ?? "",
      consumAddress: invoice.consumAddress ?? payer?.consumAddress ?? "",
      consumerName: invoice.consumerName ?? "",
      meterNumber: invoice.meterNumber ?? "",
      meterPrevReading: invoice.meterPrevReading ?? "",
      meterCurrReading: invoice.meterCurrReading ?? "",
      isEstimatedVolume: invoice.isEstimatedVolume,
      billingPeriodLabel: invoice.billingPeriodLabel ?? "",
      apaVolum: apaItem ? String(apaItem.quantity) : "",
      apaTarif: apaItem ? String(apaItem.unitPrice) : "",
      canalVolum: canalItem ? String(canalItem.quantity) : "",
      canalTarif: canalItem ? String(canalItem.unitPrice) : "",
      recalculari: String(invoice.recalculari ?? 0),
      penalitati: String(invoice.penalitati ?? 0),
      datoriiAvans: String(invoice.datoriiAvans ?? 0),
      monthlyConsumption: monthlyConsumptionInitial,
    };

    return (
      <div className="w-full">
        <div className="mb-2 flex flex-wrap items-center gap-x-3">
          <Link href="/invoices" className="inline-flex items-center gap-1 text-xs text-ink-soft hover:text-ink">
            <IconChevronLeft className="size-3.5" /> {t("Facturi")}
          </Link>
          <h1 className="text-lg font-bold">Editează {invoice.number} <span className="text-sm font-normal text-ink-soft">{t("(Apă-Canal)")}</span></h1>
        </div>
        <ApaCanalInvoiceForm
          clients={clients}
          currency={company.currency}
          initial={apaCanalInitial}
          prefilled={prefilled}
          canCreateClient={can(user, "clients.create")}
        />
      </div>
    );
  }

  const initial: InvoiceInitial = {
    id: invoice.id,
    status: invoice.status,
    issueDate: invoice.issueDate.toISOString().slice(0, 10),
    dueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : "",
    clientId: invoice.clientId,
    projectId: invoice.projectId,
    taskIds: invoice.taskIds?.length ? invoice.taskIds : (invoice.taskId ? [invoice.taskId] : []),
    notes: invoice.notes ?? "",
    terms: invoice.terms ?? "",
    currency: invoice.currency,
    items: invoice.items.map((it) => ({
      description: it.description,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      taxRate: it.taxRate,
    })),
  };

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center gap-x-3">
        <Link href="/invoices" className="inline-flex items-center gap-1 text-xs text-ink-soft hover:text-ink">
          <IconChevronLeft className="size-3.5" /> {t("Facturi")}
        </Link>
        <h1 className="text-lg font-bold">{t("Editează {number}", { number: invoice.number })}</h1>
      </div>
      <InvoiceForm
        clients={clients}
        projects={projects}
        currency={company.currency}
        initial={initial}
        canCreateClient={can(user, "clients.create")}
        canCreateProject={can(user, "projects.create")}
      />
    </div>
  );
}
