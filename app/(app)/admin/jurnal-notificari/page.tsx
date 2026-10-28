import Link from "next/link";
import { cookies } from "next/headers";
import { requireSuperAdmin } from "@/lib/dal";
import { auditUserOptions } from "@/lib/queries/audit";
import { deliveryFilterFromState, listDelivery, listDeliveryChunk, normalizeDeliveryPageSize } from "@/lib/queries/delivery";
import { listPayerLog, listPayerLogChunk } from "@/lib/queries/payer-log";
import { DELIVERY_FIRST_CHUNK, DELIVERY_PS_COOKIE, KIND_OPTIONS, PAYER_CAMPAIGN_KINDS, normalizeDeliveryPs, sanitizeDeliveryState } from "@/lib/delivery-meta";
import DeliveryLogsClient from "@/app/components/DeliveryLogsClient";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

type Scope = "all" | "workers" | "payers";

const tabCls = (on: boolean) =>
  `tap inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium ${on ? "bg-brand text-white" : "text-ink-soft hover:bg-[var(--color-surface-2)]"}`;

/**
 * Jurnalul notificărilor (pentru depanare), cu trei vederi: „Toate” (orice trimitere: email, SMS, Telegram, push, în aplicație), „Lucrători” (tot ce NU e notificare către plătitori:
 * reamintiri, sarcini, tichete, coduri, mesaje de sistem) și „Notificări plătitori” (toate trimiterile din pagina Notificări plătitori — email, SMS, apel vocal — din istoricul permanent).
 * Doar pentru super-admini; aceeași schemă de viteză ca la Audit Logs / Plătitori (pagini sau „Toate” pe bucăți, rânduri virtualizate).
 */
export default async function DeliveryLogsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  await requireSuperAdmin();
  const sp = await searchParams;
  const scope: Scope = sp.scope === "workers" ? "workers" : sp.scope === "payers" ? "payers" : "all";
  const filters = sanitizeDeliveryState(sp);
  const jar = await cookies();
  const ps = normalizeDeliveryPs(sp.ps ?? jar.get(DELIVERY_PS_COOKIE)?.value);
  const page = ps === "all" ? 1 : Math.max(1, Math.floor(Number(sp.page)) || 1);
  const notKinds = scope === "workers" ? PAYER_CAMPAIGN_KINDS : undefined;

  const [initial, users] = await Promise.all([
    scope === "payers"
      ? ps === "all"
        ? listPayerLogChunk(deliveryFilterFromState(filters), { limit: DELIVERY_FIRST_CHUNK }).then((c) => ({ ...c, page: 1, pageSize: DELIVERY_FIRST_CHUNK, totalPages: 1 }))
        : listPayerLog(deliveryFilterFromState(filters, page, normalizeDeliveryPageSize(ps)))
      : ps === "all"
        ? listDeliveryChunk(deliveryFilterFromState(filters, undefined, undefined, undefined, notKinds), { limit: DELIVERY_FIRST_CHUNK }).then((c) => ({ ...c, page: 1, pageSize: DELIVERY_FIRST_CHUNK, totalPages: 1 }))
        : listDelivery(deliveryFilterFromState(filters, page, normalizeDeliveryPageSize(ps), undefined, notKinds)),
    auditUserOptions(),
  ]);

  const tab = (s: Scope, label: string) => (
    <Link href={s === "all" ? "/admin/jurnal-notificari" : `/admin/jurnal-notificari?scope=${s}`} role="tab" aria-selected={scope === s} className={tabCls(scope === s)}>
      {label}
    </Link>
  );

  return (
    <div className="w-full">
      <div className="mb-3">
        <h1 className="text-lg font-bold">{t("Jurnal notificări")}</h1>
        <p className="text-xs text-ink-soft">
          {scope === "payers"
            ? t("Toate notificările trimise plătitorilor din pagina Notificări plătitori (email, SMS, apel vocal) — istoricul permanent, cu cine le-a trimis, mesajul și rezultatul.")
            : scope === "workers"
              ? t("Notificările către lucrători și mesajele automate ale sistemului (reamintiri, sarcini, tichete, coduri, mesaje de sistem) — fără notificările către plătitori. Vizibil doar pentru super-admini; se păstrează 30 de zile (notificările în aplicație și push: 14 zile).")
              : t("Toate emailurile, SMS-urile, mesajele Telegram și notificările trimise de aplicație — pentru depanare. Vizibil doar pentru super-admini; se păstrează 30 de zile (notificările în aplicație și push: 14 zile).")}
        </p>
      </div>
      <div role="tablist" className="mb-3 inline-flex gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1">
        {tab("all", t("Toate"))}
        {tab("workers", t("Lucrători"))}
        {tab("payers", t("Notificări plătitori"))}
      </div>
      <DeliveryLogsClient
        key={scope}
        initial={JSON.parse(JSON.stringify(initial))}
        users={users}
        initialFilters={filters}
        initialPage={"page" in initial ? initial.page : 1}
        initialPs={ps}
        {...(scope === "payers"
          ? { apiBase: "/api/admin/delivery/payers", mode: "payers" as const, pageParams: "scope=payers", storageKey: "filters:delivery-payers" }
          : scope === "workers"
            ? { apiParams: "scope=workers", pageParams: "scope=workers", storageKey: "filters:delivery-workers", kindOptions: KIND_OPTIONS.filter((k) => !(PAYER_CAMPAIGN_KINDS as readonly string[]).includes(k.key)) }
            : {})}
      />
    </div>
  );
}
