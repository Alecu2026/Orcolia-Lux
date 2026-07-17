import { requirePermission } from "@/lib/dal";
import { listInvoices } from "@/lib/queries/invoices";
import { env } from "@/lib/env";
import InvoicesList from "@/app/components/InvoicesList";
import type { InvoiceStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUSES: InvoiceStatus[] = ["DRAFT", "SENT", "PAID", "CANCELLED", "OVERDUE"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string }>;
}) {
  await requirePermission("invoices.view");
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as InvoiceStatus)
    ? (sp.status as InvoiceStatus)
    : undefined;
  const q = sp.q?.trim() || "";
  const page = Math.max(1, Number(sp.page) || 1);

  const result = await listInvoices({ status, search: q, page });

  return (
    <div className="w-full">
      <InvoicesList
        items={result.items}
        hasMore={result.hasMore}
        page={result.page}
        status={status ?? ""}
        q={q}
        origin={env.appUrl}
      />
    </div>
  );
}
