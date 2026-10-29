import { getCurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { storePrivateStream } from "@/lib/storage";

export const runtime = "nodejs";

// Exportul lunar 1C are ~50 MB; limita de aici e marja. (Pe nginx: client_max_body_size cel puțin 160m pe această rută — vezi docs/SERVER-PROPRIU.md.)
const MAX_IMPORT = 150 * 1024 * 1024;

/**
 * Încarcă exportul Apă-Canal (.json / .txt) în stocarea PRIVATĂ a serverului (nu se servește public); răspunde cu un identificator pentru /api/import/apa-canal-json.
 * Corpul cererii e chiar fișierul (nu multipart), numele vine în antetul x-file-name; se scrie pe disc pe măsură ce sosește, deci cei ~50 MB nu ocupă memorie.
 */
export async function POST(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Autentificare necesară." }, { status: 401 });
  if (!can(user, "invoices.create") || !can(user, "clients.create")) {
    return Response.json({ error: "Nu ai permisiunea de a importa date Apă-Canal." }, { status: 403 });
  }
  const declared = Number(request.headers.get("content-length"));
  if (declared > MAX_IMPORT) return Response.json({ error: "Fișierul depășește 150 MB." }, { status: 413 });
  if (!request.body || declared === 0) return Response.json({ error: "Niciun fișier selectat." }, { status: 400 });
  let name = "export.json";
  try { name = decodeURIComponent(request.headers.get("x-file-name") ?? "") || name; } catch {}
  try {
    const res = await storePrivateStream("importuri", request.body, name, MAX_IMPORT);
    if (res === "too-big") return Response.json({ error: "Fișierul depășește 150 MB." }, { status: 413 });
    return Response.json({ fileId: res.id });
  } catch (e) {
    console.error("[apa-canal-import] salvarea pe disc a eșuat:", e);
    return Response.json({ error: "Fișierul nu a putut fi salvat pe server." }, { status: 500 });
  }
}
