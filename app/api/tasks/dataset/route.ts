import { gunzipSync } from "node:zlib";
import { getCurrentUser } from "@/lib/dal";
import { getTaskDataset } from "@/lib/services/task-dataset";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Toate task-urile (sau tichetele) din „scope", compact, pentru motorul local din /tasks și /tickets (vezi lib/task-dataset.ts).
 * ?kind=task|ticket|kanban&scope=mine|all|created. Se verifică aceleași drepturi ca pagina; răspuns gzip cu ETag (304 când nu s-a schimbat nimic).
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const k = sp.get("kind");
  const kind = k === "ticket" ? "TICKET" : k === "kanban" ? "KANBAN" : "TASK";
  try {
    const entry = await getTaskDataset(user, kind, sp.get("scope") ?? "mine");
    if (!entry) return Response.json({ error: "Fără permisiune." }, { status: 403 });
    // private + no-cache: conține date interne și trebuie validată la fiecare folosire (If-None-Match → 304 când nu s-a schimbat nimic).
    const base = { ETag: entry.etag, "Cache-Control": "private, no-cache", Vary: "Accept-Encoding" };
    if (req.headers.get("if-none-match") === entry.etag) return new Response(null, { status: 304, headers: base });
    if (/\bgzip\b/i.test(req.headers.get("accept-encoding") ?? "")) {
      return new Response(new Uint8Array(entry.gz), { headers: { ...base, "Content-Type": "application/json", "Content-Encoding": "gzip", "Content-Length": String(entry.gz.length) } });
    }
    return new Response(new Uint8Array(gunzipSync(entry.gz)), { headers: { ...base, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[tasks-dataset] eșuat:", e);
    return Response.json({ error: "Nu am putut încărca lista." }, { status: 500 });
  }
}
