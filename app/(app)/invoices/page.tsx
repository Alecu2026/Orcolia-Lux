import { cookies } from "next/headers";
import { preload } from "react-dom";
import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { env } from "@/lib/env";
import InvoicesList from "@/app/components/InvoicesList";
import { INVOICES_PS_COOKIE, INVOICES_V_COOKIE } from "@/lib/payer-prefs";
import { INVOICE_STATUS_CODES, normalizeInvoicePerPage } from "@/lib/invoice-list";
import { ssrInvoicePage } from "@/lib/services/invoice-cache";

export const dynamic = "force-dynamic";

/**
 * Facturi — aceeași schemă ca la Plătitori: lista (din cache-ul zilnic, vezi lib/services/invoice-cache.ts) vine în browser o singură dată și se filtrează
 * local, instant; prima pagină se randează pe server din cache, fără interogări grele; lista completă începe să se descarce din HTML (preload).
 */
export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string; page?: string; ps?: string }>;
}) {
  const user = await requirePermission("invoices.view");
  const sp = await searchParams;
  const jar = await cookies();
  const status = (INVOICE_STATUS_CODES as readonly string[]).includes(sp.status ?? "") ? (sp.status as string) : "";
  const q = sp.q?.trim().slice(0, 100) || "";
  const wantedPage = Math.max(1, Math.floor(Number(sp.page)) || 1);
  // Fără ?ps= în adresă se folosește ultima alegere (cookie): „Toate" apare complet din prima afișare.
  const perPage = normalizeInvoicePerPage(sp.ps ?? jar.get(INVOICES_PS_COOKIE)?.value);
  // Pe server desenăm cel mult 100 de rânduri; restul vin din lista locală (virtualizată).
  const res = await ssrInvoicePage({ status, q }, wantedPage, Math.min(perPage, 100));

  // Prima vizită (sau lista s-a schimbat): browserul începe descărcarea listei complete chiar de la primirea HTML-ului. Dacă are deja versiunea curentă
  // (cookie) sau sunt prea multe facturi pentru browser (mod „server"), nu cerem nimic.
  if (res.mode === "snapshot" && (!res.version || jar.get(INVOICES_V_COOKIE)?.value !== res.version)) {
    preload("/api/invoices/snapshot", { as: "fetch", crossOrigin: "anonymous" });
  }

  return (
    <div className="w-full">
      <InvoicesList
        initial={{ items: res.items, page: res.page, total: res.total, totalPages: Math.max(1, Math.ceil(res.total / Math.min(perPage, 100))), perPage, status, q }}
        mode={res.mode}
        origin={env.appUrl}
        canImportApaCanal={can(user, "invoices.create") && can(user, "clients.create") && env.storage.enabled}
        canCreate={can(user, "invoices.create")}
        canEdit={can(user, "invoices.edit")}
        canDelete={can(user, "invoices.delete")}
      />
    </div>
  );
}
