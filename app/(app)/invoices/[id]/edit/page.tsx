import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import {
  getInvoice,
  invoiceClientOptions,
  invoiceProjectOptions,
} from "@/lib/queries/invoices";
import { getCompanySettings } from "@/lib/queries/company";
import InvoiceForm, { type InvoiceInitial } from "@/app/components/InvoiceForm";
import ApaCanalInvoiceForm, { type ApaCanalInitial } from "@/app/components/ApaCanalInvoiceForm";
import { IconChevronLeft } from "@/app/components/icons";

export const dynamic = "force-dynamic";

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requirePermission("invoices.edit");
  const { id } = await params;
  const [invoice, clients, projects, company] = await Promise.all([
    getInvoice(id),
    invoiceClientOptions(),
    invoiceProjectOptions(),
    getCompanySettings(),
  ]);
  if (!invoice) notFound();

  if (invoice.kind === "APA_CANAL") {
    const apaItem = invoice.items.find((it) => /alimentare cu apa/i.test(it.description));
    const canalItem = invoice.items.find((it) => /canalizare/i.test(it.description));
    const rawConsumption = Array.isArray(invoice.monthlyConsumption)
      ? (invoice.monthlyConsumption as { label: string; value: number }[])
      : [];

    const apaCanalInitial: ApaCanalInitial = {
      id: invoice.id,
      status: invoice.status,
      issueDate: invoice.issueDate.toISOString().slice(0, 10),
      dueDate: invoice.dueDate ? invoice.dueDate.toISOString().slice(0, 10) : "",
      clientId: invoice.clientId,
      currency: invoice.currency,
      contPersonal: invoice.contPersonal ?? "",
      sectorNr: invoice.sectorNr ?? "",
      consumAddress: invoice.consumAddress ?? "",
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
      monthlyConsumption: rawConsumption.map((p) => ({ label: String(p.label), value: String(p.value) })),
    };

    return (
      <div className="w-full">
        <Link href="/invoices" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
          <IconChevronLeft className="size-4" /> Înapoi la facturi
        </Link>
        <h1 className="mb-4 text-xl font-bold">Editează {invoice.number} (Apă-Canal)</h1>
        <ApaCanalInvoiceForm
          clients={clients}
          currency={company.currency}
          initial={apaCanalInitial}
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
      <Link href="/invoices" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-4" /> Înapoi la facturi
      </Link>
      <h1 className="mb-4 text-xl font-bold">Editează {invoice.number}</h1>
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
