import { createHash } from "node:crypto";
import { getCurrentUser } from "@/lib/dal";
import { listIssueRegister } from "@/lib/services/meter-issues";
import { canManageMeterIssues, issueAccess, visibleIssues } from "@/lib/meter-issue-access";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Registrul complet de nereguli (deschise și rezolvate) într-un singur răspuns, cu ETag: browserul păstrează lista și o reîntreabă condiționat
 * (304 = nimic nou), iar filtrarea / paginarea se fac local — ca la Plătitori și Contoare.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  const access = issueAccess(user);
  if (!access) return Response.json({ error: "Fără permisiune." }, { status: 403 });
  try {
    const rows = visibleIssues(await listIssueRegister(), access);
    const canManage = canManageMeterIssues(user);
    const body = JSON.stringify({ rows, canManage, restricted: !access.all, ownTeamIds: access.teamIds });
    const etag = `"${createHash("sha1").update(body).digest("hex").slice(0, 20)}"`;
    const headers = { ETag: etag, "Cache-Control": "private, no-cache" };
    if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(body, { headers: { ...headers, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[contoare-nereguli] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca registrul de nereguli." }, { status: 500 });
  }
}
