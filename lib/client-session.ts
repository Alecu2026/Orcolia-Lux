import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { env } from "./env";

// Cookie separat de cel al staff-ului (`pr_session`) — un client autentificat nu trebuie să
// poată accesa vreodată rutele de staff și invers. Nu are nevoie de env var propriu: e fix,
// la fel ca TTL-ul (180 zile, ca la staff).
const COOKIE = "client_session";
/** Marcaj (httpOnly) pus doar când sesiunea de client e o SIMULARE pornită din staff: la expirare te duce înapoi în staff, nu la autentificarea clienților. */
export const PORTAL_IMP_COOKIE = "client_imp";
const TTL_MS = 180 * 24 * 60 * 60 * 1000;

/** Hash-ul tokenului (sha256) — în DB salvăm DOAR acest hash, niciodată tokenul brut. */
export function hashClientToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Token opac, random, lung (256 biți). */
export function generateClientToken(): string {
  return randomBytes(32).toString("base64url");
}

type ClientSessionMeta = { userAgent?: string | null; ip?: string | null };

/** Creează sesiunea în DB și setează cookie-ul httpOnly. */
export async function createClientSession(
  clientId: string,
  meta: ClientSessionMeta = {},
): Promise<void> {
  const token = generateClientToken();
  const expiresAt = new Date(Date.now() + TTL_MS);

  await prisma.clientSession.create({
    data: {
      clientId,
      tokenHash: hashClientToken(token),
      expiresAt,
      userAgent: meta.userAgent ?? null,
      ip: meta.ip ?? null,
    },
  });

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    secure: env.isProd,
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });
  // o autentificare reală a clientului încheie orice marcaj de simulare rămas
  store.delete(PORTAL_IMP_COOKIE);
}

export async function getClientSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

/** Șterge sesiunea curentă din DB și cookie (logout). */
export async function destroyClientSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    await prisma.clientSession
      .deleteMany({ where: { tokenHash: hashClientToken(token) } })
      .catch(() => {});
  }
  store.delete(COOKIE);
  store.delete(PORTAL_IMP_COOKIE);
}

export const CLIENT_SESSION_COOKIE = COOKIE;
