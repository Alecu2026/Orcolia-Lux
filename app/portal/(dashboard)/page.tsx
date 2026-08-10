import Link from "next/link";
import { requireClient } from "@/lib/client-dal";
import { prisma } from "@/lib/prisma";
import { money, fmtDate, INVOICE_STATUS, type InvoiceStatusKey } from "@/app/components/invoice-meta";

export const dynamic = "force-dynamic";

export default async function PortalDashboardPage() {
  const client = await requireClient();

  const invoices = await prisma.invoice.findMany({
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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Facturile mele</h1>
        <Link
          href="/portal/tickets"
          className="tap h-10 rounded-xl bg-brand px-4 text-sm font-semibold leading-10 text-white hover:bg-brand-strong"
        >
          Creează tichet
        </Link>
      </div>

      {invoices.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-soft">Nu ai încă nicio factură.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {invoices.map((inv) => {
            const st = INVOICE_STATUS[inv.status as InvoiceStatusKey];
            return (
              <Link
                key={inv.id}
                href={`/invoice/public/${inv.publicToken}`}
                className="card flex items-center justify-between p-4 hover:border-brand"
              >
                <div>
                  <p className="text-sm font-semibold">{inv.number}</p>
                  <p className="text-xs text-ink-soft">
                    Emisă: {fmtDate(inv.issueDate)}
                    {inv.dueDate && <> · Scadență: {fmtDate(inv.dueDate)}</>}
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
