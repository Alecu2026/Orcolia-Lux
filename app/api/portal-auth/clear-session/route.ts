import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { CLIENT_SESSION_COOKIE, PORTAL_IMP_COOKIE } from "@/lib/client-session";

export const dynamic = "force-dynamic";

/**
 * Curăță cookie-ul de sesiune al portalului client înainte de a trimite la /portal/login.
 * Oglindă /api/auth/clear-session — vezi acolo explicația buclei de redirect evitate.
 */
export async function GET(req: Request) {
  const store = await cookies();
  store.delete(CLIENT_SESSION_COOKIE);
  // simulare din staff încheiată (expirată): înapoi în staff, nu la autentificarea clienților
  if (store.get(PORTAL_IMP_COOKIE)) {
    store.delete(PORTAL_IMP_COOKIE);
    return NextResponse.redirect(new URL("/simulare", req.url));
  }
  return NextResponse.redirect(new URL("/portal/login", req.url));
}
