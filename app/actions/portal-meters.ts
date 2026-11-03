"use server";

import { requireClient } from "@/lib/client-dal";
import { parseIndex } from "@/lib/meter-readings";
import type { PortalReadingResult } from "@/lib/portal-meters";
import { resendPortalConfirmation, submitPortalReading } from "@/lib/services/portal-meters";
import { auditPortalAction } from "@/lib/services/impersonation";

/**
 * Citiri trimise de plătitor din portal (cabinetul personal). Plătitorul vine din sesiunea portalului (nu din formular), iar serviciul verifică
 * că contorul îi aparține. Citirea cere poza (obligatorie) și se înregistrează abia după confirmarea din email. Logica stă în lib/services/portal-meters.ts.
 */

const num = (v: FormDataEntryValue | null): number | null => {
  const n = typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

export async function submitPortalReadingAction(formData: FormData): Promise<PortalReadingResult> {
  const client = await requireClient();
  const meterId = String(formData.get("meterId") ?? "");
  if (!meterId || meterId.length > 300) return { ok: false, error: "Contor invalid." };
  const value = parseIndex(String(formData.get("value") ?? ""));
  if (value == null) return { ok: false, error: "Index invalid. Scrie un număr (m³), ex. 1234,5." };
  const file = formData.get("photo");
  const res = await submitPortalReading(client, {
    meterId,
    value,
    confirmed: formData.get("confirmed") === "1",
    issueKind: String(formData.get("issueKind") ?? ""),
    issueNote: String(formData.get("issueNote") ?? "").slice(0, 500),
    photo: file instanceof File ? file : null,
    lat: num(formData.get("lat")),
    lng: num(formData.get("lng")),
    accuracy: num(formData.get("accuracy")),
  });
  if (res.ok) await auditPortalAction(`index contor ${value} m³ (în așteptarea confirmării)`);
  return res;
}

/** Retrimite emailul de confirmare al citirii în așteptare. */
export async function resendPortalConfirmationAction(meterId: string): Promise<{ ok: true; verifyEmail: string } | { ok: false; error: string }> {
  const client = await requireClient();
  if (typeof meterId !== "string" || !meterId || meterId.length > 300) return { ok: false, error: "Contor invalid." };
  return resendPortalConfirmation(client, meterId);
}
