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
  const th = "border-b border-[var(--color-line)] px-1.5 py-2.5 text-left align-bottom text-[9px] font-semibold uppercase leading-tight tracking-wide text-ink-soft";
  const thNum = `${th} text-right`;
  const td = "border-b border-[var(--color-line)]/70 px-1.5 py-2.5 align-middle";
  const tdNum = `${td} text-right tabular-nums whitespace-nowrap`;
  const nr = (n: number, cur: string) =>
    n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur === currency ? "" : ` ${cur}`);

  // Situația pe tot istoricul: cât a avut de achitat, cât a achitat, cât mai are de achitat sau cât avans are (staff, cabinet client și pagina de tipărire — aceeași vizualizare)
  const sm = statement.summary;
  const money = (n: number) => n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const owes = sm.remaining > 0.005;
  const hasAdvance = sm.advance > 0.005;
  const tile = "rounded-xl border px-3.5 py-2.5 print:border-zinc-300";
  const tileLabel = "text-[10px] font-semibold uppercase tracking-wide";
  const tileVal = "mt-0.5 text-lg font-bold leading-tight tabular-nums";

  return (
    <>
    {rows.length > 0 && (
      <div className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-3" data-statement-balance="">
        <div className={`${tile} border-[var(--color-line)] bg-[var(--color-surface)]`}>
          <p className={`${tileLabel} text-ink-soft`}>{t("Total de achitat")}</p>
          <p className={tileVal}>{money(sm.due)} <span className="text-xs font-semibold">{sm.currency}</span></p>
          <p className="text-[10px] text-ink-soft">{t("tot ce s-a calculat, cu datoria de la început")}</p>
        </div>
        <div className={`${tile} border-st-done/40 bg-st-done/10`}>
          <p className={`${tileLabel} text-st-done`}>{t("Total achitat")}</p>
          <p className={`${tileVal} text-st-done`}>{money(sm.paid)} <span className="text-xs font-semibold">{sm.currency}</span></p>
        </div>
        <div className={`${tile} col-span-2 lg:col-span-1 ${owes ? "border-st-cancelled/40 bg-st-cancelled/10" : "border-brand/40 bg-brand-soft"}`}>
          <p className={`${tileLabel} ${owes ? "text-st-cancelled" : "text-brand-strong"}`}>{owes ? t("Mai are de achitat") : hasAdvance ? t("Avans") : t("Mai are de achitat")}</p>
          <p className={`${tileVal} ${owes ? "text-st-cancelled" : "text-brand-strong"}`}>{money(owes ? sm.remaining : sm.advance)} <span className="text-xs font-semibold">{sm.currency}</span></p>
        </div>
      </div>
    )}
    {rows.length === 0 ? (
      <div className="card p-8 text-center text-sm text-ink-soft">{t("Niciun rând de decontare — plătitorul nu are încă nicio factură Apă-Canal.")}</div>
    ) : (
      <>
        {/* Ecran mare: tabelul pe toată lățimea, fără derulare orizontală */}
        <div className="card hidden overflow-x-auto p-0 sm:block" data-statement-table="">
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
                <th className={thNum} title={t("Cât s-a plătit între factura anterioară și aceasta (dedus din soldul de pe factură)")}>{t("Plătit înainte de factură")}</th>
                <th className={thNum} title={t("Cât din această factură s-a achitat (dedus din datoria de pe factura următoare)")}>{t("Achitat din factură")}</th>
                <th className={th}>{t("Status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => {
                const st = INVOICE_STATUS[r.status as InvoiceStatusKey];
                return (
                  <tr key={r.invoiceId} className={`hover:bg-brand-soft/40 ${idx % 2 === 1 ? "bg-[var(--color-surface-2)]/40" : ""}`}>
                    <td className={`${td} whitespace-nowrap`}>
                      <Link href={invoiceHref(r)} className="font-semibold text-brand-strong hover:underline">
                        {r.billingPeriodLabel ?? fmtDate(r.issueDate)}
                      </Link>
                      <span className="block text-[10px] text-ink-soft">{r.number}</span>
                      {r.dueDate && <span className="block text-[10px] text-ink-soft">{t("Scadență")} {fmtDate(r.dueDate)}</span>}
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
                    <td className={`${tdNum} ${r.prevPaid != null && r.prevPaid > 0.005 ? "text-st-done" : ""}`}>{r.prevPaid == null ? "—" : nr(r.prevPaid, r.currency)}</td>
                    <td className={tdNum}>{r.paidAmount == null ? <span title={t("Încă nu se știe: apare când se emite factura următoare")}>—</span> : nr(r.paidAmount, r.currency)}</td>
                    <td className={td}>
                      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{t(st.label)}</span>
                    </td>
                  </tr>
                );
              })}
              {/* Rândul TOTAL — evidențiat, ca "ВСЕГО" din raportul lor. */}
              <tr className="border-t-2 border-brand/50 bg-brand-soft font-bold text-brand-strong">
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
                <td className={tdNum} title={t("Suma plăților deduse din lanțul de facturi")}>{nr(totals.paid, currency)}</td>
                <td className={td} />
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
                trailing={
                  <span className="flex flex-col items-end leading-tight">
                    <span className="font-semibold tabular-nums">{nr(r.grandTotal, r.currency)}</span>
                    {r.paidAmount != null && r.paidAmount > 0.005 && <span className="text-[10px] text-st-done">{t("achitat")} {nr(r.paidAmount, r.currency)}</span>}
                  </span>
                }
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
                  {r.dueDate && <CompactField label={t("Scadență")}>{fmtDate(r.dueDate)}</CompactField>}
                  <CompactField label={t("Plătit înainte de factură")}>{r.prevPaid == null ? "—" : nr(r.prevPaid, r.currency)}</CompactField>
                  <CompactField label={t("Achitat din factură")}>{r.paidAmount == null ? "—" : nr(r.paidAmount, r.currency)}</CompactField>
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
              <CompactField label={t("Total plătit")}>{nr(totals.paid, currency)}</CompactField>
            </dl>
          </CompactCard>
        </div>
      </>
    )}
    </>
  );
}
