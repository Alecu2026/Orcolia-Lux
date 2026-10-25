import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/dal";
import { getPayerStatement } from "@/lib/services/payer-statement";
import { INVOICE_STATUS, fmtDate, type InvoiceStatusKey } from "@/app/components/invoice-meta";
import { IconChevronLeft } from "@/app/components/icons";
import PayerStatementView from "@/app/components/PayerStatementView";
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

      <PayerStatementView statement={statement} />

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
