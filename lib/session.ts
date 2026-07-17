import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { env } from "./env";

const COOKIE = env.sessionCookieName;
const TTL_MS = env.sessionTtlDays * 24 * 60 * 60 * 1000;

/** Hash-ul tokenului (sha256) — în DB salvăm DOAR acest hash, niciodată tokenul brut. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Token opac, random, lung (256 biți). */
export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

type SessionMeta = { userAgent?: string | null; ip?: string | null };

/** Creează sesiunea în DB și setează cookie-ul httpOnly. Returnează tokenul brut. */
export async function createSession(
  userId: string,
  meta: SessionMeta = {},
): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
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
}

export async function getSessionToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(COOKIE)?.value ?? null;
}

/** Șterge sesiunea curentă din DB și cookie (logout). */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) {
    await prisma.session
      .deleteMany({ where: { tokenHash: hashToken(token) } })
      .catch(() => {});
  }
  store.delete(COOKIE);
}

export const SESSION_COOKIE = COOKIE;
