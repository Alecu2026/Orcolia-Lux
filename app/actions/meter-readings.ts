"use server";

import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { parseIndex, type ConsumAvg, type PhotoResult, type SaveReadingResult } from "@/lib/meter-readings";
import { getMeterAverage, getReading, saveReadingLogged } from "@/lib/services/meter-readings";
import { uploadReadingPhoto } from "@/lib/services/meter-photo";
import { reportIssue } from "@/lib/services/meter-issues";
import type { IssueDto } from "@/lib/meter-issues";

/**
 * Citiri lunare din teren — acțiuni pentru persoana responsabilă (permisiunea „Citiri contoare”). Logica stă în lib/services/meter-readings.ts
 * (într-un fișier „use server” fiecare funcție exportată poate fi apelată de oricine din browser, deci aici sunt doar punțile verificate).
 */

const num = (v: FormDataEntryValue | null): number | null => {
  if (typeof v !== "string" || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Salvează (sau corectează) citirea de luna aceasta: index în m³ + locația de la momentul citirii. */
export async function saveMeterReadingAction(formData: FormData): Promise<SaveReadingResult> {
  const user = await requireUser();
  if (!can(user, "meters.read")) return { ok: false, error: "Fără permisiune." };
  const meterId = String(formData.get("meterId") ?? "");
  if (!meterId || meterId.length > 300) return { ok: false, error: "Contor invalid." };
  const value = parseIndex(String(formData.get("value") ?? ""));
  if (value == null) return { ok: false, error: "Index invalid. Scrie un număr (m³), ex. 1234,5." };
  const res = await saveReadingLogged(user, {
    meterId,
    value,
    lat: num(formData.get("lat")),
    lng: num(formData.get("lng")),
    accuracy: num(formData.get("accuracy")),
    confirmed: formData.get("confirmed") === "1",
    address: typeof formData.get("address") === "string" ? String(formData.get("address")) : null,
  });
  // neregula găsită la contor (defect, fraudă, curgere inversă…) se salvează odată cu citirea; dacă ea eșuează, citirea rămâne salvată
  const issueKind = String(formData.get("issueKind") ?? "");
  if (res.ok && issueKind) {
    const r = await reportIssue(user, { meterId, kind: issueKind, note: String(formData.get("issueNote") ?? ""), readingId: res.reading.id });
    return r.ok ? { ...res, issue: r.issue } : { ...res, issueError: r.error };
  }
  return res;
}

/** Consumul mediu lunar al contorului (din ultimele luni), arătat în formular și folosit la avertismentele „peste / sub medie”; null = istoric insuficient. */
export async function meterAverageAction(meterId: string): Promise<ConsumAvg | null> {
  const user = await requireUser();
  if (!can(user, "meters.read")) return null;
  if (!meterId || meterId.length > 300) return null;
  return getMeterAverage(meterId).catch(() => null);
}

/** Doar neregula, fără index (contor inaccesibil, defect găsit fără citire). */
export async function reportMeterIssueAction(formData: FormData): Promise<{ ok: true; issue: IssueDto } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "meters.read")) return { ok: false, error: "Fără permisiune." };
  const meterId = String(formData.get("meterId") ?? "");
  if (!meterId || meterId.length > 300) return { ok: false, error: "Contor invalid." };
  const r = await reportIssue(user, { meterId, kind: String(formData.get("issueKind") ?? ""), note: String(formData.get("issueNote") ?? "") });
  return r.ok ? { ok: true, issue: r.issue } : r;
}

/** Poza contorului pentru o citire deja salvată (se poate înlocui). */
export async function uploadMeterPhotoAction(formData: FormData): Promise<PhotoResult> {
  const user = await requireUser();
  if (!can(user, "meters.read")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo." };
  const reading = await getReading(String(formData.get("readingId") ?? ""));
  if (!reading) return { ok: false, error: "Citirea nu există. Salvează întâi indexul." };
  return uploadReadingPhoto(reading.id, formData.get("file") as File);
}
