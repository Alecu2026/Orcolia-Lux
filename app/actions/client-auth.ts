"use server";

import { invalidatePayers } from "@/lib/services/payer-cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { HashBusyError, checkPassword, dummyVerify, hashPassword } from "@/lib/password";
import { validateNewPassword } from "@/lib/password-policy";
import { clearFailures, hitLimit, isBlocked, loginRules, recordFailure } from "@/lib/auth-throttle";
import { clientIp } from "@/lib/request-ip";
import { isRateLimited } from "@/lib/rate-limit";
import { createClientSession, destroyClientSession } from "@/lib/client-session";
import { getCurrentClient } from "@/lib/client-dal";
import { evictClientSessions } from "@/lib/portal-cache";
import { exitPortalImpersonation } from "@/lib/services/impersonation";
import {
  createClientVerificationCode,
  consumeClientVerificationCode,
} from "@/lib/services/client-verification-codes";
import { sendVerificationCodeEmail } from "@/lib/email";
import { generateFirstApaCanalInvoice } from "@/lib/services/portal-invoices";

export type ClientAuthState = { error?: string } | undefined;

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const TOO_MANY = "Prea multe încercări. Încearcă din nou peste câteva minute.";
const BUSY = "Serverul este ocupat. Încearcă din nou peste câteva secunde.";
/** La activare nu spunem CE nu se potrivește (cont inexistent, deja activat, dovadă greșită): altfel formularul ar arăta ce conturi există. */
const REGISTER_FAILED = "Nu am putut verifica datele introduse. Verifică contul personal și suma sau numărul facturii. Dacă ai deja cont, autentifică-te sau folosește „Am uitat parola”.";
const HOUR = 60 * 60_000;

async function requestMeta() {
  const h = await headers();
  return { userAgent: h.get("user-agent"), ip: await clientIp() };
}

/**
 * Dovada că cel care cere activarea e chiar plătitorul:
 *  - dacă plătitorul are un email înregistrat la companie (cazul normal, tot mai des), emailul scris trebuie să fie ACELA — codul ajunge doar în căsuța lui, iar contul personal
 *    (care se găsește pe orice factură și se poate ghici) nu mai ajunge singur;
 *  - dacă încă nu are email înregistrat (perioadă de tranziție), se cere suma sau numărul ultimei facturi (ceva ce are doar cine ține factura în mână); emailul scris devine
 *    emailul contului. Fără email și fără factură, activarea online nu e posibilă: compania completează emailul în fișă.
 */
async function ownershipProof(clientId: string, clientEmail: string | null, typedEmail: string, proofRaw: string): Promise<boolean> {
  const onFile = clientEmail?.trim().toLowerCase();
  if (onFile) return onFile === typedEmail;
  const last = await prisma.invoice.findFirst({ where: { clientId, kind: "APA_CANAL" }, orderBy: { issueDate: "desc" }, select: { number: true, grandTotal: true } });
  const proof = proofRaw.trim();
  if (!last || !proof) return false;
  const compact = (s: string) => s.replace(/[\s_-]+/g, "").toLowerCase();
  if (compact(proof) === compact(last.number)) return true;
  const amount = Number(proof.replace(/\s+/g, "").replace(",", "."));
  return Number.isFinite(amount) && amount > 0 && Math.abs(amount - last.grandTotal) < 0.005;
}

