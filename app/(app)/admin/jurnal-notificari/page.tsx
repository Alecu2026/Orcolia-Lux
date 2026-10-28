import { cookies } from "next/headers";
import { requireSuperAdmin } from "@/lib/dal";
import { auditUserOptions } from "@/lib/queries/audit";
import { deliveryFilterFromState, listDelivery, listDeliveryChunk, normalizeDeliveryPageSize } from "@/lib/queries/delivery";
import { DELIVERY_FIRST_CHUNK, DELIVERY_PS_COOKIE, normalizeDeliveryPs, sanitizeDeliveryState } from "@/lib/delivery-meta";
import DeliveryLogsClient from "@/app/components/DeliveryLogsClient";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

/**
 * Jurnalul notificărilor (pentru depanare): TOATE trimiterile — email, SMS, Telegram, push, notificări în aplicație — cu mesajul, destinatarul, cine le-a declanșat
 * și rezultatul (inclusiv erorile). Doar pentru super-admini; aceeași schemă de viteză ca la Audit Logs / Plătitori (pagini sau „Toate” pe bucăți, rânduri virtualizate).
 */
export default async function DeliveryLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  await requireSuperAdmin();
  const sp = await searchParams;
  const filters = sanitizeDeliveryState(sp);
  const jar = await cookies();
  const ps = normalizeDeliveryPs(sp.ps ?? jar.get(DELIVERY_PS_COOKIE)?.value);
  const page = ps === "all" ? 1 : Math.max(1, Math.floor(Number(sp.page)) || 1);

  const [initial, users] = await Promise.all([
    ps === "all"
      ? listDeliveryChunk(deliveryFilterFromState(filters), { limit: DELIVERY_FIRST_CHUNK }).then((c) => ({ ...c, page: 1, pageSize: DELIVERY_FIRST_CHUNK, totalPages: 1 }))
      : listDelivery(deliveryFilterFromState(filters, page, normalizeDeliveryPageSize(ps))),
    auditUserOptions(),
  ]);

  return (
    <div className="w-full">
      <div className="mb-3">
        <h1 className="text-lg font-bold">{t("Jurnal notificări")}</h1>
        <p className="text-xs text-ink-soft">{t("Toate emailurile, SMS-urile, mesajele Telegram și notificările trimise de aplicație — pentru depanare. Vizibil doar pentru super-admini; se păstrează 30 de zile (notificările în aplicație și push: 14 zile).")}</p>
      </div>
      <DeliveryLogsClient initial={JSON.parse(JSON.stringify(initial))} users={users} initialFilters={filters} initialPage={initial.page} initialPs={ps} />
    </div>
  );
}
