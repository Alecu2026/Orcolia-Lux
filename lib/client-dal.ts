import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { getClientSessionToken, hashClientToken } from "./client-session";
import { canImpersonatePortal, type ImpersonationInfo } from "./impersonation";
import { getCachedSession, putCachedSession } from "./portal-cache";

export type CurrentClient = {
  id: string;
  name: string;
  email: string | null;
  meterSeries: string | null;
  /** Adresa de consum (din 1C), folosită ca valoare implicită la cererile din portal. */
  address: string | null;
  /** Setat doar în timpul unei simulări de login din staff (fix 6 ore). */
  impersonation?: ImpersonationInfo;
};

const ONE_DAY = 24 * 60 * 60 * 1000;

/**
 * getCurrentClient — oglindă `getCurrentUser` din lib/dal.ts, dar pe modelul Client/
 * ClientSession. Memoizat cu `cache()`: un singur query per render, oricâte componente
 * îl cer. `lastUsedAt` se actualizează throttle-uit (max o dată/zi).
 */
export const getCurrentClient = cache(async (): Promise<CurrentClient | null> => {
  const token = await getClientSessionToken();
  if (!token) return null;

  // cache scurt în memorie (vezi lib/portal-cache.ts): navigarea între paginile portalului nu mai caută sesiunea în baza de date de fiecare dată
  const tokenHash = hashClientToken(token);
  const cached = getCachedSession<CurrentClient>(tokenHash);
  if (cached) return cached;

  const session = await prisma.clientSession.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      expiresAt: true,
      lastUsedAt: true,
      impersonatedById: true,
      client: {
        select: { id: true, name: true, email: true, meterSeries: true, consumAddress: true, portalPasswordHash: true },
      },
    },
  });

  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.clientSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // Cont neactivat (fără parolă setată încă) ⇒ tratat ca neautentificat.
  if (!session.client.portalPasswordHash) return null;

  // Simulare din staff: la fiecare cerere se verifică că utilizatorul e încă activ și mai are permisiunea; altfel simularea se încheie.
  let impersonation: ImpersonationInfo | undefined;
  if (session.impersonatedById) {
    const by = await prisma.user.findUnique({
      where: { id: session.impersonatedById },
      select: { id: true, name: true, role: true, permissions: true, isActive: true, isSuperAdmin: true },
    });
    if (!by || !by.isActive || !canImpersonatePortal(by)) {
      await prisma.clientSession.delete({ where: { id: session.id } }).catch(() => {});
      return null;
    }
    impersonation = { byId: by.id, byName: by.name, expiresAt: session.expiresAt.getTime() };
  }

  if (Date.now() - session.lastUsedAt.getTime() > ONE_DAY) {
    await prisma.clientSession
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }

  const out: CurrentClient = {
    id: session.client.id,
    name: session.client.name,
    email: session.client.email,
    meterSeries: session.client.meterSeries,
    address: session.client.consumAddress,
    ...(impersonation ? { impersonation } : {}),
  };
  // o simulare din staff se reverifică la fiecare cerere (activ + permisiune): nu se ține în cache
  if (!impersonation) putCachedSession(tokenHash, out.id, out, session.expiresAt.getTime());
  return out;
});

/** Pentru pagini/acțiuni ale portalului: întoarce clientul sau redirect la /portal/login. */
export const requireClient = cache(async (): Promise<CurrentClient> => {
  const client = await getCurrentClient();
  // Cookie-ul poate fi prezent dar invalid (expirat/șters/cont neactivat) — proxy.ts verifică
  // doar prezența lui, așa că redirectăm prin ruta care îl curăță, ca la staff, pentru a evita
  // bucla /portal/login ↔ /portal.
  if (!client) redirect("/api/portal-auth/clear-session");
  return client;
});
