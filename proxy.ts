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
function proxyPortal(req: NextRequest, nonce: string, csp: string) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(CLIENT_COOKIE);
  const isPublic = PORTAL_PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!hasSession && !isPublic) {
    return NextResponse.redirect(new URL("/portal/login", req.nextUrl));
  }
  if (hasSession && isPublic) {
    return NextResponse.redirect(new URL("/portal", req.nextUrl));
  }
  return next(req, nonce, csp);
}

/**
 * Content-Security-Policy complet, cu nonce per cerere. Scripturile rulează doar dacă poartă nonce-ul (Next îl pune singur pe ale lui, din antetul CSP al cererii),
 * deci un script injectat nu se execută. Restul directivelor sunt largi pe resurse pasive (poze, fonturi, tile-uri de hartă, blob/data), ca nimic să nu se strice:
 *  - img-src/media-src: poze din aplicație, data:/blob: (previzualizări, cameră), https: (tile-uri de hartă, poze externe);
 *  - connect-src: aplicația, https:/wss: (hartă, voce Piper care își descarcă modelul), blob:/data:;
 *  - worker-src: sw.js, workerul MapLibre (blob:), 'wasm-unsafe-eval' pentru vocea Piper (WebAssembly);
 *  - style-src cu 'unsafe-inline' (stilurile inline ale React/Tailwind/hărții; nu execută cod);
 *  - frame-ancestors/frame-src/form-action/base-uri/object-src închise la aplicație.
 */
const IS_DEV = process.env.NODE_ENV !== "production";

function buildCsp(nonce: string): string {
  const scripts = [`'self'`, `'nonce-${nonce}'`, `'strict-dynamic'`, `'wasm-unsafe-eval'`];
  if (IS_DEV) scripts.push(`'unsafe-eval'`);
  return [
    `default-src 'self'`,
    `script-src ${scripts.join(" ")}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    `media-src 'self' data: blob: https:`,
    `font-src 'self' data: https:`,
    `connect-src 'self' https: wss: blob: data:`,
    `worker-src 'self' blob:`,
    `child-src 'self' blob:`,
    `frame-src 'self' blob: data:`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'self'`,
    `report-uri /api/csp-report`,
  ].join("; ");
}

/** Pagini publice fără autentificare (previzualizarea facturii prin link): nu trec prin verificarea de sesiune, dar primesc același CSP. */
const OPEN_PATHS = ["/invoice/public", "/citire/verifica"];

export function proxy(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const res = proxyInner(req, nonce, csp);
  res.headers.set("Content-Security-Policy", csp);
  // simulare de login activă (cookie-ul sesiunii „de origine”): service worker-ul nu păstrează pagina pentru offline (ar conține datele contului simulat)
  if (req.cookies.has(`${COOKIE}_orig`)) res.headers.set("x-imp", "1");
  return res;
}

/** Trece cererea mai departe cu nonce-ul și CSP-ul și în antetele cererii (Next citește nonce-ul de acolo ca să-l pună pe scripturile lui). */
function next(req: NextRequest, nonce: string, csp: string) {
  const headers = new Headers(req.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  return NextResponse.next({ request: { headers } });
}

function proxyInner(req: NextRequest, nonce: string, csp: string) {
  const { pathname } = req.nextUrl;

  if (OPEN_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return next(req, nonce, csp);
  }

  if (pathname === "/portal" || pathname.startsWith("/portal/")) {
    return proxyPortal(req, nonce, csp);
  }

  if (DEMO) {
    if (pathname === "/login") {
      return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
    }
    return next(req, nonce, csp);
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

  return next(req, nonce, csp);
}

export const config = {
  // Nu rula pe API (își gestionează singure auth), assets, sw, manifest, iconuri, sau
  // opengraph-image/twitter-image (accesate fără sesiune de crawlerele de preview link —
  // WhatsApp, Telegram etc. — care nu au cookie-ul de sesiune și ar fi redirecționate la login).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons|files|opengraph-image|twitter-image|.*\\.(?:png|svg|ico|webmanifest|js|json|txt)$).*)",
  ],
};