/** Pasul 1 al înregistrării: verifică contul personal și dovada, trimite codul pe emailul introdus. */
export async function requestClientRegistration(
  _prev: ClientAuthState,
  formData: FormData,
): Promise<ClientAuthState> {
  const meterSeries = String(formData.get("meterSeries") ?? "").trim().slice(0, 40);
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 120);
  const proof = String(formData.get("proof") ?? "").trim().slice(0, 60);
  if (!meterSeries) return { error: "Introdu contul personal sau contractul." };
  if (!EMAIL_RE.test(email)) return { error: "Email invalid." };

  // limite comune între procese: pe adresă (oricâte conturi ar încerca) și pe cont (oricâte adrese ar încerca)
  const ip = await clientIp();
  if (ip && isRateLimited(`reg-pre:${ip}`, 60, 60_000)) return { error: TOO_MANY };
  if ((ip && (await hitLimit({ key: `portal:reg:ip:${ip}`, max: 20, windowMs: HOUR, lockMs: 0 }))) || (await hitLimit({ key: `portal:reg:acct:${meterSeries.toLowerCase()}`, max: 6, windowMs: HOUR, lockMs: 0 }))) {
    return { error: TOO_MANY };
  }

  // „Cont personal" sau contract (plătitorii firme au contract, nu cont personal).
  const client = await prisma.client.findFirst({
    where: { OR: [{ meterSeries }, { apaCanalContract: meterSeries }] },
    select: { id: true, name: true, email: true, portalPasswordHash: true },
  });
  if (!client || client.portalPasswordHash) return { error: REGISTER_FAILED };
  if (!(await ownershipProof(client.id, client.email, email, proof))) return { error: REGISTER_FAILED };

  const emailTaken = await prisma.client.findFirst({
    where: { email, portalPasswordHash: { not: null }, id: { not: client.id } },
    select: { id: true },
  });
  if (emailTaken) return { error: REGISTER_FAILED };

  const code = await createClientVerificationCode(client.id, "REGISTRATION");
  try {
    await sendVerificationCodeEmail({ to: email, name: client.name, code, purpose: "CLIENT_REGISTRATION" });
  } catch (e) {
    console.error("[client-auth] eșec trimitere cod activare:", e);
    return { error: "Trimiterea emailului a eșuat. Verifică adresa sau încearcă din nou." };
  }
  redirect(
    `/portal/register?meterSeries=${encodeURIComponent(meterSeries)}&email=${encodeURIComponent(email)}&sent=1`,
  );
}

/** Pasul 2 al înregistrării: confirmă codul, setează emailul + parola, autentifică. */
export async function confirmClientRegistration(
  _prev: ClientAuthState,
  formData: FormData,
): Promise<ClientAuthState> {
  const meterSeries = String(formData.get("meterSeries") ?? "").trim().slice(0, 40);
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 120);
  const code = String(formData.get("code") ?? "").trim();
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!/^\d{6}$/.test(code)) return { error: "Cod invalid — introdu cele 6 cifre primite pe email." };
  if (newPassword !== confirmPassword) return { error: "Parolele nu coincid." };
  const ip = await clientIp();
  if ((ip && (await hitLimit({ key: `portal:regconfirm:ip:${ip}`, max: 30, windowMs: 15 * 60_000, lockMs: 0 }))) || (await hitLimit({ key: `portal:regconfirm:acct:${meterSeries.toLowerCase()}`, max: 12, windowMs: 15 * 60_000, lockMs: 0 }))) {
    return { error: TOO_MANY };
  }

  const client = await prisma.client.findFirst({
    where: { OR: [{ meterSeries }, { apaCanalContract: meterSeries }] },
    select: { id: true, name: true, portalPasswordHash: true },
  });
  if (!client || client.portalPasswordHash) return { error: "Cod incorect sau expirat. Cere un cod nou." };

  const weak = validateNewPassword(newPassword, { email, name: client.name, account: meterSeries });
  if (weak) return { error: weak };

  const valid = await consumeClientVerificationCode(client.id, "REGISTRATION", code);
  if (!valid) return { error: "Cod incorect sau expirat. Cere un cod nou." };

  const portalPasswordHash = await hashPassword(newPassword);
  const now = new Date();
  await prisma.client.update({
    where: { id: client.id },
    data: { email, portalPasswordHash, portalActivatedAt: now, portalLastLoginAt: now },
  });
  await invalidatePayers();

  // Best-effort — dacă generarea eșuează, activarea contului tot reușește; clientul poate
  // primi factura ulterior, manual, din partea staff-ului.
  try {
    await generateFirstApaCanalInvoice(client.id);
  } catch (e) {
    console.error("[client-auth] eșec generare primă factură la activare:", e);
  }

  await createClientSession(client.id, await requestMeta());
  redirect("/portal");
}

