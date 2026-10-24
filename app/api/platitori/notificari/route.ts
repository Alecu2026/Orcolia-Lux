import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getPayer, getPayerInvoices, listPayers, normalizePerPage } from "@/lib/queries/payers";
import { prisma } from "@/lib/prisma";
import { filtersToListOptsAsync, listPayerNotes } from "@/lib/queries/payer-notify";
import { normalizePerPageClient, sanitizeFilters } from "@/lib/payer-notify";
import { listPayersFromSnap } from "@/lib/services/payer-cache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Tabelul de notificări: plătitorii filtrați/sortați/paginați pe server. Clientul trimite filtrele ca
 * query-string (aceleași chei ca în `NotifyFilters`) și poate anula cererea (AbortController) când
 * utilizatorul schimbă iar un filtru — de aceea GET, nu server action (acestea se execută pe rând).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const sp = new URL(req.url).searchParams;

  // ?detail=<id> — datele din pop-up-ul unui plătitor (contor, ultimele facturi, istoricul notificărilor).
  const detailId = sp.get("detail");
  if (detailId) {
    if (!/^[0-9a-f]{24}$/i.test(detailId)) return Response.json({ error: "Id invalid." }, { status: 400 });
    const [payer, invoices, notifications, notes] = await Promise.all([
      getPayer(detailId),
      getPayerInvoices(detailId),
      prisma.payerNotificationLog.findMany({
        where: { clientId: detailId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, channel: true, status: true, error: true, subject: true, body: true, userName: true, createdAt: true },
      }),
      listPayerNotes(detailId, 50),
    ]);
    if (!payer) return Response.json({ error: "Plătitor inexistent." }, { status: 404 });
    return Response.json({
      payer: {
        notes: payer.notes,
        meterNumber: payer.meterNumber,
        meterCurrReading: payer.meterCurrReading,
        portalActivatedAt: payer.portalActivatedAt,
        portalLastLoginAt: payer.portalLastLoginAt,
      },
      // toate facturile (cele mai noi primele); plafon de siguranță, ca un răspuns să nu crească nemărginit
      invoices: invoices.slice(0, 300).map((i) => ({
        id: i.id, publicToken: i.publicToken, number: i.number, status: i.status, grandTotal: i.grandTotal, currency: i.currency,
        issueDate: i.issueDate, dueDate: i.dueDate, paidAt: i.paidAt, billingPeriodLabel: i.billingPeriodLabel,
      })),
      notifications,
      notes,
    });
  }
  const filters = sanitizeFilters(sp);
  const page = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
  // Plafon la 1000 de rânduri: un răspuns obișnuit de funcție nu poate depăși ~4,5 MB pe Vercel („Toate" = 19.000 de rânduri → 500).
  // „Toate" se servește din snapshot-ul local (vezi /api/platitori/snapshot), nu de aici.
  const perPage = Math.min(1000, normalizePerPage(normalizePerPageClient(sp.get("perPage"))));

  try {
    // Din cache-ul zilnic, filtrat în memorie (milisecunde); dacă nu se poate, revine la interogarea în baza de date.
    try {
      const fast = await listPayersFromSnap(filters, page, perPage);
      return Response.json({ items: fast.items, total: fast.total, page: fast.page, perPage });
    } catch (e) {
      console.error("[notificari-platitori] cache indisponibil, citesc din baza de date:", e);
    }
    const res = await listPayers({ ...(await filtersToListOptsAsync(filters)), page, perPage });
    return Response.json({
      items: res.items,
      total: res.total,
      page: res.page,
      perPage: "perPage" in res ? res.perPage : perPage,
    });
  } catch (e) {
    console.error("[notificari-platitori] listare eșuată:", e);
    return Response.json({ error: "Nu am putut încărca lista de plătitori." }, { status: 500 });
  }
}
