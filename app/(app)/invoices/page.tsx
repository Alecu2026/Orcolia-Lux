import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { listInvoices } from "@/lib/queries/invoices";
import { env } from "@/lib/env";
import InvoicesList from "@/app/components/InvoicesList";
import { normalizePerPageClient } from "@/lib/payer-notify";
import type { InvoiceStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUSES: InvoiceStatus[] = ["DRAFT", "SENT", "PAID", "CANCELLED", "OVERDUE"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; ps?: string }>;
}) {
  const user = await requirePermission("invoices.view");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as InvoiceStatus)
    ? (sp.status as InvoiceStatus)
    : undefined;
  const q = sp.q?.trim() || "";
  const wantedPage = Math.max(1, Math.floor(Number(sp.page)) || 1);

  const perPage = normalizePerPageClient(sp.ps);
  let result = await listInvoices({ status, search: q, page: wantedPage, perPage });
  // pagină cerută după ultima (ex. din link vechi sau după filtrare): arătăm ultima, nu o listă goală
  if (wantedPage > result.totalPages) result = await listInvoices({ status, search: q, page: result.totalPages, perPage });

  return (
    <div className="w-full">
      <InvoicesList
        items={result.items}
        page={result.page}
        total={result.total}
        totalPages={result.totalPages}
        perPage={perPage}
        status={status ?? ""}
        q={q}
        origin={env.appUrl}
        canImportApaCanal={can(user, "invoices.create") && can(user, "clients.create") && env.blob.enabled}
      />
    </div>
  );
}
