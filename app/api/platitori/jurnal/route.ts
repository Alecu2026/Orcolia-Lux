import { payerDeliveryList } from "@/lib/payer-delivery-api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Jurnalul notificărilor trimise plătitorilor (lista, pe pagini sau „Toate” pe bucăți). Vezi lib/payer-delivery-api.ts. */
export async function GET(req: Request) {
  return payerDeliveryList(req);
}
