import { cookies } from "next/headers";
import { preload } from "react-dom";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { env } from "@/lib/env";
import InvoicesList from "@/app/components/InvoicesList";
import { INVOICES_PS_COOKIE, INVOICES_V_COOKIE } from "@/lib/payer-prefs";
import { normalizeInvoicePerPage, queryFromParams } from "@/lib/invoice-list";
import { ssrInvoicePage } from "@/lib/services/invoice-cache";
import { kickPaymentChains } from "@/lib/services/payment-chain";
import { after } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Facturi — aceeași schemă ca la Plătitori, dar pe LUNI (volumul real: sute de mii de facturi): fiecare lună de emitere e un snapshot în memoria serverului (vezi
 * lib/services/invoice-cache.ts); browserul primește luna / perioada aleasă o singură dată și o filtrează local, instant. Prima pagină se randează pe server din cache,
 * iar snapshot-ul lunii începe să se descarce din HTML (preload). Căutările peste perioade prea mari se fac pe server.
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requirePermission("invoices.view");
  const sp = await searchParams;
  const jar = await cookies();
  const query = queryFromParams({ get: (k) => sp[k] ?? null });
  const wantedPage = Math.max(1, Math.floor(Number(sp.page)) || 1);
  // Fără ?ps= în adresă se folosește ultima alegere (cookie): „Toate" apare complet din prima afișare.
  const perPage = normalizeInvoicePerPage(sp.ps ?? jar.get(INVOICES_PS_COOKIE)?.value);
  // Pe server desenăm cel mult 100 de rânduri; restul vin din lista locală (virtualizată).
  // statusurile „Achitată / Restantă” se calculează din avans / datorii: dacă istoricul nu e încă procesat, rularea continuă în fundal (nu așteaptă nimeni după ea)
  await kickPaymentChains((fn) => after(() => fn().catch((e) => console.error("[payment-chain] fundal:", e))));
  const res = await ssrInvoicePage(query, sp.m ?? null, wantedPage, Math.min(perPage, 100));

  // Prima vizită (sau luna s-a schimbat): browserul începe descărcarea primei luni chiar de la primirea HTML-ului. Dacă are deja versiunea curentă (cookie)
  // sau perioada e prea mare pentru browser (mod „server"), nu cerem nimic.
  const first = res.periodMonths[0];
  if (res.mode === "local" && first && res.firstVersion) {
    const mine = `${first}-${res.firstVersion.replace(/[^0-9a-zA-Z]/g, "")}`;
    if (!(jar.get(INVOICES_V_COOKIE)?.value ?? "").split(".").includes(mine)) preload(`/api/invoices/snapshot?month=${first}`, { as: "fetch", crossOrigin: "anonymous" });
  }

  return (
    <div className="w-full">
      <InvoicesList
        initial={{ items: res.items, page: res.page, total: res.total, totalPages: Math.max(1, Math.ceil(res.total / Math.min(perPage, 100))), perPage, query, period: res.period, months: res.months, sums: res.sums }}
        origin={env.appUrl}
        canImportApaCanal={can(user, "invoices.create") && can(user, "clients.create") && env.storage.enabled}
        canCreate={can(user, "invoices.create")}
        canEdit={can(user, "invoices.edit")}
        canDelete={can(user, "invoices.delete")}
      />
    </div>
  );
}
