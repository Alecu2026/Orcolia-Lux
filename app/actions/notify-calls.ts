"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { env } from "@/lib/env";
import { isRateLimited } from "@/lib/rate-limit";
import { placePbxCall, listPbxUsers, type PbxUser } from "@/lib/pbx-api";

const ID_RE = /^[0-9a-f]{24}$/i;
const OPERATOR_RE = /^[\w.@-]{1,64}$/;
const errText = (e: unknown) => (e instanceof Error ? e.message : "Eroare necunoscută").slice(0, 200);

async function guard() {
  const user = await requireUser();
  if (!can(user, "pbx.manage")) return { ok: false as const, error: "Fără permisiune." };
  if (DEMO) return { ok: false as const, error: "Mod demo: conectează o bază de date." };
  if (!env.pbx.apiKey) return { ok: false as const, error: "PBX_API_KEY nu este setat (Vercel → Environment Variables)." };
  return { ok: true as const, user };
}

export type DialResult = { ok: true; callId: string; dialedAt: string; operator: string } | { ok: false; error: string };

/**
 * „Sună": PBX-ul sună întâi operatorul ales, apoi îl leagă cu plătitorul. Rândul trece pe „dialing" și primește `callId`,
 * cu care îl legăm de apelul din PbxCall (stare, durată, înregistrare). Se scrie și în jurnalul de notificări al plătitorului.
 */
export async function dialNotifyCallAction(id: string, operator: string): Promise<DialResult> {
  const g = await guard();
  if (!g.ok) return g;
  if (!ID_RE.test(id ?? "")) return { ok: false, error: "Rând invalid." };
  const op = (operator ?? "").trim();
  if (!OPERATOR_RE.test(op)) return { ok: false, error: "Alege operatorul care primește apelul." };
  if (isRateLimited(`notify-dial:${g.user.id}`, 40, 60_000)) return { ok: false, error: "Prea multe apeluri într-un minut." };

  const row = await prisma.notifyCall.findUnique({ where: { id } });
  if (!row) return { ok: false, error: "Rândul nu mai există (poate l-a șters altcineva)." };
  if (row.dialedAt && Date.now() - row.dialedAt.getTime() < 30_000) {
    return { ok: false, error: "Apelul a pornit deja acum câteva secunde — răspunde pe telefon." };
  }

  let callId: string;
  try {
    callId = await placePbxCall(row.phone, op);
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
  const now = new Date();
  await Promise.all([
    prisma.notifyCall.update({ where: { id }, data: { status: "dialing", callId, operator: op, dialedAt: now } }),
    prisma.client.update({ where: { id: row.clientId }, data: { lastNotifiedAt: now } }).catch(() => null),
    prisma.payerNotificationLog
      .create({
        data: {
          campaignId: row.campaignId, clientId: row.clientId, clientName: row.clientName, channel: "CALL", to: row.phone,
          status: "SENT", error: null, subject: `operator ${op}`, body: row.text, userId: g.user.id, userName: g.user.name,
        },
      })
      .catch((e) => console.error("[notify] jurnal apel:", e)),
  ]);
  return { ok: true, callId, dialedAt: now.toISOString(), operator: op };
}

export type SimpleResult = { ok: true } | { ok: false; error: string };

export async function saveNotifyCallNoteAction(id: string, note: string): Promise<SimpleResult> {
  const user = await requireUser();
  if (!can(user, "pbx.manage")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };
  if (!ID_RE.test(id ?? "")) return { ok: false, error: "Rând invalid." };
  const text = (note ?? "").trim().slice(0, 1000);
  const res = await prisma.notifyCall.updateMany({ where: { id }, data: { note: text || null } });
  return res.count ? { ok: true } : { ok: false, error: "Rândul nu mai există." };
}

export async function deleteNotifyCallAction(id: string): Promise<SimpleResult> {
  const user = await requireUser();
  if (!can(user, "pbx.manage")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };
  if (!ID_RE.test(id ?? "")) return { ok: false, error: "Rând invalid." };
  await prisma.notifyCall.deleteMany({ where: { id } });
  return { ok: true };
}

export type OperatorsResult = { ok: true; users: PbxUser[]; defaultUser: string } | { ok: false; error: string };

/** Angajații din PBX (pentru alegerea operatorului care primește apelul). */
export async function listPbxOperatorsAction(): Promise<OperatorsResult> {
  const g = await guard();
  if (!g.ok) return g;
  try {
    return { ok: true, users: await listPbxUsers(), defaultUser: env.pbx.callUser };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}

/**
 * Marchează rândurile ca „exportate" în PBX (autoinformare): ies din coadă, ca să nu fie exportate sau sunate a doua oară.
 * Se schimbă doar rândurile încă „queued".
 */
export async function markNotifyCallsExportedAction(ids: string[]): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "pbx.manage")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };
  const clean = [...new Set((Array.isArray(ids) ? ids : []).filter((x) => typeof x === "string" && ID_RE.test(x)))].slice(0, 5000);
  if (clean.length === 0) return { ok: true, count: 0 };
  let count = 0;
  for (let i = 0; i < clean.length; i += 200) {
    const res = await prisma.notifyCall.updateMany({
      where: { id: { in: clean.slice(i, i + 200) }, status: "queued" },
      data: { status: "exported", operator: "autoinformare", dialedAt: new Date() },
    });
    count += res.count;
  }
  return { ok: true, count };
}
