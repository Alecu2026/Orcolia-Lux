import "server-only";
import type { InvoiceStatus } from "@prisma/client";
import type { NotifyFilters } from "../payer-notify";
import type { ListPayersOpts } from "./payers";

/** Filtrele curățate (vezi sanitizeFilters) → opțiunile interogării de plătitori. */
export function filtersToListOpts(f: NotifyFilters): ListPayersOpts {
  return {
    search: f.q || undefined,
    street: f.street || undefined,
    month: f.month || undefined,
    status: f.account || undefined,
    sector: f.sector || undefined,
    invoiceStatus: (f.invoiceStatus || undefined) as InvoiceStatus | undefined,
    debt: f.debt || undefined,
    minDebt: f.minDebt ? Number(f.minDebt) : undefined,
    maxDebt: f.maxDebt ? Number(f.maxDebt) : undefined,
    contact: f.contact || undefined,
    kind: f.kind || undefined,
    notified: f.notified || undefined,
    installedFrom: f.installedFrom || undefined,
    sort: f.sort || "name",
  };
}
