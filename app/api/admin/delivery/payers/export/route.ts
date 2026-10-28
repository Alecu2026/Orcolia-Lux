import { payerLogExport, superAdminGuard } from "@/lib/payer-delivery-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return payerLogExport(req, superAdminGuard);
}
