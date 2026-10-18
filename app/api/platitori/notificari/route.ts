import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getPayer, getPayerInvoices, listPayers, normalizePerPage } from "@/lib/queries/payers";
import { prisma } from "@/lib/prisma";
import { filtersToListOpts } from "@/lib/queries/payer-notify";
import { normalizePerPageClient, sanitizeFilters } from "@/lib/payer-notify";

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
  if (!can(user, "clients.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });

  const sp = new URL(req.url).searchParams;

  // ?detail=<id> — datele din pop-up-ul unui plătitor (contor, ultimele facturi, istoricul notificărilor).
  const detailId = sp.get("detail");
  if (detailId) {
    if (!/^[0-9a-f]{24}$/i.test(detailId)) return Response.json({ error: "Id invalid." }, { status: 400 });
    const [payer, invoices, notifications] = await Promise.all([
      getPayer(detailId),
      getPayerInvoices(detailId),
      prisma.payerNotificationLog.findMany({
        where: { clientId: detailId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { id: true, channel: true, status: true, error: true, subject: true, body: true, userName: true, createdAt: true },
      }),
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
      invoices: invoices.slice(0, 5).map((i) => ({
        id: i.id, number: i.number, status: i.status, grandTotal: i.grandTotal, currency: i.currency,
        issueDate: i.issueDate, billingPeriodLabel: i.billingPeriodLabel,
      })),
      notifications,
    });
  }
  const filters = sanitizeFilters(sp);
  const page = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
  const perPage = normalizePerPage(normalizePerPageClient(sp.get("perPage")));

  try {
    const res = await listPayers({ ...filtersToListOpts(filters), page, perPage });
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
