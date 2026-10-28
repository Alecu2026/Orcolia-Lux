import { payerLogList, payersViewGuard } from "@/lib/payer-delivery-api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Jurnalul „Notificări plătitori” (toate trimiterile din pagina Notificări plătitori), pe pagini sau „Toate” pe bucăți. Vezi lib/payer-delivery-api.ts. */
export async function GET(req: Request) {
  return payerLogList(req, payersViewGuard);
}
