"use server";

import { after } from "next/server";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import type { LorawanStatus } from "@/lib/lorawan";
import { getLorawanStatus, lorawanConfigured, runLorawanSync } from "@/lib/services/lorawan";
import { logAudit } from "@/lib/services/audit";

/** Starea extragerii LoRaWAN, pentru pagina „LoRaWAN” (se reîmprospătează cât rulează o extragere). */
export async function lorawanStatusAction(): Promise<LorawanStatus | null> {
  const user = await requireUser();
  if (!can(user, "meters.manage")) return null;
  return getLorawanStatus();
}

/** Activarea: prima extragere (în fundal). Dacă reușește, extragerea automată zilnică se pornește de-acum, iar butonul dispare. */
export async function activateLorawanAction(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!can(user, "meters.manage")) return { ok: false, error: "Fără permisiune." };
  if (!lorawanConfigured()) return { ok: false, error: "Lipsește LORAWAN_TOKEN în configurația serverului." };
  const st = await getLorawanStatus();
  if (st.activated) return { ok: false, error: "Extragerea e deja activată." };
  if (st.running) return { ok: false, error: "O extragere rulează deja." };
  await logAudit(user, { action: "meter.lorawan.run", module: "Meters", objectId: "lorawan", objectName: "LoRaWAN", details: { extra: [{ label: "Activare LoRaWAN (prima extragere)", value: user.name }] } }).catch(() => {});
  after(async () => {
    await runLorawanSync("manual", { activate: true });
  });
  return { ok: true };
}

/** Pornește acum o extragere (în fundal: durează zeci de secunde sau minute). Cea de la 23:30 rămâne neschimbată. */
export async function runLorawanAction(): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!can(user, "meters.manage")) return { ok: false, error: "Fără permisiune." };
  if (!lorawanConfigured()) return { ok: false, error: "Lipsește LORAWAN_TOKEN în configurația serverului." };
  const st = await getLorawanStatus();
  if (!st.activated) return { ok: false, error: "Extragerea LoRaWAN nu e activată. Activeaz-o din pagina LoRaWAN." };
  if (st.running) return { ok: false, error: "O extragere rulează deja." };
  await logAudit(user, { action: "meter.lorawan.run", module: "Meters", objectId: "lorawan", objectName: "LoRaWAN", details: { extra: [{ label: "Pornită manual", value: user.name }] } }).catch(() => {});
  after(async () => {
    await runLorawanSync("manual");
  });
  return { ok: true };
}
