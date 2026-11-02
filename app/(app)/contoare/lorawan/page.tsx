import Link from "next/link";
import { requirePermission } from "@/lib/dal";
import { getT } from "@/lib/i18n/server-t";
import { getLorawanStatus } from "@/lib/services/lorawan";
import LorawanPanel from "@/app/components/LorawanPanel";

export const dynamic = "force-dynamic";

/** Contoarele LoRaWAN: starea ultimei extrageri (cea automată de la 23:30 sau pornită manual), ce s-a găsit în CRM, ce s-a ignorat și numerele fără corespondent. */
export default async function LorawanPage() {
  const t = await getT();
  await requirePermission("meters.manage");
  const status = await getLorawanStatus();
  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">LoRaWAN</h1>
          <p className="mt-0.5 text-sm text-ink-soft">{t("Contoarele care transmit automat indexul. Extragerea pornește singură în fiecare zi la 23:30.")}</p>
        </div>
        <Link href="/contoare" className="tap inline-flex h-9 items-center rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]">
          {t("Contoare")}
        </Link>
      </div>
      <LorawanPanel initial={status} />
    </div>
  );
}
