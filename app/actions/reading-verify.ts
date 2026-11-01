"use server";

import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import { verifyReadingToken } from "@/lib/reading-verify-token";
import { isRateLimited } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request-ip";
import { filteredAdminRecipients, notifyUsers, observerRecipients } from "@/lib/services/notifications";
import { invalidatePortalClient } from "@/lib/portal-cache";

/**
 * Confirmarea / contestarea unei citiri din linkul primit pe email. Fără autentificare: dovada e codul semnat din link (citire + index). Limitat pe adresă; o valoare schimbată între timp nu se mai poate
 * confirma. Confirmarea / contestarea se înregistrează pe citire (`verifiedAt` / `disputedAt`); la contestare, personalul e anunțat.
 */

export type VerifyResult = { ok: true; status: "confirmed" | "disputed" } | { ok: false; error: string };

async function load(token: string): Promise<{ ok: true; id: string; value: number; contor: string; clientId: string | null } | { ok: false; error: string }> {
  if (DEMO) return { ok: false, error: "Mod demo." };
  const ip = await clientIp();
  if (ip && isRateLimited(`reading-verify-act:${ip}`, 30, 60_000)) return { ok: false, error: "Prea multe încercări. Încearcă din nou peste un minut." };
  const claim = verifyReadingToken(token);
  if (!claim) return { ok: false, error: "Linkul nu este valid sau a expirat." };
  const r = await prisma.meterReading.findUnique({ where: { id: claim.readingId }, select: { id: true, value: true, contor: true, clientId: true } });
  if (!r) return { ok: false, error: "Citirea nu mai există." };
  if (r.value !== claim.value) return { ok: false, error: "Citirea a fost modificată între timp. Verifică emailul cel mai recent." };
  return { ok: true, id: r.id, value: r.value, contor: r.contor, clientId: r.clientId };
}

export async function confirmReadingAction(token: string): Promise<VerifyResult> {
  const r = await load(String(token ?? ""));
  if (!r.ok) return r;
  // condiționat pe același index: o modificare apărută între timp nu primește confirmarea
  const upd = await prisma.meterReading.updateMany({ where: { id: r.id, value: r.value }, data: { verifiedAt: new Date(), disputedAt: null, disputeNote: null } });
  if (upd.count !== 1) return { ok: false, error: "Citirea a fost modificată între timp. Verifică emailul cel mai recent." };
  invalidatePortalClient(r.clientId);
  return { ok: true, status: "confirmed" };
}

export async function disputeReadingAction(token: string, note: string): Promise<VerifyResult> {
  const r = await load(String(token ?? ""));
  if (!r.ok) return r;
  const text = String(note ?? "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  const upd = await prisma.meterReading.updateMany({ where: { id: r.id, value: r.value }, data: { disputedAt: new Date(), disputeNote: text, verifiedAt: null } });
  if (upd.count !== 1) return { ok: false, error: "Citirea a fost modificată între timp. Verifică emailul cel mai recent." };
  invalidatePortalClient(r.clientId);
  try {
    const client = r.clientId ? await prisma.client.findUnique({ where: { id: r.clientId }, select: { name: true } }) : null;
    const ids = [...new Set([...(await filteredAdminRecipients({ eventKeys: ["meter.dispute"] })), ...(await observerRecipients("meter.dispute"))])];
    if (ids.length) {
      await notifyUsers(ids, { title: `⚠️ Citire contestată: contor ${r.contor} (${r.value} m³)`, body: `${client?.name ?? "Plătitor"}${text ? ` — ${text}` : ""}`, url: "/contoare/citiri" }, { telegram: true });
    }
  } catch (e) {
    console.error("[reading-verify] notificarea contestației:", e);
  }
  return { ok: true, status: "disputed" };
}