export async function clientLogin(
  _prev: ClientAuthState,
  formData: FormData,
): Promise<ClientAuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 120);
  const password = String(formData.get("password") ?? "").slice(0, 256);
  if (!EMAIL_RE.test(email)) return { error: "Email sau parolă invalide." };

  const ip = await clientIp();
  if (ip && isRateLimited(`plogin-pre:${ip}`, 120, 60_000)) return { error: TOO_MANY };
  const rules = loginRules("portal", email, ip);
  if ((await isBlocked(rules.map((r) => r.key))).blocked) return { error: TOO_MANY };

  const client = await prisma.client.findFirst({
    where: { email, portalPasswordHash: { not: null } },
    select: { id: true, portalPasswordHash: true },
  });

  let ok = false;
  let rehash: string | null = null;
  try {
    if (client?.portalPasswordHash) {
      const r = await checkPassword(password, client.portalPasswordHash);
      ok = r.ok;
      rehash = r.rehash;
    } else {
      await dummyVerify(password); // același timp de răspuns ca pentru un cont real
    }
  } catch (e) {
    if (e instanceof HashBusyError) return { error: BUSY };
    throw e;
  }
  if (!ok || !client) {
    const st = await recordFailure(rules);
    return { error: st.blocked ? TOO_MANY : "Email sau parolă greșite." };
  }
  await clearFailures(rules.filter((r) => !r.key.includes(":ip:")).map((r) => r.key));

  await prisma.client.update({ where: { id: client.id }, data: { portalLastLoginAt: new Date(), ...(rehash ? { portalPasswordHash: rehash } : {}) } });
  await createClientSession(client.id, await requestMeta());
  redirect("/portal");
}

/** Cerere de resetare parolă uitată (neautentificat). Răspuns identic indiferent dacă emailul are cont; cereri limitate pe email și pe adresă. */
export async function requestClientPasswordReset(
  _prev: ClientAuthState,
  formData: FormData,
): Promise<ClientAuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 120);
  if (!EMAIL_RE.test(email)) return { error: "Email invalid." };

  const ip = await clientIp();
  const over =
    (ip ? await hitLimit({ key: `portal:reset:ip:${ip}`, max: 10, windowMs: HOUR, lockMs: 0 }) : false) ||
    (await hitLimit({ key: `portal:reset:email:${email}`, max: 3, windowMs: HOUR, lockMs: 0 }));
  if (!over) {
    const client = await prisma.client.findFirst({
      where: { email, portalPasswordHash: { not: null } },
      select: { id: true, name: true },
    });
    if (client) {
      try {
        const code = await createClientVerificationCode(client.id, "PASSWORD_RESET");
        await sendVerificationCodeEmail({ to: email, name: client.name, code, purpose: "CLIENT_PASSWORD_RESET" });
      } catch (e) {
        console.error("[client-auth] eșec trimitere cod resetare parolă:", e); // doar în jurnalul serverului
      }
    }
  }
  redirect(`/portal/reset-password?email=${encodeURIComponent(email)}&sent=1`);
}

/** Confirmă codul primit pe email și setează parola nouă. */
export async function resetClientPasswordWithCode(
  _prev: ClientAuthState,
  formData: FormData,
): Promise<ClientAuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 120);
  const code = String(formData.get("code") ?? "").trim();
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!/^\d{6}$/.test(code)) return { error: "Cod invalid — introdu cele 6 cifre primite pe email." };
  if (newPassword !== confirmPassword) return { error: "Parolele nu coincid." };
  const ip = await clientIp();
  if ((ip && (await hitLimit({ key: `portal:resetcode:ip:${ip}`, max: 20, windowMs: 15 * 60_000, lockMs: 0 }))) || (await hitLimit({ key: `portal:resetcode:email:${email}`, max: 10, windowMs: 15 * 60_000, lockMs: 0 }))) {
    return { error: TOO_MANY };
  }

  const client = await prisma.client.findFirst({
    where: { email, portalPasswordHash: { not: null } },
    select: { id: true, name: true, meterSeries: true },
  });
  if (!client) return { error: "Cod incorect sau expirat. Cere un cod nou." };

  const weak = validateNewPassword(newPassword, { email, name: client.name, account: client.meterSeries });
  if (weak) return { error: weak };

  const valid = await consumeClientVerificationCode(client.id, "PASSWORD_RESET", code);
  if (!valid) return { error: "Cod incorect sau expirat. Cere un cod nou." };

  const portalPasswordHash = await hashPassword(newPassword);
  await prisma.client.update({ where: { id: client.id }, data: { portalPasswordHash } });
  await invalidatePayers();
  await prisma.clientSession.deleteMany({ where: { clientId: client.id } }); // deloghează toate dispozitivele
  evictClientSessions(client.id);

  redirect("/portal/login?reset=1");
}

export async function clientLogout(): Promise<void> {
  const current = await getCurrentClient();
  // În simulare din staff, „Deconectare” = ieșirea din simulare (înapoi în staff), nu logout pentru client.
  if (current?.impersonation) {
    const r = await exitPortalImpersonation();
    redirect(r.ok ? r.to : "/login");
  }
  if (current) {
    await destroyClientSession();
  }
  redirect("/portal/login");
}
