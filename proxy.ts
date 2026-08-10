import { NextResponse, type NextRequest } from "next/server";

/**
 * Proxy (fostul Middleware în Next.js 16) — verificare OPTIMISTĂ, fără DB.
 * Doar prezența cookie-ului decide redirect-ul rapid; verificarea reală
 * (sesiune validă, expirare) se face în DAL la nivel de pagină/acțiune.
 */

const COOKIE = process.env.SESSION_COOKIE_NAME || "pr_session";
const CLIENT_COOKIE = "client_session"; // vezi lib/client-session.ts — cookie separat, portal client

// Rute accesibile fără autentificare
const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password"];
const PORTAL_PUBLIC_PATHS = ["/portal/login", "/portal/register", "/portal/forgot-password", "/portal/reset-password"];

// Mod demo: fără bază de date/secret, nu blocăm nimic.
const DEMO = !process.env.DATABASE_URL || !process.env.SESSION_SECRET;

/**
 * Portalul de client (`/portal/*`) e complet separat de autentificarea de staff — cookie
 * propriu (`client_session`), pagini publice proprii. Nu se amestecă niciodată cu verificarea
 * de mai jos (care rulează doar pentru rutele de staff).
 */
function proxyPortal(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(CLIENT_COOKIE);
  const isPublic = PORTAL_PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSession && !isPublic) {
    return NextResponse.redirect(new URL("/portal/login", req.nextUrl));
  }
  if (hasSession && isPublic) {
    return NextResponse.redirect(new URL("/portal", req.nextUrl));
  }
  return NextResponse.next();
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname === "/portal" || pathname.startsWith("/portal/")) {
    return proxyPortal(req);
  }

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
  // Nu rula pe API (își gestionează singure auth), assets, sw, manifest, iconuri, sau
  // opengraph-image/twitter-image (accesate fără sesiune de crawlerele de preview link —
  // WhatsApp, Telegram etc. — care nu au cookie-ul de sesiune și ar fi redirecționate la login).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons|invoice/public|opengraph-image|twitter-image|.*\\.(?:png|svg|ico|webmanifest|js|json|txt)$).*)",
  ],
};
