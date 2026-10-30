import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/session";
import { restoreOriginalSession } from "@/lib/services/impersonation";
import { logAudit } from "@/lib/services/audit";

export const dynamic = "force-dynamic";

/**
 * Curăță cookie-ul de sesiune înainte de a trimite la /login.
 * Necesar pentru sesiuni invalide/expirate: cookie-ul rămâne în browser
 * (doar logout-ul explicit îl șterge), iar proxy.ts verifică doar
 * prezența lui ⇒ fără curățare aici, /dashboard ↔ /login se redirecționează la infinit.
 */
export async function GET(req: Request) {
  const store = await cookies();
  // Simulare de login încheiată (a expirat după 6 ore, ai pierdut dreptul etc.): te scoate din contul simulat și te duce înapoi în contul tău, fără autentificare nouă.
  const back = await restoreOriginalSession();
  if (back) {
    await logAudit({ id: back.id, name: back.name, role: back.role, isSuperAdmin: back.isSuperAdmin }, { action: "auth.impersonate_end", module: "Auth", objectName: "simulare încheiată (expirată)" });
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  store.delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/login", req.url));
}
