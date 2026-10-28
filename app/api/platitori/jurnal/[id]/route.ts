import { payerDeliveryDetail } from "@/lib/payer-delivery-api";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return payerDeliveryDetail(id);
}
