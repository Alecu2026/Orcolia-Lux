import { payerLogSummaryResponse, payersViewGuard } from "@/lib/payer-delivery-api";

export const dynamic = "force-dynamic";

export async function GET() {
  return payerLogSummaryResponse(payersViewGuard);
}
