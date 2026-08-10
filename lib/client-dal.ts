import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { prisma } from "./prisma";
import { getClientSessionToken, hashClientToken } from "./client-session";

export type CurrentClient = {
  id: string;
  name: string;
  email: string | null;
  meterSeries: string | null;
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

  const session = await prisma.clientSession.findUnique({
    where: { tokenHash: hashClientToken(token) },
    select: {
      id: true,
      expiresAt: true,
      lastUsedAt: true,
      client: {
        select: { id: true, name: true, email: true, meterSeries: true, portalPasswordHash: true },
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

  if (Date.now() - session.lastUsedAt.getTime() > ONE_DAY) {
    await prisma.clientSession
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }

  return {
    id: session.client.id,
    name: session.client.name,
    email: session.client.email,
    meterSeries: session.client.meterSeries,
  };
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
