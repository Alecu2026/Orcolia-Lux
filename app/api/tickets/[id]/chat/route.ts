import { after } from "next/server";
import { isRateLimited } from "@/lib/rate-limit";
import { CHAT_MAX_BODY } from "@/lib/ticket-chat-shared";
import { chatState, listChatMessages, markChatRead, notifyChatMessage, postChatMessage, resolveChatAccess } from "@/lib/services/ticket-chat";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "private, no-store" };
const asOf = (req: Request) => (new URL(req.url).searchParams.get("as") === "client" ? "client" : "staff");

/**
 * Conversația unui tichet. GET: mesajele (cu `?since=<ISO>` doar cele noi) + starea; cu `?mark=1` le marchează ca citite de cel care
 * întreabă. `?as=client|staff` alege sesiunea verificată (portal sau operator). Aplicația îl interoghează la câteva secunde cât
 * conversația e deschisă și vizibilă.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await resolveChatAccess(id, asOf(req));
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status, headers: noStore });

  const sp = new URL(req.url).searchParams;
  const sinceRaw = sp.get("since");
  const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw) : null;
  const messages = await listChatMessages(id, since);
  if (sp.get("mark") === "1") await markChatRead(access).catch(() => {});
  return Response.json(chatState(access, messages), { headers: noStore });
}

/** Trimite un mesaj în conversație: { body }. Operatorul declanșează emailul către client, clientul notificarea operatorilor. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await resolveChatAccess(id, asOf(req));
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status, headers: noStore });
  if (!access.viewer.canWrite) return Response.json({ error: access.viewer.blockedReason ?? "Nu poți scrie aici." }, { status: 403, headers: noStore });
  if (isRateLimited(`ticket-chat:${access.viewer.kind}:${access.viewer.id}`, 40, 60_000)) {
    return Response.json({ error: "Prea multe mesaje într-un minut — așteaptă puțin." }, { status: 429, headers: noStore });
  }

  let body = "";
  try {
    const j = (await req.json()) as { body?: unknown };
    body = typeof j.body === "string" ? j.body.replace(/\r\n/g, "\n").trim() : "";
  } catch {
    return Response.json({ error: "Cerere invalidă." }, { status: 400, headers: noStore });
  }
  if (!body) return Response.json({ error: "Scrie un mesaj." }, { status: 400, headers: noStore });
  if (body.length > CHAT_MAX_BODY) return Response.json({ error: `Mesajul depășește ${CHAT_MAX_BODY} de caractere.` }, { status: 400, headers: noStore });

  const message = await postChatMessage(access, body);
  after(() => notifyChatMessage(access, message));
  return Response.json({ message }, { headers: noStore });
}
