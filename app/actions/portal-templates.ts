"use server";

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { invalidatePortalTemplates, listPortalTemplates } from "@/lib/queries/portal-templates";
import {
  PORTAL_TEMPLATE_MAX,
  PORTAL_TEMPLATE_MAX_DESCRIPTION,
  PORTAL_TEMPLATE_MAX_NAME,
  PORTAL_TEMPLATE_MAX_TITLE,
  type PortalTemplate,
} from "@/lib/portal-template";
import { DEFAULT_PORTAL_SECTIONS, DEFAULT_PORTAL_TEMPLATES } from "@/lib/portal-default-templates";

export type PortalTemplateResult = { ok: true; templates: PortalTemplate[] } | { ok: false; error: string };

const ID_RE = /^[0-9a-f]{24}$/i;
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function guard() {
  const user = await requireUser();
  if (!can(user, "admin")) return { ok: false as const, error: "Doar administratorul poate edita șabloanele pentru clienți." };
  if (DEMO) return { ok: false as const, error: "Mod demo: conectează o bază de date." };
  return { ok: true as const };
}

function refresh() {
  invalidatePortalTemplates();
  revalidatePath("/portal");
  revalidatePath("/portal/cereri");
  revalidatePath("/settings/portal-accounts");
}

/** Creează (fără `id`) sau modifică (cu `id`) un șablon de cerere pentru clienți. Întoarce lista actualizată. */
export async function savePortalTemplateAction(input: { id?: string; name: string; title: string; description: string; teamId?: string | null }): Promise<PortalTemplateResult> {
  try {
    const g = await guard();
    if (!g.ok) return g;
    const name = str(input?.name).trim();
    const title = str(input?.title).replace(/[\r\n]+/g, " ").trim();
    const description = str(input?.description).trim();
    if (!name) return { ok: false, error: "Dă un nume șablonului." };
    if (name.length > PORTAL_TEMPLATE_MAX_NAME) return { ok: false, error: `Numele depășește ${PORTAL_TEMPLATE_MAX_NAME} de caractere.` };
    if (!title) return { ok: false, error: "Titlul e obligatoriu." };
    if (title.length > PORTAL_TEMPLATE_MAX_TITLE) return { ok: false, error: `Titlul depășește ${PORTAL_TEMPLATE_MAX_TITLE} de caractere.` };
    if (description.length > PORTAL_TEMPLATE_MAX_DESCRIPTION) return { ok: false, error: "Descrierea e prea lungă." };
    // secția responsabilă: trebuie să existe; gol = administratorii
    const rawTeam = str(input?.teamId).trim();
    if (rawTeam && !(ID_RE.test(rawTeam) && (await prisma.team.findUnique({ where: { id: rawTeam }, select: { id: true } })))) return { ok: false, error: "Secția aleasă nu mai există." };
    const teamId = rawTeam || null;
    if (input?.id) {
      if (!ID_RE.test(input.id)) return { ok: false, error: "Șablon invalid." };
      const done = await prisma.portalRequestTemplate.update({ where: { id: input.id }, data: { name, title, description, teamId } }).catch(() => null);
      if (!done) return { ok: false, error: "Șablonul nu mai există." };
    } else {
      if ((await prisma.portalRequestTemplate.count()) >= PORTAL_TEMPLATE_MAX) return { ok: false, error: `Maximum ${PORTAL_TEMPLATE_MAX} de șabloane.` };
      const last = await prisma.portalRequestTemplate.findFirst({ orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
      await prisma.portalRequestTemplate.create({ data: { name, title, description, teamId, sortOrder: (last?.sortOrder ?? 0) + 1 } });
    }
    refresh();
    return { ok: true, templates: await listPortalTemplates() };
  } catch (e) {
    console.error("[portal-templates] salvare eșuată", e);
    return { ok: false, error: "Nu am putut salva șablonul." };
  }
}

export async function deletePortalTemplateAction(id: string): Promise<PortalTemplateResult> {
  try {
    const g = await guard();
    if (!g.ok) return g;
    if (!ID_RE.test(id ?? "")) return { ok: false, error: "Șablon invalid." };
    await prisma.portalRequestTemplate.delete({ where: { id } }).catch(() => null);
    refresh();
    return { ok: true, templates: await listPortalTemplates() };
  } catch (e) {
    console.error("[portal-templates] ștergere eșuată", e);
    return { ok: false, error: "Nu am putut șterge șablonul." };
  }
}

/** Adaugă șabloanele standard (cele 7 cereri + petiția) care lipsesc după nume; cele existente rămân neatinse. Întoarce lista actualizată și câte s-au adăugat. */
export async function addDefaultPortalTemplatesAction(): Promise<(PortalTemplateResult & { added?: number; addedTeams?: number; teams?: { id: string; name: string }[] })> {
  try {
    const g = await guard();
    if (!g.ok) return g;
    // secțiile (echipe fără persoane): doar cele care lipsesc (nume comparat fără diacritice / majuscule)
    const plain = (v: string) => v.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
    const haveTeams = new Set((await prisma.team.findMany({ select: { name: true } })).map((x) => plain(x.name)));
    const newTeams = DEFAULT_PORTAL_SECTIONS.filter((n) => !haveTeams.has(plain(n)));
    for (const name of newTeams) await prisma.team.create({ data: { name } });
    if (newTeams.length) {
      updateTag("teams");
      revalidatePath("/team");
    }
    const existing = await prisma.portalRequestTemplate.findMany({ select: { name: true, sortOrder: true } });
    const have = new Set(existing.map((x) => x.name.trim().toLowerCase()));
    const missing = DEFAULT_PORTAL_TEMPLATES.filter((d) => !have.has(d.name.toLowerCase()));
    if (existing.length + missing.length > PORTAL_TEMPLATE_MAX) return { ok: false, error: `Maximum ${PORTAL_TEMPLATE_MAX} de șabloane.` };
    let order = existing.reduce((m, x) => Math.max(m, x.sortOrder), 0);
    for (const d of missing) await prisma.portalRequestTemplate.create({ data: { name: d.name, title: d.title, description: d.description, sortOrder: ++order } });
    refresh();
    return { ok: true, templates: await listPortalTemplates(), added: missing.length, addedTeams: newTeams.length, teams: await prisma.team.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }) };
  } catch (e) {
    console.error("[portal-templates] adăugarea șabloanelor standard a eșuat", e);
    return { ok: false, error: "Nu am putut adăuga șabloanele." };
  }
}
