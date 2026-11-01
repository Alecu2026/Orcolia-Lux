"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DataTable, { type Col } from "./DataTable";
import { portalAccountFilters } from "./portal-account-filters";
import { useT } from "@/lib/i18n/context";
import type { PortalAccountRow } from "@/lib/portal-accounts";
import { usePortalAccountsDataset } from "./usePortalAccountsDataset";

export type { PortalAccountRow };

const TZ = "Europe/Chisinau";
const dmy = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }) : null;
const dash = <span className="text-ink-soft/60">—</span>;

/**
 * Conturile din portalul clienților: lista completă stă în browser (descărcată o dată, comprimată, apoi păstrată în IndexedDB și reîntrebată condiționat), iar filtrarea, sortarea și
 * paginarea rulează local, cu orice număr de rânduri pe pagină. Pagina vine cu primele rânduri (`initial`) ca să nu fie goală cât se aduce lista completă.
 */
export default function PortalAccountsTable({ initial, total }: { initial: PortalAccountRow[]; total: number }) {
  const t = useT();
  const router = useRouter();
  const { rows, full, loading, error, refresh } = usePortalAccountsDataset(initial, total);

  const columns: Col<PortalAccountRow>[] = useMemo(
    () => [
      {
        key: "name", label: "Nume", minW: 200, maxW: 300, sticky: true, sort: (r) => r.name,
        render: (r) => (
          <Link href={`/platitori/${r.id}`} onClick={(e) => e.stopPropagation()} className="cursor-pointer font-medium text-brand-strong hover:underline" title={r.name}>
            {r.name}
          </Link>
        ),
      },
      { key: "acc", label: "Cont / contract", minW: 120, sort: (r) => r.account ?? r.contract, render: (r) => <span className="tabular-nums">{r.account ?? r.contract ?? dash}</span> },
      { key: "email", label: "Email", minW: 180, maxW: 260, sort: (r) => r.email, render: (r) => (r.email ? <span title={r.email}>{r.email}</span> : dash) },
      {
        key: "status", label: "Status", minW: 90, sort: (r) => (r.activated ? 1 : 0),
        render: (r) =>
          r.activated ? (
            <span className="inline-block rounded-full bg-brand-soft px-2 text-[10px] font-medium leading-[14px] text-brand-strong">{t("Activat")}</span>
          ) : (
            <span className="inline-block rounded-full bg-[var(--color-surface-2)] px-2 text-[10px] font-medium leading-[14px] text-ink-soft">{t("Neactivat")}</span>
          ),
      },
      { key: "act", label: "Activat la", minW: 90, sort: (r) => r.activatedAt, render: (r) => dmy(r.activatedAt) ?? dash },
      { key: "login", label: "Ultima logare", minW: 100, sort: (r) => r.lastLoginAt, render: (r) => dmy(r.lastLoginAt) ?? dash },
      { key: "kind", label: "Identificare", minW: 110, defaultHidden: true, sort: (r) => (r.account ? "cont" : "contract"), render: (r) => (r.account ? "Cont personal" : "Contract") },
      { key: "contract", label: "Contract", minW: 110, defaultHidden: true, sort: (r) => r.contract, render: (r) => r.contract ?? dash },
      { key: "created", label: "Creat la", minW: 90, defaultHidden: true, sort: (r) => r.createdAt, render: (r) => dmy(r.createdAt) ?? dash },
    ],
    [],
  );

  const filters = useMemo(() => portalAccountFilters(true), []);

  const activated = rows.filter((r) => r.activated).length;

  return (
    <div data-portal-accounts="" data-full={full ? "1" : "0"}>
    {!full && !error && (
      <p className="mb-1.5 flex items-center gap-2 text-xs text-ink-soft" data-loading-full="">
        <span className="inline-block size-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        {t("Se încarcă lista completă ({n} conturi)… Până atunci: primele {m}.", { n: total.toLocaleString("ro-RO"), m: initial.length })}
      </p>
    )}
    {error && (
      <p className="mb-1.5 flex items-center justify-between gap-3 rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">
        {error}
        <button type="button" onClick={() => void refresh()} className="tap shrink-0 font-semibold underline">{t("Reîncearcă")}</button>
      </p>
    )}
    {loading && full && <div className="mb-1.5 h-0.5 animate-pulse rounded-full bg-brand opacity-60" />}
    <DataTable
      storageKey="portal-accounts"
      rows={rows}
      columns={columns}
      filters={filters}
      defaultSort={{ key: "name", dir: "asc" }}
      noun="conturi"
      emptyText={t("Niciun cont găsit.")}
      onRowClick={(r) => router.push(`/platitori/${r.id}`)}
      summaryExtra={(f) => (
        <span className="text-ink-soft">
          {t("· activate:")} <b className="text-ink">{f.filter((r) => r.activated).length.toLocaleString("ro-RO")}</b> {t("din")} {f.length.toLocaleString("ro-RO")} ({t("în total")} {activated.toLocaleString("ro-RO")} {t("din")} {rows.length.toLocaleString("ro-RO")})
        </span>
      )}
    />
    </div>
  );
}
