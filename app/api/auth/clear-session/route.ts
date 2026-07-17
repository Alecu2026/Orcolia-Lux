import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Curăță cookie-ul de sesiune înainte de a trimite la /login.
 * Necesar pentru sesiuni invalide/expirate: cookie-ul rămâne în browser
 * (doar logout-ul explicit îl șterge), iar proxy.ts verifică doar
 * prezența lui ⇒ fără curățare aici, /dashboard ↔ /login se redirecționează la infinit.
 */
export async function GET(req: Request) {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/login", req.url));
}
