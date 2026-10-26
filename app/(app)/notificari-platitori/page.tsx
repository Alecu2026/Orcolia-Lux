import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { env } from "@/lib/env";
import { timed } from "@/lib/timing";
import { ssrPayerPage } from "@/lib/services/payer-cache";
import { listPayerTemplates } from "@/lib/queries/payer-notify";
import { normalizePerPageClient, sanitizeFilters } from "@/lib/payer-notify";
import PayerNotifyManager from "@/app/components/PayerNotifyManager";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";
// Se aplică și server action-urilor de trimitere apelate din această pagină (un lot de 25 destinatari).
export const maxDuration = 60;

export default async function PayerNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const t = await getT();
  const user = await requirePermission("payers.view");
  const sp = await searchParams;

  // Prima încărcare vine de pe server (cu filtrele din URL, dacă sunt); după aceea filtrele/paginile se schimbă pe client.
  const filters = sanitizeFilters(sp as Record<string, unknown>);
  const perPage = normalizePerPageClient(sp.perPage);
  // Prima încărcare: cel mult 100 de rânduri de pe server (pentru „Toate" lista completă vine apoi din snapshot-ul local).
  const ssrPerPage = Math.min(perPage, 100);
  const [{ items, total, page, months }, templates] = await Promise.all([
    timed("notificari/cache", ssrPayerPage(filters, Math.max(1, Math.floor(Number(sp.page)) || 1), ssrPerPage)),
    timed("notificari/listPayerTemplates", listPayerTemplates()),
  ]);

  return (
    <div className="w-full">
      <div className="mb-4">
        <p className="text-sm text-ink-soft">
          {t("Tabelul tuturor plătitorilor, cu filtre pe orice criteriu. Bifează destinatarii (sau ia-i pe toți din filtru) și trimite-le un email și/sau SMS — cu {nume}, {suma}, {factura} completate automat pentru fiecare.")}</p>
      </div>
      <PayerNotifyManager
        initial={{ filters, page, perPage, items, total }}
        months={months}
        initialTemplates={templates}
        canSend={can(user, "payers.notify")}
        canTask={can(user, "tasks.create")}
        emailEnabled={env.smtp.enabled}
        smsEnabled={env.sms.enabled}
        callEnabled={env.voice.enabled}
        userEmail={user.email}
        userId={user.id}
        isAdmin={can(user, "admin")}
        canDelete={can(user, "payers.delete")}
        canEditInvoices={can(user, "invoices.edit")}
      />
    </div>
  );
}
