import Link from "next/link";
import { cookies } from "next/headers";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { env } from "@/lib/env";
import { timed } from "@/lib/timing";
import { ssrPayerPage } from "@/lib/services/payer-cache";
import { listPayerTemplates } from "@/lib/queries/payer-notify";
import { normalizePerPageClient, sanitizeFilters } from "@/lib/payer-notify";
import { auditUserOptions } from "@/lib/queries/audit";
import { deliveryFilterFromState, normalizeDeliveryPageSize } from "@/lib/queries/delivery";
import { listPayerLog, listPayerLogChunk } from "@/lib/queries/payer-log";
import { DELIVERY_FIRST_CHUNK, DELIVERY_PS_COOKIE, normalizeDeliveryPs, sanitizeDeliveryState } from "@/lib/delivery-meta";
import PayerNotifyManager from "@/app/components/PayerNotifyManager";
import DeliveryLogsClient from "@/app/components/DeliveryLogsClient";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";
// Se aplică și server action-urilor de trimitere apelate din această pagină (un lot de 25 destinatari).
export const maxDuration = 60;

const tabCls = (on: boolean) =>
  `tap inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium ${on ? "bg-brand text-white" : "text-ink-soft hover:bg-[var(--color-surface-2)]"}`;

export default async function PayerNotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const t = await getT();
  const user = await requirePermission("payers.view");
  const sp = await searchParams;
  const journal = sp.view === "jurnal";

  const tabs = (
    <div role="tablist" className="mb-3 inline-flex gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
      <Link href="/notificari-platitori" role="tab" aria-selected={!journal} className={tabCls(!journal)}>{t("Plătitori")}</Link>
      <Link href="/notificari-platitori?view=jurnal" role="tab" aria-selected={journal} className={tabCls(journal)}>{t("Jurnal notificări")}</Link>
    </div>
  );

  // ── Jurnalul notificărilor trimise plătitorilor (aceeași schemă de viteză ca la Plătitori: pagini sau „Toate” pe bucăți, rânduri virtualizate) ──
  if (journal) {
    const filters = sanitizeDeliveryState(sp);
    const jar = await cookies();
    const ps = normalizeDeliveryPs(sp.ps ?? jar.get(DELIVERY_PS_COOKIE)?.value);
    const page = ps === "all" ? 1 : Math.max(1, Math.floor(Number(sp.page)) || 1);
    const [initial, users] = await Promise.all([
      ps === "all"
        ? listPayerLogChunk(deliveryFilterFromState(filters), { limit: DELIVERY_FIRST_CHUNK }).then((c) => ({ ...c, page: 1, pageSize: DELIVERY_FIRST_CHUNK, totalPages: 1 }))
        : listPayerLog(deliveryFilterFromState(filters, page, normalizeDeliveryPageSize(ps))),
      auditUserOptions(),
    ]);
    return (
      <div className="w-full">
        {tabs}
        <p className="mb-3 text-sm text-ink-soft">
          {t("Toate notificările trimise plătitorilor din această pagină (email, SMS, apel vocal): cine a trimis, către cine, ce mesaj și dacă a ajuns. Click pe un rând pentru mesajul întreg.")}
        </p>
        <DeliveryLogsClient
          initial={JSON.parse(JSON.stringify(initial))}
          users={users}
          initialFilters={filters}
          initialPage={"page" in initial ? initial.page : 1}
          initialPs={ps}
          apiBase="/api/platitori/jurnal"
          pageBase="/notificari-platitori"
          pageParams="view=jurnal"
          mode="payers"
          storageKey="filters:payer-delivery"
        />
      </div>
    );
  }

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
      {tabs}
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
        canEditPayer={can(user, "payers.edit")}
      />
    </div>
  );
}
