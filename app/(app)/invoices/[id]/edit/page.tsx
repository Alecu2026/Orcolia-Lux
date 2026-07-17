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
