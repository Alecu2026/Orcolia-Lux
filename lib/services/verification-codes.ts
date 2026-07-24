import "server-only";
import { createHash, randomInt } from "node:crypto";
import { prisma } from "../prisma";

const CODE_TTL_MINUTES = 15;

export type CodePurpose = "PASSWORD_CHANGE" | "PASSWORD_RESET";

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Generează un cod din 6 cifre, îl stochează hash-uit și îl întoarce (o singură dată, în clar). */
export async function createVerificationCode(
  userId: string,
  purpose: CodePurpose,
): Promise<string> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await prisma.verificationCode.create({
    data: {
      userId,
      purpose,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
      // Explicit null (nu omis): pe MongoDB, un filtru `usedAt: null` nu găsește
      // documente unde câmpul lipsește complet din document, doar unde e null explicit.
      usedAt: null,
    },
  });
  return code;
}

/** Verifică un cod și, dacă e valid, îl marchează folosit (nu poate fi refolosit). */
export async function consumeVerificationCode(
  userId: string,
  purpose: CodePurpose,
  code: string,
): Promise<boolean> {
  const codeHash = hashCode(code.trim());
  const found = await prisma.verificationCode.findFirst({
    where: { userId, purpose, codeHash, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (!found) return false;
  await prisma.verificationCode.update({ where: { id: found.id }, data: { usedAt: new Date() } });
  return true;
}
