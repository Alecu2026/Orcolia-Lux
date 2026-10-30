import { requireClient } from "@/lib/client-dal";
import { money, INVOICE_STATUS_LIST, type InvoiceStatusKey } from "@/app/components/invoice-meta";
import { getT } from "@/lib/i18n/server-t";
import { listPortalTemplates } from "@/lib/queries/portal-templates";
import PortalRequestPanel from "@/app/components/PortalRequestPanel";
import PortalMeters from "@/app/components/PortalMeters";
import PortalInvoiceList from "@/app/components/PortalInvoiceList";
import { getPortalHome } from "@/lib/services/portal-home";

export const dynamic = "force-dynamic";

export default async function PortalDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const t = await getT();
  const client = await requireClient();
  const { status } = await searchParams;
  const statusFilter = INVOICE_STATUS_LIST.includes(status as InvoiceStatusKey) ? (status as InvoiceStatusKey) : null;

  // Facturile și contoarele clientului vin dintr-un singur obiect ținut câteva secunde în memorie (lib/services/portal-home.ts); șabloanele la fel.
  const [templates, home] = await Promise.all([listPortalTemplates(), getPortalHome(client.id)]);
  const allInvoices = home.invoices;
  const currency = allInvoices[0]?.currency ?? "MDL";
  const totalDue = allInvoices.filter((i) => i.status === "SENT" || i.status === "OVERDUE").reduce((sum, i) => sum + i.grandTotal, 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">{t("Facturile mele")}</h1>
          <p className="mt-0.5 text-xs text-ink-soft">{t("{length} facturi în total", { length: allInvoices.length })}</p>
        </div>
      </div>

      <PortalRequestPanel templates={templates} defaults={{ address: client.address ?? home.meters.find((m) => m.address)?.address ?? null, consumerName: client.name }} />

      {home.meters.length > 0 && <PortalMeters meters={home.meters} period={home.period} />}

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

      {/* Facturile stau într-o listă care se deschide la apăsare; filtrul pe status se aplică în browser (fără cerere nouă). */}
      <PortalInvoiceList invoices={allInvoices} initialStatus={statusFilter} />
    </div>
  );
}
