import Link from "next/link";
import type { PayerStatement, PayerStatementRow } from "@/lib/services/payer-statement";
import { INVOICE_STATUS, fmtDate, type InvoiceStatusKey } from "@/app/components/invoice-meta";
import CompactCard, { CompactField } from "@/app/components/CompactCard";
import { getT } from "@/lib/i18n/server-t";

const vol = (n: number | null) => (n == null ? "—" : n.toLocaleString("ro-RO", { maximumFractionDigits: 3 }));

/**
 * Tabelul „Decontare” (un rând per lună facturată + TOTAL), comun pentru fișa din administrare și pentru cabinetul personal al clientului.
 * În portal, perioada și butonul „Deschide factura” duc la factura publică; în administrare — la editarea facturii.
 */
export default async function PayerStatementView({ statement, portal = false }: { statement: PayerStatement; portal?: boolean }) {
  const t = await getT();
  const { rows, totals } = statement;
  const currency = rows[0]?.currency ?? "MDL";
  const invoiceHref = (r: PayerStatementRow) => (portal ? `/invoice/public/${r.publicToken}` : `/invoices/${r.invoiceId}/edit`);

  // Tabel pe toată lățimea, fără derulare: antetele se rup pe rânduri, moneda e în antet (nu repetată în fiecare celulă), numerele rămân pe un rând.
  const th = "border border-[var(--color-line)] px-1.5 py-1.5 text-left align-bottom font-semibold leading-tight";
  const thNum = `${th} text-right`;
  const td = "border border-[var(--color-line)] px-1.5 py-1.5 align-top";
  const tdNum = `${td} text-right tabular-nums whitespace-nowrap`;
  const nr = (n: number, cur: string) =>
    n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur === currency ? "" : ` ${cur}`);

  return (
    <>
    {rows.length === 0 ? (
      <div className="card p-8 text-center text-sm text-ink-soft">{t("Niciun rând de decontare — plătitorul nu are încă nicio factură Apă-Canal.")}</div>
    ) : (
      <>
        {/* Ecran mare: tabelul pe toată lățimea, fără derulare orizontală */}
        <div className="card hidden p-0 sm:block">
          <table className="w-full border-collapse text-[11px] lg:text-xs">
            <thead>
              <tr className="bg-[var(--color-surface-2)]">
                <th className={th}>{t("Perioadă")}</th>
                <th className={thNum}>{t("Index ant.")}</th>
                <th className={thNum}>{t("Index curent")}</th>
                <th className={thNum}>{t("Apă (m³)")}</th>
                <th className={thNum}>{t("Canal (m³)")}</th>
                <th className={thNum}>{t("Calculat ({currency})", { currency })}</th>
                <th className={thNum}>{t("Sold anterior / regularizare")}</th>
                <th className={thNum}>{t("Recalculări")}</th>
                <th className={thNum}>{t("Penalități")}</th>
                <th className={thNum}>{t("Total de plată")}</th>
                <th className={th}>{t("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = INVOICE_STATUS[r.status as InvoiceStatusKey];
                return (
                  <tr key={r.invoiceId} className="hover:bg-[var(--color-surface-2)]/60">
                    <td className={td}>
                      <Link href={invoiceHref(r)} className="font-medium text-brand-strong hover:underline">
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
                      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{t(st.label)}</span>
                    </td>
                  </tr>
                );
              })}
              {/* Rândul TOTAL — evidențiat, ca "ВСЕГО" din raportul lor. */}
              <tr className="bg-brand-soft font-bold text-brand-strong">
                <td className={td}>{t("TOTAL")}</td>
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

        {/* Telefon: un rând mic per lună; apeși ca să vezi detaliile, apeși din nou ca să închizi */}
        <div className="flex flex-col gap-1.5 sm:hidden">
          {rows.map((r) => {
            const st = INVOICE_STATUS[r.status as InvoiceStatusKey];
            return (
              <CompactCard
                key={r.invoiceId}
                avatar={(r.billingPeriodLabel ?? "").trim().charAt(0).toUpperCase()}
                title={r.billingPeriodLabel ?? fmtDate(r.issueDate)}
                subtitle={
                  <>
                    <span>{r.number}</span>
                    <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium ${st.cls}`}>{t(st.label)}</span>
                  </>
                }
                trailing={<span className="font-semibold tabular-nums">{nr(r.grandTotal, r.currency)}</span>}
              >
                <dl>
                  <CompactField label={t("Index ant.")}>{r.meterPrevReading ?? "—"}</CompactField>
                  <CompactField label={t("Index curent")}>{r.meterCurrReading ?? "—"}</CompactField>
                  <CompactField label={t("Apă (m³)")}>{vol(r.apaQty)}</CompactField>
                  <CompactField label={t("Canal (m³)")}>{vol(r.canalQty)}</CompactField>
                  <CompactField label={`Calculat (${currency})`}>{nr(r.subtotal, r.currency)}</CompactField>
                  <CompactField label={t("Sold anterior / regularizare")}>{nr(r.datoriiAvans, r.currency)}</CompactField>
                  <CompactField label={t("Recalculări")}>{nr(r.recalculari, r.currency)}</CompactField>
                  <CompactField label={t("Penalități")}>{nr(r.penalitati, r.currency)}</CompactField>
                </dl>
                <div className="border-t border-[var(--color-line)]/60 px-2.5 py-1.5">
                  <Link href={invoiceHref(r)} className="tap inline-flex h-7 items-center rounded-lg border border-[var(--color-line)] px-3 text-[11px] font-medium hover:bg-brand-soft">{t("Deschide factura")}</Link>
                </div>
              </CompactCard>
            );
          })}
          <CompactCard
            avatar="Σ"
            title={t("TOTAL")}
            trailing={<span className="font-bold tabular-nums text-brand-strong">{nr(totals.grandTotal, currency)}</span>}
          >
            <dl>
              <CompactField label={t("Apă (m³)")}>{vol(totals.apaQty)}</CompactField>
              <CompactField label={t("Canal (m³)")}>{vol(totals.canalQty)}</CompactField>
              <CompactField label={`Calculat (${currency})`}>{nr(totals.subtotal, currency)}</CompactField>
              <CompactField label={t("Sold anterior / regularizare")}>{nr(totals.datoriiAvans, currency)}</CompactField>
              <CompactField label={t("Recalculări")}>{nr(totals.recalculari, currency)}</CompactField>
              <CompactField label={t("Penalități")}>{nr(totals.penalitati, currency)}</CompactField>
            </dl>
          </CompactCard>
        </div>
      </>
    )}
    </>
  );
}
