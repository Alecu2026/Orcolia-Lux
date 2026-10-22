"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { NOTIFY_MAX_NOTE, type PayerNoteItem } from "@/lib/payer-notify";

export type NoteResult = { ok: true; note: PayerNoteItem } | { ok: false; error: string };
export type NoteDeleteResult = { ok: true } | { ok: false; error: string };

const ID_RE = /^[0-9a-f]{24}$/i;
const SELECT = { id: true, body: true, userId: true, userName: true, createdAt: true, updatedAt: true } as const;
const toItem = (n: { id: string; body: string; userId: string; userName: string; createdAt: Date; updatedAt: Date }): PayerNoteItem => ({
  ...n,
  createdAt: n.createdAt.toISOString(),
  updatedAt: n.updatedAt.toISOString(),
});

function cleanBody(v: unknown): { body: string } | { error: string } {
  const body = typeof v === "string" ? v.trim() : "";
  if (!body) return { error: "Scrie notița." };
  if (body.length > NOTIFY_MAX_NOTE) return { error: `Notița depășește ${NOTIFY_MAX_NOTE} de caractere.` };
  return { body };
}

export async function addPayerNoteAction(clientId: string, text: string): Promise<NoteResult> {
  const user = await requireUser();
  if (!can(user, "payers.edit")) return { ok: false, error: "Fără permisiune." };
  if (DEMO) return { ok: false, error: "Mod demo: conectează o bază de date." };
  if (!ID_RE.test(clientId)) return { ok: false, error: "Plătitor invalid." };
  const c = cleanBody(text);
  if ("error" in c) return { ok: false, error: c.error };
  const exists = await prisma.client.count({ where: { id: clientId } });
  if (!exists) return { ok: false, error: "Plătitorul nu mai există." };
  const note = await prisma.payerNote.create({
    data: { clientId, body: c.body, userId: user.id, userName: user.name },
    select: SELECT,
  });
  return { ok: true, note: toItem(note) };
}

/** Autorul sau un administrator poate edita/șterge o notiță. */
async function ownNote(id: string) {
  const user = await requireUser();
  if (!can(user, "payers.edit")) return { ok: false as const, error: "Fără permisiune." };
  if (DEMO) return { ok: false as const, error: "Mod demo: conectează o bază de date." };
  if (!ID_RE.test(id)) return { ok: false as const, error: "Notiță invalidă." };
  const note = await prisma.payerNote.findUnique({ where: { id }, select: { userId: true } });
  if (!note) return { ok: false as const, error: "Notița nu mai există." };
  if (note.userId !== user.id && !can(user, "admin")) return { ok: false as const, error: "Poți modifica doar notițele tale." };
  return { ok: true as const, user };
}

export async function updatePayerNoteAction(id: string, text: string): Promise<NoteResult> {
  const g = await ownNote(id);
  if (!g.ok) return { ok: false, error: g.error };
  const c = cleanBody(text);
  if ("error" in c) return { ok: false, error: c.error };
  const note = await prisma.payerNote.update({ where: { id }, data: { body: c.body }, select: SELECT });
  return { ok: true, note: toItem(note) };
}

export async function deletePayerNoteAction(id: string): Promise<NoteDeleteResult> {
  const g = await ownNote(id);
  if (!g.ok) return { ok: false, error: g.error };
  await prisma.payerNote.deleteMany({ where: { id } });
  return { ok: true };
}
