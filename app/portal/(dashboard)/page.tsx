import Link from "next/link";
import { requireClient } from "@/lib/client-dal";
import { prisma } from "@/lib/prisma";
import { money, fmtDate, INVOICE_STATUS, INVOICE_STATUS_LIST, type InvoiceStatusKey } from "@/app/components/invoice-meta";
import { IconTicket } from "@/app/components/icons";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

export default async function PortalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const t = await getT();
  const client = await requireClient();
  const { status } = await searchParams;
  const statusFilter = INVOICE_STATUS_LIST.includes(status as InvoiceStatusKey) ? (status as InvoiceStatusKey) : undefined;

  const allInvoices = await prisma.invoice.findMany({
    // DRAFT rămâne intern (nerevizuit încă de staff) — nu trebuie să apară în portal.
    where: { clientId: client.id, status: { not: "DRAFT" } },
    orderBy: { issueDate: "desc" },
    select: {
      id: true,
      number: true,
      status: true,
      grandTotal: true,
      currency: true,
      issueDate: true,
      dueDate: true,
      publicToken: true,
    },
  });

  const invoices = statusFilter ? allInvoices.filter((i) => i.status === statusFilter) : allInvoices;
  const currency = allInvoices[0]?.currency ?? "MDL";
  const totalDue = allInvoices
    .filter((i) => i.status === "SENT" || i.status === "OVERDUE")
    .reduce((sum, i) => sum + i.grandTotal, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">{t("Facturile mele")}</h1>
          <p className="mt-0.5 text-xs text-ink-soft">{allInvoices.length} facturi în total</p>
        </div>
        <Link
          href="/portal/cereri"
          className="tap flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong"
        >
          <IconTicket className="size-4" />
          {t("Creează cerere")}
        </Link>
      </div>

      {allInvoices.length > 0 && (
        <div className="card flex items-center justify-between p-4">
          <div>
            <p className="text-xs text-ink-soft">{t("Total de plată")}</p>
            <p className="text-xl font-bold tabular-nums">{money(totalDue, currency)}</p>
          </div>
          {totalDue > 0 && (
            <span className="rounded-full bg-st-progress/12 px-3 py-1 text-xs font-medium text-st-progress">
              {t("Ai facturi neachitate")}
            </span>
          )}
        </div>
      )}

      {allInvoices.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <StatusChip href="/portal" active={!statusFilter} label={t("Toate")} />
          {INVOICE_STATUS_LIST.filter((s) => allInvoices.some((i) => i.status === s)).map((s) => (
            <StatusChip key={s} href={`/portal?status=${s}`} active={statusFilter === s} label={INVOICE_STATUS[s].label} />
          ))}
        </div>
      )}

      {invoices.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-soft">
          {allInvoices.length === 0 ? "Nu ai încă nicio factură." : "Nicio factură cu acest status."}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {invoices.map((inv) => {
            const st = INVOICE_STATUS[inv.status as InvoiceStatusKey];
            return (
              <Link
                key={inv.id}
                href={`/invoice/public/${inv.publicToken}`}
                className="card tap flex items-center justify-between p-4 hover:border-brand"
              >
                <div>
                  <p className="text-sm font-semibold">{inv.number}</p>
                  <p className="text-xs text-ink-soft">
                    Emisă: {fmtDate(inv.issueDate)}
                    {inv.dueDate && <> {t("· Scadență:")} {fmtDate(inv.dueDate)}</>}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{money(inv.grandTotal, inv.currency)}</p>
                  <span className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>
                    {st.label}
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusChip({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`tap rounded-full px-3 py-1.5 text-xs font-medium ${
        active ? "bg-brand text-white" : "card text-ink-soft"
      }`}
    >
      {label}
    </Link>
  );
}
