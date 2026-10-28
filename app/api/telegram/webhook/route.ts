import { after } from "next/server";
import { withDeliveryMeta } from "@/lib/delivery-log";
import { env } from "@/lib/env";
import { handleUpdate } from "@/lib/services/telegram-bot";

export async function POST(req: Request) {
  // Verifică secret token-ul setat la înregistrarea webhook-ului
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!env.telegram.webhookSecret || secret !== env.telegram.webhookSecret) {
    return new Response("forbidden", { status: 401 });
  }

  const update = await req.json().catch(() => null);
  if (!update) return new Response("bad request", { status: 400 });

  // Procesare în fundal — răspundem 200 imediat
  after(() => withDeliveryMeta({ source: "bot" }, () => handleUpdate(update)).catch(() => {}));
  return new Response("ok");
}
