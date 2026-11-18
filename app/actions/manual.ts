"use server";

import { requireUser } from "@/lib/dal";
import { canEditManual } from "@/lib/manual-editor";
import { removeManualShot, saveManualShot, type SaveShotResult } from "@/lib/services/manual-shots";
import { setManualPublished, type ManualState } from "@/lib/services/manual-state";

/**
 * Pozele din „Manual de utilizare”: se pun / înlocuiesc / șterg doar de contul din lib/manual-editor.ts (verificat aici, pe server, nu doar în interfață).
 */

async function editor() {
  const user = await requireUser();
  if (!canEditManual(user.email)) return null;
  return user;
}

export async function uploadManualShotAction(formData: FormData): Promise<SaveShotResult> {
  const user = await editor();
  if (!user) return { ok: false, error: "Nu ai dreptul să modifici pozele din manual." };
  const file = formData.get("file");
  return saveManualShot(user, String(formData.get("key") ?? ""), file instanceof File ? file : null);
}

export async function removeManualShotAction(key: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await editor();
  if (!user) return { ok: false, error: "Nu ai dreptul să modifici pozele din manual." };
  return removeManualShot(user, String(key ?? ""));
}

/** „Finalizat”: manualul devine vizibil și pentru ceilalți utilizatori (după drepturile lor). Doar editorul. */
export async function publishManualAction(): Promise<{ ok: true; state: ManualState } | { ok: false; error: string }> {
  const user = await editor();
  if (!user) return { ok: false, error: "Nu ai dreptul să modifici pozele din manual." };
  return setManualPublished(user, true);
}

/** Retrage manualul din publicare: redevine ciornă, vizibil doar editorului. */
export async function unpublishManualAction(): Promise<{ ok: true; state: ManualState } | { ok: false; error: string }> {
  const user = await editor();
  if (!user) return { ok: false, error: "Nu ai dreptul să modifici pozele din manual." };
  return setManualPublished(user, false);
}
