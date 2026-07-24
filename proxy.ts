import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (fostul Middleware în Next.js 16) — verificare OPTIMISTĂ, fără DB.
 * Doar prezența cookie-ului decide redirect-ul rapid; verificarea reală
 * (sesiune validă, expirare) se face în DAL la nivel de pagină/acțiune.
 */

const COOKIE = process.env.SESSION_COOKIE_NAME || "pr_session";

// Rute accesibile fără autentificare
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];

// Mod demo: fără bază de date/secret, nu blocăm nimic.
const DEMO = !process.env.DATABASE_URL || !process.env.SESSION_SECRET;

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (DEMO) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
    }
    return NextResponse.next();
  }

  const hasSession = req.cookies.has(COOKIE);
  const isPublic = PUBLIC_PATHS.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );

  // Neautentificat pe rută protejată ⇒ la login
  if (!hasSession && !isPublic) {
    const url = new URL("/login", req.nextUrl);
    if (pathname !== "/") url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // Autentificat dar pe /login ⇒ la dashboard
  if (hasSession && isPublic) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }

  return NextResponse.next();
}

export const config = {
  // Nu rula pe API (își gestionează singure auth), assets, sw, manifest, iconuri.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons|invoice/public|.*\\.(?:png|svg|ico|webmanifest|js|json|txt)$).*)",
  ],
};
