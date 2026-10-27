import Link from "next/link";
import { cookies } from "next/headers";
import { preload } from "react-dom";
import { requirePermission } from "@/lib/dal";
import { METERS_PP_COOKIE, METERS_V_COOKIE } from "@/lib/payer-prefs";
import { can } from "@/lib/permissions";
import MetersManager from "@/app/components/MetersManager";
import { timed } from "@/lib/timing";
import { listMetersFromSnap } from "@/lib/services/meter-cache";
import { sanitizeMeterFilters, type MeterRowBase } from "@/lib/meters";
import { normalizePerPageClient } from "@/lib/payer-notify";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

/** Cât așteaptă pagina lista de pe server înainte să o lase pe seama browserului. */
const BUILD_WAIT_MS = 6000;

/** Rezultatul, sau null dacă nu vine în `ms` milisecunde (operația continuă în fundal și își termină treaba). */
async function withinMs<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), ms); });
  try {
    return await Promise.race([work, wait]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Contoare — toate contoarele (nu doar câte unul pe plătitor): același tabel dens, aceleași filtre instant și același pop-up ca la Plătitori.
 * Datele vin din exportul 1C (și Axioma pentru abonații fără contor în 1C), din cache-ul din memorie — vezi lib/services/meter-cache.ts.
 */
export default async function MetersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const t = await getT();
  const user = await requirePermission("payers.view");
  const sp = await searchParams;

  const filters = sanitizeMeterFilters(sp);
  const jar = await cookies();
  // Fără ?perPage= în adresă, se folosește ultima alegere a utilizatorului (cookie): „Toate" apare complet din prima afișare.
  const perPage = normalizePerPageClient(sp.perPage ?? jar.get(METERS_PP_COOKIE)?.value);
  // Prima încărcare: cel mult 100 de rânduri de pe server (pentru „Toate" lista completă vine apoi din snapshot-ul local).
  const ssrPerPage = Math.min(perPage, 100);

  let items: MeterRowBase[] = [];
  let total = 0;
  let page = 1;
  let version: string | null = null;
  let failed = false;
  let warming = false;
  try {
    // La prima construire a listei (după o sincronizare 1C sau după o repornire fără cache) citirea durează zeci de secunde: nu ținem HTML-ul în așteptare,
    // ci deschidem pagina, iar browserul cere lista (aceeași construire, partajată) și o afișează când e gata.
    const res = await timed("contoare/cache", withinMs(listMetersFromSnap(filters, Math.max(1, Math.floor(Number(sp.page)) || 1), ssrPerPage), BUILD_WAIT_MS));
    if (res) ({ items, total, page, version } = res);
    else warming = true;
  } catch (e) {
    // Lista nu se poate citi acum: pagina se deschide totuși, iar browserul reîncearcă singur (și arată eroarea cu „Reîncearcă").
    console.error("[contoare] cache indisponibil:", e);
    failed = true;
  }

  // Prima vizită (sau lista s-a schimbat): browserul începe descărcarea listei complete chiar de la primirea HTML-ului, în paralel cu JS.
  if (!version || jar.get(METERS_V_COOKIE)?.value !== version) preload("/api/contoare/snapshot", { as: "fetch", crossOrigin: "anonymous" });

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">{t("Contoare")}</h1>
          <p className="mt-0.5 text-sm text-ink-soft">{t("Toate contoarele de apă — click pe un rând pentru citiri, calcul și abonat. Contoarele de la aceeași adresă apar toate.")}</p>
        </div>
        <Link
          href="/platitori"
          className="tap inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]"
        >
          {t("Plătitori")}
        </Link>
      </div>
      <MetersManager initial={{ filters, page, perPage, items, total }} serverFailed={failed} warming={warming} canTask={can(user, "tasks.create")} canEditInvoices={can(user, "invoices.edit")} />
    </div>
  );
}
