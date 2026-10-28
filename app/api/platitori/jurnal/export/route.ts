import { payerLogExport, payersViewGuard } from "@/lib/payer-delivery-api";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return payerLogExport(req, payersViewGuard);
}
