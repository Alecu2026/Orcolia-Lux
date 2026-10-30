import { getCurrentUser } from "@/lib/dal";
import { exitPortalImpersonation, exitUserImpersonation, startPortalImpersonation, startUserImpersonation, type ImpResult } from "@/lib/services/impersonation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Simulare de login (formulare POST, fără JavaScript):
 *   /api/simulare/user         userId    → intră în contul unui utilizator
 *   /api/simulare/exit                   → ieși din simulare, înapoi în contul tău
 *   /api/simulare/portal       clientId  → intră în portalul unui client
 *   /api/simulare/portal-exit            → ieși din portalul simulat
 * Din formular (Accept: text/html) răspunde cu redirect; altfel cu JSON.
 */
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  const wantsHtml = (req.headers.get("accept") ?? "").includes("text/html");
  const redirect = (to: string) => new Response(null, { status: 303, headers: { Location: to } });
  const fail = (error: string, status: number) =>
    wantsHtml ? redirect(status === 401 ? "/login" : `/simulare?eroare=${encodeURIComponent(error)}`) : Response.json({ error }, { status });
  const done = (r: ImpResult) => (r.ok ? (wantsHtml ? redirect(r.to) : Response.json({ ok: true, to: r.to })) : fail(r.error, r.status));

  // Protecție CSRF: o cerere din altă origine nu trece (cookie-ul e SameSite=Lax, aceasta e o a doua plasă)
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return Response.json({ error: "Origine nepermisă." }, { status: 403 });
    } catch {
      return Response.json({ error: "Origine nepermisă." }, { status: 403 });
    }
  }

  // ieșirea din portalul simulat se validează după sesiunea de client; restul cer un utilizator autentificat
  if (action === "portal-exit") return done(await exitPortalImpersonation());

  // ieșirea din simulare nu cere o sesiune simulată încă validă (poate să fi expirat chiar acum)
  if (action === "exit") return done(await exitUserImpersonation());

  const user = await getCurrentUser();
  if (!user) return fail("Autentificare necesară.", 401);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Cerere invalidă." }, { status: 400 });
  }
  if (action === "user") return done(await startUserImpersonation(user, String(form.get("userId") ?? "")));
  if (action === "portal") return done(await startPortalImpersonation(user, String(form.get("clientId") ?? "")));
  return Response.json({ error: "Acțiune necunoscută." }, { status: 404 });
}
