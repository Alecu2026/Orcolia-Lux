import type { PayerStatement } from "@/lib/services/payer-statement";
import { getT } from "@/lib/i18n/server-t";

/**
 * Rezumatul din capul decontării: contul (sau contractul, la firme), adresa, perioada acoperită și totalul. Contul și adresa vin cu valori de rezervă (ultima factură, 1C),
 * deci rămân „—” doar când nu există nicăieri. Folosit în cabinetul personal și în pagina de tipărire.
 */
export default async function StatementSummary({ statement }: { statement: PayerStatement }) {
  const t = await getT();
  const { rows, totals, client } = statement;
  const currency = rows[0]?.currency ?? "MDL";
  const first = rows[0]?.billingPeriodLabel;
  const last = rows[rows.length - 1]?.billingPeriodLabel;
  const period = rows.length === 0 ? "—" : first && last && first !== last ? `${first} – ${last}` : (first ?? last ?? "—");
  const money = (n: number) => n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const tile = "rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2.5 print:border-zinc-300";
  const label = "text-[10px] font-semibold uppercase tracking-wide text-ink-soft";
  const val = (v: string | null) => (v ? <p className="mt-0.5 break-words text-sm font-semibold">{v}</p> : <p className="mt-0.5 text-sm text-ink-soft/60">—</p>);

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-[1fr_2fr_1.3fr_1.2fr]" data-statement-summary="">
      <div className={tile}>
        <p className={label}>{client.accountKind === "contract" ? t("Contract") : t("Cont personal")}</p>
        {val(client.account)}
      </div>
      <div className={`${tile} col-span-2 lg:col-span-1`}>
        <p className={label}>{t("Adresă")}</p>
        {val(client.address)}
      </div>
      <div className={tile}>
        <p className={label}>{t("Perioadă")} · {rows.length} {t("facturi")}</p>
        <p className="mt-0.5 text-sm font-semibold">{period}</p>
      </div>
      <div className={`${tile} border-brand/40 bg-brand-soft`}>
        <p className={`${label} text-brand-strong`}>{t("Total de plată")}</p>
        <p className="mt-0.5 text-lg font-bold leading-tight tabular-nums text-brand-strong">{money(totals.grandTotal)} <span className="text-xs font-semibold">{currency}</span></p>
      </div>
    </div>
  );
}
