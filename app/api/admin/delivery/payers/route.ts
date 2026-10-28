import { payerLogList, superAdminGuard } from "@/lib/payer-delivery-api";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Jurnalul „Notificări plătitori” din Admin (doar super-admini): aceleași date ca pe pagina Notificări plătitori. */
export async function GET(req: Request) {
  return payerLogList(req, superAdminGuard);
}
