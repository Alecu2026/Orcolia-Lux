"use client";

import { useMemo } from "react";
import DataTable, { type Col } from "./DataTable";
import { useT } from "@/lib/i18n/context";
import type { PortalAccountRow } from "@/lib/portal-accounts";
import { portalAccountFilters } from "./portal-account-filters";
import { usePortalAccountsDataset } from "./usePortalAccountsDataset";

const TZ = "Europe/Chisinau";
const dmy = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }) : null;
const dash = <span className="text-ink-soft/60">—</span>;

/**
 * Simulare → Portal clienți: toate conturile ACTIVATE din portal (zeci de mii), într-un tabel cu aceleași filtre ca „Conturi portal clienți": căutare după nume / cont / contract / email, ultima logare,
 * data activării, furnizor de email… Lista completă stă în browser (descărcată o dată, comprimată, păstrată în IndexedDB), iar filtrarea, sortarea și paginarea rulează local — nu se mai caută în baza
 * de date la fiecare apăsare. Implicit, cei conectați cel mai recent sunt primii. „Intră în portal” pornește simularea (formular POST, ca până acum).
 */
export default function SimulatePortalTable({ initial, total, activeTotal, q }: { initial: PortalAccountRow[]; total: number; activeTotal: number; q?: string }) {
  const t = useT();
  const { rows, full, loading, error, refresh } = usePortalAccountsDataset(initial, total);
  // simularea cere cont activat: celelalte conturi nu au cum să fie simulate
  const active = useMemo(() => rows.filter((r) => r.activated), [rows]);
  const filters = useMemo(() => portalAccountFilters(false), []);

  const columns: Col<PortalAccountRow>[] = useMemo(
    () => [
      {
        key: "go", label: "", minW: 110, sticky: true,
        render: (r) => (
          <form method="post" action="/api/simulare/portal" onClick={(e) => e.stopPropagation()}>
            <input type="hidden" name="clientId" value={r.id} />
            <button type="submit" data-enter-portal={r.id} className="tap h-6 cursor-pointer rounded-md bg-brand px-2 text-[11px] font-semibold text-white hover:bg-brand-strong">
              {t("Intră în portal")}
            </button>
          </form>
        ),
      },
      { key: "name", label: "Nume", minW: 200, maxW: 300, sort: (r) => r.name, render: (r) => <span className="font-medium" title={r.name}>{r.name}</span> },
      { key: "acc", label: "Cont / contract", minW: 120, sort: (r) => r.account ?? r.contract, render: (r) => <span className="tabular-nums">{r.account ?? r.contract ?? dash}</span> },
      { key: "email", label: "Email", minW: 180, maxW: 260, sort: (r) => r.email, render: (r) => (r.email ? <span title={r.email}>{r.email}</span> : dash) },
      { key: "login", label: "Ultima logare", minW: 100, sort: (r) => r.lastLoginAt, render: (r) => dmy(r.lastLoginAt) ?? dash },
      { key: "act", label: "Activat la", minW: 90, sort: (r) => r.activatedAt, render: (r) => dmy(r.activatedAt) ?? dash },
      { key: "contract", label: "Contract", minW: 110, defaultHidden: true, sort: (r) => r.contract, render: (r) => r.contract ?? dash },
    ],
    [t],
  );

  return (
    <div data-simulate-portal="" data-full={full ? "1" : "0"}>
      {!full && !error && (
        <p className="mb-1.5 flex items-center gap-2 text-xs text-ink-soft" data-loading-full="">
          <span className="inline-block size-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
          {t("Se încarcă lista completă ({n} conturi)… Până atunci: primele {m}.", { n: activeTotal.toLocaleString("ro-RO"), m: initial.length })}
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
        storageKey="simulate-portal"
        rows={active}
        columns={columns}
        filters={filters}
        defaultSort={{ key: "login", dir: "desc" }}
        presetValues={q ? { q } : undefined}
        noun="conturi active"
        emptyText={t("Niciun cont de portal găsit.")}
        pending={full ? undefined : { total: activeTotal }}
      />
    </div>
  );
}
