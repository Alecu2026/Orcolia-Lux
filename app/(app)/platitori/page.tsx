import Link from "next/link";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { env } from "@/lib/env";
import ImportButton from "@/app/components/ImportButton";
import ApaCanalApiSync from "@/app/components/ApaCanalApiSync";
import PayerNotifyManager from "@/app/components/PayerNotifyManager";
import { listPayers, listPayerMonths, countPayersNeedingNameFix, normalizePerPage } from "@/lib/queries/payers";
import { filtersToListOpts } from "@/lib/queries/payer-notify";
import { normalizePerPageClient, sanitizeFilters } from "@/lib/payer-notify";

export const dynamic = "force-dynamic";

/**
 * Plătitori — același tabel dens și aceleași filtre ca la „Notificări" (PayerNotifyManager, în modul de răsfoire):
 * filtre pe client (instant, salvate în localStorage), date pe server, click pe rând = datele plătitorului.
 */
export default async function PayersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("clients.view");
  const canImport = can(user, "clients.create") && can(user, "clients.edit");
  // Sincronizarea din API creează și facturi, deci cere și permisiunea de creare facturi.
  const canSyncApi = canImport && can(user, "invoices.create");
  const sp = await searchParams;

  // "status" e cheia veche (link-uri salvate) pentru "account".
  const filters = sanitizeFilters({ ...sp, account: sp.account ?? sp.status });
  const perPage = normalizePerPageClient(sp.perPage);
  const opts = { ...filtersToListOpts(filters), perPage: normalizePerPage(perPage) };
  let page = Math.max(1, Math.floor(Number(sp.page)) || 1);

  const [first, months, nameFixCount] = await Promise.all([
    listPayers({ ...opts, page }),
    listPayerMonths(),
    countPayersNeedingNameFix(),
  ]);
  let res = first;
  const lastPage = Math.max(1, Math.ceil(first.total / perPage));
  if (page > lastPage) {
    page = lastPage;
    res = await listPayers({ ...opts, page });
  }

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">Plătitori</h1>
          <p className="mt-0.5 text-sm text-ink-soft">Plătitori Apă-Canal — click pe un rând pentru datele lui, facturi și notificări.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/platitori/tabel"
            className="tap inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            Tabel 1C
          </Link>
          {canSyncApi && <ApaCanalApiSync />}
          {canImport && <ImportButton entity="payers" hideAi />}
        </div>
      </div>
      <PayerNotifyManager
        basePath="/platitori"
        browseOnly
        nameFixCount={nameFixCount}
        initial={{ filters, page, perPage, items: res.items, total: res.total }}
        months={months}
        initialTemplates={[]}
        canSend={false}
        emailEnabled={env.smtp.enabled}
        smsEnabled={env.sms.enabled}
        userEmail={user.email}
        userId={user.id}
        isAdmin={can(user, "admin")}
        canDelete={can(user, "clients.delete")}
      />
    </div>
  );
}
