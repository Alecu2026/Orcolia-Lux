import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/dal";
import { getPayerStatement } from "@/lib/services/payer-statement";
import { INVOICE_STATUS, fmtDate, type InvoiceStatusKey } from "@/app/components/invoice-meta";
import { IconChevronLeft } from "@/app/components/icons";
import CompactCard, { CompactField } from "@/app/components/CompactCard";
import { getT } from "@/lib/i18n/server-t";

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
  const t = await getT();
  await requirePermission("payers.view");
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
        <IconChevronLeft className="size-4" /> {t("Înapoi la plătitor")}
      </Link>

      {/* Antet — ca fișa "Абонент / Лицевой счет / ..." din raportul lor, cu câmpurile pe care le avem noi. */}
      <div className="card overflow-hidden p-0">
        <div className="bg-[var(--color-surface-2)] px-4 py-2 text-sm font-bold">{t("Decontare — {name}", { name: client.name })}</div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 p-4 text-sm sm:grid-cols-4">
          <div>
            <p className="text-xs text-ink-soft">{t("Cont personal")}</p>
            <p className="font-medium">{client.meterSeries ?? "—"}</p>
          </div>
          <div className="col-span-2 sm:col-span-3">
            <p className="text-xs text-ink-soft">{t("Adresă")}</p>
            <p className="font-medium">{client.consumAddress ?? "—"}</p>
          </div>
        </div>
      </div>

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
                      <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium ${st.cls}`}>{st.label}</span>
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
                    <Link href={`/invoices/${r.invoiceId}/edit`} className="tap inline-flex h-7 items-center rounded-lg border border-[var(--color-line)] px-3 text-[11px] font-medium hover:bg-brand-soft">{t("Deschide factura")}</Link>
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

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-soft">{t("Descarcă:")}</span>
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
        {t("Nu avem un jurnal de plăți individuale (dată/sumă/loc încasare), ca în raportul 1C — doar soldul net al fiecărei perioade.")}
      </p>
    </div>
  );
}
