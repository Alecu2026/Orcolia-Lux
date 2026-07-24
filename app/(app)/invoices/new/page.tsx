import Link from "next/link";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import {
  invoiceClientOptions,
  invoiceProjectOptions,
} from "@/lib/queries/invoices";
import { getCompanySettings } from "@/lib/queries/company";
import InvoiceForm from "@/app/components/InvoiceForm";
import ApaCanalInvoiceForm from "@/app/components/ApaCanalInvoiceForm";
import { IconChevronLeft, IconDroplet, IconFileText } from "@/app/components/icons";

export const dynamic = "force-dynamic";

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const user = await requirePermission("invoices.create");
  const { kind } = await searchParams;

  const backLink = (
    <Link href="/invoices" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
      <IconChevronLeft className="size-4" /> Înapoi la facturi
    </Link>
  );

  if (kind !== "apa-canal" && kind !== "standard") {
    return (
      <div className="w-full">
        {backLink}
        <h1 className="mb-4 text-xl font-bold">Factură nouă</h1>
        <p className="mb-4 text-sm text-ink-soft">Alege tipul facturii pe care vrei să o creezi:</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href="/invoices/new?kind=standard"
            className="card tap flex flex-col items-start gap-2 p-5 hover:border-brand"
          >
            <IconFileText className="size-8 text-brand" />
            <span className="text-base font-bold">Factură standard</span>
            <span className="text-sm text-ink-soft">Rânduri libere, servicii sau produse, TVA — factura obișnuită.</span>
          </Link>
          <Link
            href="/invoices/new?kind=apa-canal"
            className="card tap flex flex-col items-start gap-2 p-5 hover:border-brand"
          >
            <IconDroplet className="size-8 text-brand" />
            <span className="text-base font-bold">Factură Apă-Canal</span>
            <span className="text-sm text-ink-soft">Formatul facturii de alimentare cu apă și canalizare (contor, consum, grafic).</span>
          </Link>
        </div>
      </div>
    );
  }

  const [clients, projects, company] = await Promise.all([
    invoiceClientOptions(),
    invoiceProjectOptions(),
    getCompanySettings(),
  ]);

  return (
    <div className="w-full">
      {backLink}
      <h1 className="mb-4 text-xl font-bold">
        {kind === "apa-canal" ? "Factură Apă-Canal — nouă" : "Factură standard — nouă"}
      </h1>
      {kind === "apa-canal" ? (
        <ApaCanalInvoiceForm
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
