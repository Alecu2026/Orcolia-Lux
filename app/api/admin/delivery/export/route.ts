import { requireSuperAdmin } from "@/lib/dal";
import { deliveryFilterFromState, exportDelivery } from "@/lib/queries/delivery";
import { PAYER_CAMPAIGN_KINDS, sanitizeDeliveryState } from "@/lib/delivery-meta";
import { deliveryCsvResponse } from "@/lib/delivery-csv";

export async function GET(req: Request) {
  await requireSuperAdmin();
  const sp = new URL(req.url).searchParams;
  const notKinds = sp.get("scope") === "workers" ? PAYER_CAMPAIGN_KINDS : undefined;
  const rows = await exportDelivery(deliveryFilterFromState(sanitizeDeliveryState(Object.fromEntries(sp.entries())), undefined, undefined, undefined, notKinds));
  return deliveryCsvResponse(rows);
}
