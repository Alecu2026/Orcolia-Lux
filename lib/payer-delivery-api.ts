import "server-only";
import { getCurrentUser } from "./dal";
import { can } from "./permissions";
import { PAYER_DELIVERY_KINDS, sanitizeDeliveryState } from "./delivery-meta";
import { deliveryFilterFromState, deliverySummary, exportDelivery, getDeliveryDetail, listDelivery, listDeliveryChunk, normalizeDeliveryPageSize } from "./queries/delivery";
import { deliveryCsvResponse } from "./delivery-csv";

/**
 * Jurnalul notificărilor trimise PLĂTITORILOR (pagina Notificări plătitori): aceleași date ca jurnalul complet, dar doar tipurile de mesaje către plătitori
 * (campanii, teste, facturi pe email — niciodată coduri de verificare, mesaje către colegi etc.) și pentru oricine are voie să vadă plătitorii.
 */
const kinds = PAYER_DELIVERY_KINDS;

async function guard(): Promise<Response | null> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "payers.view")) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  return null;
}

export async function payerDeliveryList(req: Request): Promise<Response> {
  const denied = await guard();
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const state = sanitizeDeliveryState(Object.fromEntries(sp.entries()));
  const fresh = sp.get("fresh") === "1";
  try {
    if (sp.get("ps") === "all") {
      const res = await listDeliveryChunk(deliveryFilterFromState(state, undefined, undefined, kinds), { cursor: sp.get("cursor") ?? undefined, limit: Number(sp.get("limit")) || undefined, loaded: Number(sp.get("loaded")) || 0, fresh });
      return Response.json(res, { headers: { "Cache-Control": "private, no-store" } });
    }
    const page = Math.max(1, Math.floor(Number(sp.get("page"))) || 1);
    const res = await listDelivery({ ...deliveryFilterFromState(state, page, normalizeDeliveryPageSize(sp.get("ps")), kinds), fresh });
    return Response.json(res, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[payer-delivery] listă eșuată:", e);
    return Response.json({ error: "Nu am putut încărca jurnalul." }, { status: 500 });
  }
}

export async function payerDeliverySummary(): Promise<Response> {
  const denied = await guard();
  if (denied) return denied;
  return Response.json(await deliverySummary(kinds), { headers: { "Cache-Control": "private, no-store" } });
}

export async function payerDeliveryDetail(id: string): Promise<Response> {
  const denied = await guard();
  if (denied) return denied;
  try {
    const detail = await getDeliveryDetail(id, kinds);
    if (!detail) return Response.json({ error: "Mesajul nu există." }, { status: 404 });
    return Response.json(detail, { headers: { "Cache-Control": "private, no-store" } });
  } catch (e) {
    console.error("[payer-delivery] detaliu eșuat:", e);
    return Response.json({ error: "Nu am putut încărca detaliile." }, { status: 500 });
  }
}

export async function payerDeliveryExport(req: Request): Promise<Response> {
  const denied = await guard();
  if (denied) return denied;
  const sp = new URL(req.url).searchParams;
  const rows = await exportDelivery(deliveryFilterFromState(sanitizeDeliveryState(Object.fromEntries(sp.entries())), undefined, undefined, kinds));
  return deliveryCsvResponse(rows);
}
