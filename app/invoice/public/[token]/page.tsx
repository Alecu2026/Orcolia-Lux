import { notFound } from "next/navigation";
import { getInvoiceByToken, getInvoiceTaskTitles } from "@/lib/queries/invoices";
import { getCompanySettings } from "@/lib/queries/company";
import { env } from "@/lib/env";
import { money, fmtDate, INVOICE_STATUS, type InvoiceStatusKey } from "@/app/components/invoice-meta";
import PrintButton from "@/app/components/PrintButton";

export const dynamic = "force-dynamic";

export default async function PublicInvoicePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const [invoice, company] = await Promise.all([
    getInvoiceByToken(token),
    getCompanySettings(),
  ]);
  if (!invoice) notFound();
  const invoiceTasks = await getInvoiceTaskTitles(invoice.taskIds ?? []);

  const st = INVOICE_STATUS[invoice.status as InvoiceStatusKey];

  return (
    <main className="min-h-dvh bg-zinc-100 p-4 text-zinc-900 print:bg-white print:p-0">
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between print:hidden">
          <h1 className="text-sm font-medium text-zinc-500">Factură {invoice.number}</h1>
          <PrintButton token={token} origin={env.appUrl} />
        </div>

        <article className="rounded-2xl bg-white p-8 shadow-sm ring-1 ring-zinc-200 print:rounded-none print:p-6 print:shadow-none print:ring-0">
          {/* Header */}
          <header className="flex items-start justify-between gap-6 border-b border-zinc-200 pb-6">
            <div className="flex items-center gap-4">
              {company.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logo} alt={company.companyName} className="h-16 w-16 rounded-lg object-contain" />
              ) : null}
              <div>
                <h2 className="text-lg font-bold">{company.companyName || "Compania"}</h2>
                <div className="mt-1 space-y-0.5 text-xs text-zinc-500">
                  {company.phone && <p>{company.phone}</p>}
                  {company.email && <p>{company.email}</p>}
                  {company.address && <p>{company.address}</p>}
                  {company.taxId && <p>IDNO/Tax: {company.taxId}</p>}
                  {company.vatNumber && <p>TVA: {company.vatNumber}</p>}
                </div>
              </div>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold tracking-tight">FACTURĂ</p>
              <p className="mt-1 text-sm font-semibold">{invoice.number}</p>
              <span className={`mt-2 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>
                {st.label}
              </span>
            </div>
          </header>

          {/* Meta + client */}
          <section className="flex items-start justify-between gap-6 py-6 text-sm">
            <div>
              {invoice.client && (
                <>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Facturat către</p>
                  <div className="text-zinc-700">
                    <p className="font-semibold text-zinc-900">{invoice.client.name}</p>
                    {invoice.client.phone && <p>{invoice.client.phone}</p>}
                    {invoice.client.email && <p>{invoice.client.email}</p>}
                  </div>
                </>
              )}
              {(invoice.project || invoiceTasks.length > 0) && (
                <p className="mt-2 text-xs text-zinc-500">
                  {invoice.project && <>Proiect: {invoice.project.name}</>}
                  {invoiceTasks.length > 0 && (
                    <> · Task{invoiceTasks.length > 1 ? "-uri" : ""}: {invoiceTasks.map((t) => t.title).join(", ")}</>
                  )}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <Meta k="Data emiterii" v={fmtDate(invoice.issueDate)} />
              {invoice.dueDate && <Meta k="Scadență" v={fmtDate(invoice.dueDate)} />}
            </div>
          </section>

          {/* Items */}
          <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-sm">
            <thead>
              <tr className="border-y border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-400">
                <th className="py-2">Descriere</th>
                <th className="py-2 text-right">Cant.</th>
                <th className="py-2 text-right">Preț</th>
                <th className="py-2 text-right">TVA</th>
                <th className="py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it) => (
                <tr key={it.id} className="border-b border-zinc-100">
                  <td className="py-2.5 pr-2">{it.description}</td>
                  <td className="py-2.5 text-right tabular-nums">{it.quantity}</td>
                  <td className="py-2.5 text-right tabular-nums">{money(it.unitPrice, invoice.currency)}</td>
                  <td className="py-2.5 text-right tabular-nums">{it.taxRate}%</td>
                  <td className="py-2.5 text-right font-medium tabular-nums">{money(it.lineTotal, invoice.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>

          {/* Totals */}
          <div className="mt-4 flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <Row k="Subtotal" v={money(invoice.subtotal, invoice.currency)} />
              <Row k="TVA total" v={money(invoice.taxTotal, invoice.currency)} />
              <div className="flex justify-between border-t border-zinc-200 pt-2 text-base font-bold">
                <span>Total general</span>
                <span className="tabular-nums">{money(invoice.grandTotal, invoice.currency)}</span>
              </div>
            </div>
          </div>

          {(invoice.notes || invoice.terms || company.bankDetails) && (
            <footer className="mt-8 grid grid-cols-1 gap-4 border-t border-zinc-200 pt-6 text-xs text-zinc-600 sm:grid-cols-2">
              {invoice.notes && (
                <div>
                  <p className="mb-1 font-semibold text-zinc-800">Notițe</p>
                  <p className="whitespace-pre-wrap">{invoice.notes}</p>
                </div>
              )}
              {invoice.terms && (
                <div>
                  <p className="mb-1 font-semibold text-zinc-800">Termeni</p>
                  <p className="whitespace-pre-wrap">{invoice.terms}</p>
                </div>
              )}
              {company.bankDetails && (
                <div className="sm:col-span-2">
                  <p className="mb-1 font-semibold text-zinc-800">Detalii bancare</p>
                  <p className="whitespace-pre-wrap">{company.bankDetails}</p>
                </div>
              )}
            </footer>
          )}
        </article>
      </div>
    </main>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <p className="text-zinc-700">
      <span className="text-zinc-400">{k}: </span>
      <span className="font-medium">{v}</span>
    </p>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between text-zinc-600">
      <span>{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}
