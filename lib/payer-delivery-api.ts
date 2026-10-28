import "server-only";
import { getCurrentUser, isSuper } from "./dal";
import { can } from "./permissions";
import { sanitizeDeliveryState } from "./delivery-meta";
import { deliveryFilterFromState, normalizeDeliveryPageSize } from "./queries/delivery";
import { exportPayerLog, getPayerLogDetail, listPayerLog, listPayerLogChunk, payerLogSummary } from "./queries/payer-log";
import { deliveryCsvResponse } from "./delivery-csv";

/**
 * Jurnalul „Notificări plătitori” (toate trimiterile din pagina Notificări plătitori — vezi lib/queries/payer-log.ts) ca răspunsuri HTTP.
 * Două intrări cu aceleași date: pagina Notificări plătitori (oricine are „Plătitori – Vizualizare”) și Jurnalul din Admin (doar super-admin).
 */
export type Guard = () => Promise<Response | null>;

export const payersViewGuard: Guard = async () => {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  return null;
};

export const superAdminGuard: Guard = async () => {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!isSuper(user)) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  return null;
};

export async function payerLogList(req: Request, guard: Guard): Promise<Response> {
  const denied = await guard();
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const state = sanitizeDeliveryState(Object.fromEntries(sp.entries()));
  const fresh = sp.get("fresh") === "1";
  try {
    if (sp.get("ps") === "all") {
      const res = await listPayerLogChunk(deliveryFilterFromState(state), { cursor: sp.get("cursor") ?? undefined, limit: Number(sp.get("limit")) || undefined, loaded: Number(sp.get("loaded")) || 0, fresh });
      return Response.json(res, { headers: { "Cache-Control": "private, no-store" } });
    }
    const page = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
    const res = await listPayerLog({ ...deliveryFilterFromState(state, page, normalizeDeliveryPageSize(sp.get("ps"))), fresh });
    return Response.json(res, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[payer-log] listă eșuată:", e);
    return Response.json({ error: "Nu am putut încărca jurnalul." }, { status: 500 });
  }
}

export async function payerLogSummaryResponse(guard: Guard): Promise<Response> {
  const denied = await guard();
  if (denied) return denied;
  return Response.json(await payerLogSummary(), { headers: { "Cache-Control": "private, no-store" } });
}

export async function payerLogDetail(id: string, guard: Guard): Promise<Response> {
  const denied = await guard();
  if (denied) return denied;
  try {
    const detail = await getPayerLogDetail(id);
    if (!detail) return Response.json({ error: "Mesajul nu există." }, { status: 404 });
    return Response.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[payer-log] detaliu eșuat:", e);
    return Response.json({ error: "Nu am putut încărca detaliile." }, { status: 500 });
  }
}

export async function payerLogExport(req: Request, guard: Guard): Promise<Response> {
  const denied = await guard();
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const rows = await exportPayerLog(deliveryFilterFromState(sanitizeDeliveryState(Object.fromEntries(sp.entries()))));
  return deliveryCsvResponse(rows);
}
