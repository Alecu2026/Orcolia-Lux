import Link from "next/link";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import {
  invoiceClientOptions,
  invoiceProjectOptions,
} from "@/lib/queries/invoices";
import { getCompanySettings } from "@/lib/queries/company";
import InvoiceForm from "@/app/components/InvoiceForm";
import { IconChevronLeft } from "@/app/components/icons";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage() {
  const user = await requirePermission("invoices.create");
  const [clients, projects, company] = await Promise.all([
    invoiceClientOptions(),
    invoiceProjectOptions(),
    getCompanySettings(),
  ]);

  return (
    <div className="w-full">
      <Link href="/invoices" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-4" /> Înapoi la facturi
      </Link>
      <h1 className="mb-4 text-xl font-bold">Factură nouă</h1>
      <InvoiceForm
        clients={clients}
        projects={projects}
        currency={company.currency}
        canCreateClient={can(user, "clients.create")}
        canCreateProject={can(user, "projects.create")}
      />
    </div>
  );
}
