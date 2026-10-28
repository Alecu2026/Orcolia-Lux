import { requireSuperAdmin } from "@/lib/dal";
import { deliveryFilterFromState, exportDelivery } from "@/lib/queries/delivery";
import { sanitizeDeliveryState } from "@/lib/delivery-meta";
import { deliveryCsvResponse } from "@/lib/delivery-csv";

export async function GET(req: Request) {
  await requireSuperAdmin();
  const sp = new URL(req.url).searchParams;
  const rows = await exportDelivery(deliveryFilterFromState(sanitizeDeliveryState(Object.fromEntries(sp.entries()))));
  return deliveryCsvResponse(rows);
}
