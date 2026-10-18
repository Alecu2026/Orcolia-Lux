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
  const page = Math.max(1, Number(sp.page) || 1);

  const perPage = normalizePerPageClient(sp.ps);
  const result = await listInvoices({ status, search: q, page, perPage });

  return (
    <div className="w-full">
      <InvoicesList
        items={result.items}
        hasMore={result.hasMore}
        page={result.page}
        perPage={perPage}
        status={status ?? ""}
        q={q}
        origin={env.appUrl}
        canImportApaCanal={can(user, "invoices.create") && can(user, "clients.create") && env.blob.enabled}
      />
    </div>
  );
}
