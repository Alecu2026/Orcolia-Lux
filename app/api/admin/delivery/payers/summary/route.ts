import { payerLogSummaryResponse, superAdminGuard } from "@/lib/payer-delivery-api";

export const dynamic = "force-dynamic";

export async function GET() {
  return payerLogSummaryResponse(superAdminGuard);
}
