import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { getSessionToken, hashToken } from "./session";
import { can, homePath, type PermissionKey } from "./permissions";
import { ensureSuperAdminExists } from "./services/super-admin";
import { canImpersonateUser, type ImpersonationInfo } from "./impersonation";

export type CurrentUser = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF";
  permissions: string[];
  isActive: boolean;
  isSuperAdmin: boolean;
  teamIds: string[];
  taskViewScope: string;
  taskViewTeamIds: string[];
  taskViewMemberIds: string[];
  /** Aspectul tabelelor setat de administrator (vezi lib/table-look.ts); gol = implicit. */
  tableLook?: unknown;
  bottomNav?: string[];
  /** Setat doar în timpul unei simulări de login: cine a intrat în acest cont și până când (fix 6 ore). */
  impersonation?: ImpersonationInfo;
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
      taskViewScope: "ALL",
      taskViewTeamIds: [],
      taskViewMemberIds: [],
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
      impersonatorId: true,
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
          taskViewScope: true,
          taskViewTeamIds: true,
          taskViewMemberIds: true,
          tableLook: true,
          bottomNav: true,
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

  // Simulare de login: de la fiecare cerere se verifică din nou că cel care simulează e încă activ și mai are dreptul asupra acestui cont
  // (i s-a luat permisiunea, a fost dezactivat, contul simulat a primit drepturi mai mari) — altfel simularea se încheie pe loc.
  let impersonation: ImpersonationInfo | undefined;
  if (session.impersonatorId) {
    const by = await prisma.user.findUnique({
      where: { id: session.impersonatorId },
      select: { id: true, name: true, role: true, permissions: true, isActive: true, isSuperAdmin: true, taskViewScope: true, taskViewTeamIds: true, taskViewMemberIds: true },
    });
    if (!by || !by.isActive || !canImpersonateUser(by, session.user).ok) {
      await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
      return null;
    }
    impersonation = { byId: by.id, byName: by.name, expiresAt: session.expiresAt.getTime() };
  }

  if (Date.now() - session.lastUsedAt.getTime() > ONE_DAY) {
    await prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }

  // Plasă de siguranță: dacă sistemul a rămas fără super-admin activ, cel mai vechi administrator
  // devine super-admin. Pentru cine e deja super e un simplu skip (verificarea e memorată 60 s).
  const current = (impersonation ? { ...session.user, impersonation } : session.user) as CurrentUser;
  if (!current.isSuperAdmin) {
    const healed = await ensureSuperAdminExists().catch(() => null);
    if (healed?.promotedId === current.id) return { ...current, isSuperAdmin: true, role: "ADMIN" };
  }
  return current;
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

/** Pagini protejate de permisiune: dacă lipsește, redirect la prima pagină la care are acces (nu la /dashboard, care poate fi și ea interzisă). */
export async function requirePermission(key: PermissionKey): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user, key)) redirect(homePath(user));
  return user;
}

/** La fel, dar pagina se vede dacă userul are ORICARE dintre permisiuni (ex. Calendar: task-uri sau programări). */
export async function requireAnyPermission(keys: PermissionKey[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!keys.some((k) => can(user, k))) redirect(homePath(user));
  return user;
}

/** Pagini doar pentru super-admin (ex: Audit Logs). */
export async function requireSuperAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isSuper(user)) redirect("/dashboard");
  return user;
}

/** Acțiunile de securitate ale contului (parolă, email, notificări push, Telegram) nu se fac prin simulare: ar modifica contul real al altcuiva. Întoarce mesajul de refuz sau null. */
export function blockedInImpersonation(user: CurrentUser): string | null {
  return user.impersonation ? "Indisponibil în modul simulare de login." : null;
}
