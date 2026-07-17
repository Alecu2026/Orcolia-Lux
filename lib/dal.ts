import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { getSessionToken, hashToken } from "./session";
import { can, type PermissionKey } from "./permissions";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF";
  permissions: string[];
  isActive: boolean;
  isSuperAdmin: boolean;
  teamIds: string[];
};

/** Super-admin: acces la Audit Logs + gestionarea celorlalți super-admini. */
export function isSuper(user: { isSuperAdmin?: boolean } | null | undefined): boolean {
  return user?.isSuperAdmin === true;
}

const ONE_DAY = 24 * 60 * 60 * 1000;

// Import târziu ca să evităm cicluri la load (demo.ts importă tipul CurrentUser).
function demoActive() {
  return !process.env.DATABASE_URL || !process.env.SESSION_SECRET;
}

/**
 * getCurrentUser optimizat:
 *  - memoizat cu React `cache()` ⇒ un singur query per render, oricâte componente îl cer
 *  - un singur query cu `select` minimal (fără include greu)
 *  - actualizare `lastUsedAt` throttle-uită (max o dată/zi) ⇒ fără write la fiecare request
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  if (demoActive()) {
    return {
      id: "demo-user",
      name: "Cont Demo",
      email: "demo@local",
      role: "ADMIN",
      permissions: [],
      isActive: true,
      isSuperAdmin: true,
      teamIds: [],
    };
  }
  const token = await getSessionToken();
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastUsedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          permissions: true,
          isActive: true,
          isSuperAdmin: true,
          teamIds: true,
        },
      },
    },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // Utilizator dezactivat ⇒ tratat ca neautentificat
  if (!session.user.isActive) return null;

  if (Date.now() - session.lastUsedAt.getTime() > ONE_DAY) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }

  return session.user as CurrentUser;
});

/** Pentru pagini/acțiuni: întoarce userul sau redirect la /login. */
export const requireUser = cache(async (): Promise<CurrentUser> => {
  const user = await getCurrentUser();
  // Cookie-ul de sesiune poate fi prezent dar invalid (expirat/șters/user dezactivat) —
  // proxy.ts verifică doar prezența lui, așa că redirectăm prin ruta care îl curăță
  // pentru a evita bucla /login ↔ /dashboard.
  if (!user) redirect("/api/auth/clear-session");
  return user;
});

/** Pagini protejate de permisiune: redirect la /dashboard dacă lipsește. */
export async function requirePermission(key: PermissionKey): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, key)) redirect("/dashboard");
  return user;
}

/** Pagini doar pentru super-admin (ex: Audit Logs). */
export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isSuper(user)) redirect("/dashboard");
  return user;
}
