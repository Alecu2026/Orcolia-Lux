"use server";

import { requireClient } from "@/lib/client-dal";
import { parseIndex, type PhotoResult } from "@/lib/meter-readings";
import type { PortalReadingResult } from "@/lib/portal-meters";
import { submitPortalReading, uploadPortalPhoto } from "@/lib/services/portal-meters";
import { auditPortalAction } from "@/lib/services/impersonation";

/**
 * Citiri trimise de plătitor din portal (cabinetul personal). Plătitorul vine din sesiunea portalului (nu din formular), iar serviciul verifică
 * că contorul îi aparține. Logica stă în lib/services/portal-meters.ts.
 */

export async function submitPortalReadingAction(formData: FormData): Promise<PortalReadingResult> {
  const client = await requireClient();
  const meterId = String(formData.get("meterId") ?? "");
  if (!meterId || meterId.length > 300) return { ok: false, error: "Contor invalid." };
  const value = parseIndex(String(formData.get("value") ?? ""));
  if (value == null) return { ok: false, error: "Index invalid. Scrie un număr (m³), ex. 1234,5." };
  const res = await submitPortalReading(client, {
    meterId,
    value,
    confirmed: formData.get("confirmed") === "1",
    issueKind: String(formData.get("issueKind") ?? ""),
    issueNote: String(formData.get("issueNote") ?? "").slice(0, 500),
  });
  if (res.ok) await auditPortalAction(`index contor ${value} m³`);
  return res;
}

export async function uploadPortalPhotoAction(formData: FormData): Promise<PhotoResult> {
  const client = await requireClient();
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Nicio poză selectată." };
  return uploadPortalPhoto(client, String(formData.get("readingId") ?? ""), file);
}
