import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/dal";
import { getPayerStatement } from "@/lib/services/payer-statement";
import { INVOICE_STATUS, fmtDate, type InvoiceStatusKey } from "@/app/components/invoice-meta";
import { IconChevronLeft } from "@/app/components/icons";

export const dynamic = "force-dynamic";

const money = (n: number, currency: string) =>
  `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
const vol = (n: number | null) => (n == null ? "—" : n.toLocaleString("ro-RO", { maximumFractionDigits: 3 }));

/**
 * "Decontare" ca fișă tipărită de contabilitate — un rând per lună facturată, coloane și chenar
 * ca la raportul de reconciliere pe care îl folosește Apă-Canal ("Взаиморасчеты с абонентами"),
 * nu ca listele cu carduri obișnuite din restul aplicației. Aceleași cifre ca la export
 * (Excel/CSV/JSON, mai jos) — vin din aceeași funcție, lib/services/payer-statement.ts.
 */
export default async function PayerStatementPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("clients.view");
  const { id } = await params;
  const statement = await getPayerStatement(id);
  if (!statement) notFound();
  const { client, rows, totals } = statement;
  const currency = rows[0]?.currency ?? "MDL";

  // Tabel pe toată lățimea, fără derulare: antetele se rup pe rânduri, moneda e în antet (nu repetată în fiecare celulă), numerele rămân pe un rând.
  const th = "border border-[var(--color-line)] px-1.5 py-1.5 text-left align-bottom font-semibold leading-tight";
  const thNum = `${th} text-right`;
  const td = "border border-[var(--color-line)] px-1.5 py-1.5 align-top";
  const tdNum = `${td} text-right tabular-nums whitespace-nowrap`;
  const nr = (n: number, cur: string) =>
    n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur === currency ? "" : ` ${cur}`);

  return (
    <div className="flex w-full flex-col gap-4">
      <Link href={`/platitori/${client.id}`} className="inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-4" /> Înapoi la plătitor
      </Link>

      {/* Antet — ca fișa "Абонент / Лицевой счет / ..." din raportul lor, cu câmpurile pe care le avem noi. */}
      <div className="card overflow-hidden p-0">
        <div className="bg-[var(--color-surface-2)] px-4 py-2 text-sm font-bold">Decontare — {client.name}</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-ink-soft">Cont personal</p>
            <p className="font-medium">{client.meterSeries ?? "—"}</p>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <p className="text-xs text-ink-soft">Adresă</p>
            <p className="font-medium">{client.consumAddress ?? "—"}</p>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center text-sm text-ink-soft">Niciun rând de decontare — plătitorul nu are încă nicio factură Apă-Canal.</div>
      ) : (
        <>
          {/* Ecran mare: tabelul pe toată lățimea, fără derulare orizontală */}
          <div className="card hidden p-0 sm:block">
            <table className="w-full border-collapse text-[11px] lg:text-xs">
              <thead>
                <tr className="bg-[var(--color-surface-2)]">
                  <th className={th}>Perioadă</th>
                  <th className={thNum}>Index ant.</th>
                  <th className={thNum}>Index curent</th>
                  <th className={thNum}>Apă (m³)</th>
                  <th className={thNum}>Canal (m³)</th>
                  <th className={thNum}>Calculat ({currency})</th>
                  <th className={thNum}>Sold anterior / regularizare</th>
                  <th className={thNum}>Recalculări</th>
                  <th className={thNum}>Penalități</th>
                  <th className={thNum}>Total de plată</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = INVOICE_STATUS[r.status as InvoiceStatusKey];
                  return (
                    <tr key={r.invoiceId} className="hover:bg-[var(--color-surface-2)]/60">
                      <td className={td}>
                        <Link href={`/invoices/${r.invoiceId}/edit`} className="font-medium text-brand-strong hover:underline">
                          {r.billingPeriodLabel ?? fmtDate(r.issueDate)}
                        </Link>
                        <span className="block text-ink-soft">{r.number}</span>
                      </td>
                      <td className={tdNum}>{r.meterPrevReading ?? "—"}</td>
                      <td className={tdNum}>{r.meterCurrReading ?? "—"}</td>
                      <td className={tdNum}>{vol(r.apaQty)}</td>
                      <td className={tdNum}>{vol(r.canalQty)}</td>
                      <td className={tdNum}>{nr(r.subtotal, r.currency)}</td>
                      <td className={tdNum}>{nr(r.datoriiAvans, r.currency)}</td>
                      <td className={tdNum}>{nr(r.recalculari, r.currency)}</td>
                      <td className={tdNum}>{nr(r.penalitati, r.currency)}</td>
                      <td className={`${tdNum} font-semibold`}>{nr(r.grandTotal, r.currency)}</td>
                      <td className={td}>
                        <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                      </td>
                    </tr>
                  );
                })}
                {/* Rândul TOTAL — evidențiat, ca "ВСЕГО" din raportul lor. */}
                <tr className="bg-brand-soft font-bold text-brand-strong">
                  <td className={td}>TOTAL</td>
                  <td className={td} />
                  <td className={td} />
                  <td className={tdNum}>{vol(totals.apaQty)}</td>
                  <td className={tdNum}>{vol(totals.canalQty)}</td>
                  <td className={tdNum}>{nr(totals.subtotal, currency)}</td>
                  <td className={tdNum}>{nr(totals.datoriiAvans, currency)}</td>
                  <td className={tdNum}>{nr(totals.recalculari, currency)}</td>
                  <td className={tdNum}>{nr(totals.penalitati, currency)}</td>
                  <td className={tdNum}>{nr(totals.grandTotal, currency)}</td>
                  <td className={td} />
                </tr>
              </tbody>
            </table>
          </div>

          {/* Telefon: un card per lună, câmpurile unul sub altul (fără derulare) */}
          <div className="flex flex-col gap-2 sm:hidden">
            {rows.map((r) => {
              const st = INVOICE_STATUS[r.status as InvoiceStatusKey];
              const line = (label: string, value: React.ReactNode, strong = false) => (
                <div className={`grid grid-cols-[minmax(6rem,40%)_1fr] gap-x-3 px-3 py-1.5 text-[13px] ${strong ? "font-semibold" : ""}`}>
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
                  <dd className="min-w-0 break-words text-right tabular-nums">{value}</dd>
                </div>
              );
              return (
                <div key={r.invoiceId} className="card overflow-hidden">
                  <div className="flex items-start justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2">
                    <div className="min-w-0">
                      <Link href={`/invoices/${r.invoiceId}/edit`} className="text-[14px] font-semibold text-brand-strong hover:underline">
                        {r.billingPeriodLabel ?? fmtDate(r.issueDate)}
                      </Link>
                      <div className="text-[12px] text-ink-soft">{r.number}</div>
                    </div>
                    <span className={`inline-block shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{st.label}</span>
                  </div>
                  <dl className="divide-y divide-[var(--color-line)]">
                    {line("Index ant.", r.meterPrevReading ?? "—")}
                    {line("Index curent", r.meterCurrReading ?? "—")}
                    {line("Apă (m³)", vol(r.apaQty))}
                    {line("Canal (m³)", vol(r.canalQty))}
                    {line(`Calculat (${currency})`, nr(r.subtotal, r.currency))}
                    {line("Sold anterior / regularizare", nr(r.datoriiAvans, r.currency))}
                    {line("Recalculări", nr(r.recalculari, r.currency))}
                    {line("Penalități", nr(r.penalitati, r.currency))}
                    {line("Total de plată", nr(r.grandTotal, r.currency), true)}
                  </dl>
                </div>
              );
            })}
            <div className="card overflow-hidden border-brand">
              <div className="bg-brand-soft px-3 py-2 text-[13px] font-bold text-brand-strong">TOTAL</div>
              <dl className="divide-y divide-[var(--color-line)]">
                {[
                  ["Apă (m³)", vol(totals.apaQty)],
                  ["Canal (m³)", vol(totals.canalQty)],
                  [`Calculat (${currency})`, nr(totals.subtotal, currency)],
                  ["Sold anterior / regularizare", nr(totals.datoriiAvans, currency)],
                  ["Recalculări", nr(totals.recalculari, currency)],
                  ["Penalități", nr(totals.penalitati, currency)],
                  ["Total de plată", nr(totals.grandTotal, currency)],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[minmax(6rem,40%)_1fr] gap-x-3 px-3 py-1.5 text-[13px] font-semibold">
                    <dt className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{label}</dt>
                    <dd className="min-w-0 break-words text-right tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-soft">Descarcă:</span>
        {(["xlsx", "csv", "json"] as const).map((fmt) => (
          <a
            key={fmt}
            href={`/api/export?entity=payer-statement&id=${client.id}&format=${fmt}`}
            download
            className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium leading-9 hover:bg-[var(--color-surface-2)]"
          >
            {fmt === "xlsx" ? "Excel (.xlsx)" : fmt.toUpperCase()}
          </a>
        ))}
      </div>
      <p className="text-[11px] text-ink-soft">
        Nu avem un jurnal de plăți individuale (dată/sumă/loc încasare), ca în raportul 1C — doar soldul net al fiecărei perioade.
      </p>
    </div>
  );
}
