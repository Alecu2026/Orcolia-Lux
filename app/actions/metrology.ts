"use server";

import { requireUser } from "@/lib/dal";
import { DEFAULT_TZ, todayKey } from "@/lib/date";
import { cleanMetrologyDate } from "@/lib/metrology";
import { canEditMetrology, setMeterMetrology } from "@/lib/services/metrology-admin";

export type MetrologyState = { ok?: boolean; error?: string; verifiedAt?: string | null; dueAt?: string | null };

/** Salvează (sau șterge, cu `date` gol) data ultimei verificări metrologice a unui contor; scadența = +5 ani. */
export async function setMeterMetrologyAction(meterId: string, date: string | null): Promise<MetrologyState> {
  const user = await requireUser();
  if (!canEditMetrology(user)) return { error: "Fără permisiune." };
  if (typeof meterId !== "string" || !meterId || meterId.length > 300) return { error: "Contorul nu a fost găsit." };
  const raw = (date ?? "").trim();
  const key = raw ? cleanMetrologyDate(raw) : null;
  if (raw && !key) return { error: "Data verificării metrologice e invalidă (ZZ.LL.AAAA)." };
  if (key && key > todayKey(DEFAULT_TZ)) return { error: "Data verificării nu poate fi în viitor." };
  const res = await setMeterMetrology(user, meterId, key);
  return res.ok ? { ok: true, verifiedAt: res.verifiedAt, dueAt: res.dueAt } : { error: res.error };
}
