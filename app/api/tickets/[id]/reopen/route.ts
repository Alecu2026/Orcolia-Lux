import { after } from "next/server";
import { isRateLimited } from "@/lib/rate-limit";
import { notifyReopened, reopenByClient, resolveChatAccess } from "@/lib/services/ticket-chat";
import { auditPortalAction } from "@/lib/services/impersonation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const noStore = { "Cache-Control": "private, no-store" };

/** Clientul redeschide o cerere finalizată din portal (doar propria cerere, doar dacă e finalizată). */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const access = await resolveChatAccess(id, "client");
  if (!access.ok) return Response.json({ error: access.error }, { status: access.status, headers: noStore });
  if (isRateLimited(`ticket-reopen:${access.viewer.id}`, 10, 60_000)) {
    return Response.json({ error: "Prea multe încercări — așteaptă puțin." }, { status: 429, headers: noStore });
  }
  const r = await reopenByClient(access);
  if (!r.ok) return Response.json({ error: r.error }, { status: 409, headers: noStore });
  await auditPortalAction("redeschiderea unei cereri", id);
  after(() => notifyReopened(access));
  return Response.json({ ok: true }, { headers: noStore });
}
