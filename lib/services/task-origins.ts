import "server-only";
import { prisma } from "../prisma";
import type { ExtraSheet } from "../export-utils";

/** Originea cererilor / sarcinilor (portal, creată de noi, email) și șabloanele lor: folosit de exportul Excel și de pagina Rapoarte. */
export type Origin = "PORTAL" | "INTERNAL" | "EMAIL";
export const ORIGIN_LABEL: Record<Origin, string> = { PORTAL: "Portal clienți", INTERNAL: "Creată de noi (CRM)", EMAIL: "Email" };
const NO_INTERNAL = "Fără șablon intern (create manual / înainte de evidența șabloanelor)";
const NO_TEMPLATE ="Fără șablon (altă cerere / cereri mai vechi)";

/**
 * Originea cererilor exportate. Nu e salvată ca atare: doar portalul și emailul completează solicitantul (`fromName` / `fromEmail`), iar cererile create în CRM nu —
 * deci „portal” = are șablon din portal sau solicitant fără să fie din email; „creată de noi” = restul. Cererile mai vechi din portal, fără șablon salvat, se potrivesc
 * după titlu (care pornește din numele șablonului), ca în filtrul „Șablon din portal”. Șablonul intern folosit (Setări → Șabloane) se păstrează pe cerere (`taskTemplateId`) doar de la introducerea evidenței; cele create înainte, sau fără șablon, apar la „Fără șablon intern”.
 */
export async function ticketOrigins(items: { id: string; title: string; portalTemplateId: string | null }[], type: "TICKET" | "TASK" = "TICKET") {
  const [templates, internalTemplates, flags] = await Promise.all([
    prisma.portalRequestTemplate.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
    prisma.taskTemplate.findMany({ where: { type }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    (async () => {
      const out = new Map<string, { emailSource: boolean; who: boolean; tplId: string | null; tplName: string | null }>();
      const ids = items.map((t) => t.id);
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += 1000) chunks.push(ids.slice(i, i + 1000));
      // loturi de câte 1000 de id-uri, câte 4 deodată (un `id in` uriaș e lent pe MongoDB)
      for (let i = 0; i < chunks.length; i += 4) {
        const parts = await Promise.all(chunks.slice(i, i + 4).map((c) => prisma.task.findMany({ where: { id: { in: c } }, select: { id: true, emailSource: true, fromName: true, fromEmail: true, taskTemplateId: true, taskTemplateName: true } })));
        for (const r of parts.flat()) out.set(r.id, { emailSource: !!r.emailSource, who: !!(r.fromName?.trim() || r.fromEmail?.trim()), tplId: r.taskTemplateId ?? null, tplName: r.taskTemplateName ?? null });
      }
      return out;
    })(),
  ]);
  const nameById = new Map(templates.map((x) => [x.id, x.name]));
  const byLength = [...templates].sort((a, b) => b.name.length - a.name.length);
  const internalName = new Map(internalTemplates.map((x) => [x.id, x.name]));
  const internalCount = new Map<string, { name: string; n: number }>();
  let noInternal = 0;
  const byId = new Map<string, { origin: Origin; template: string; internal: string; portalTplId: string | null; internalTplId: string | null }>();
  const perOrigin: Record<Origin, number> = { PORTAL: 0, INTERNAL: 0, EMAIL: 0 };
  const perTemplate = new Map<string, number>();
  let noTemplate = 0;
  for (const t of items) {
    const f = flags.get(t.id);
    const origin: Origin = f?.emailSource ? "EMAIL" : t.portalTemplateId || f?.who ? "PORTAL" : "INTERNAL";
    let template = "";
    let portalTplId: string | null = null;
    if (origin === "PORTAL") {
      const title = t.title.trim().toLowerCase();
      const tplId = (t.portalTemplateId && nameById.has(t.portalTemplateId) ? t.portalTemplateId : null) ?? byLength.find((x) => x.name.trim() && title.startsWith(x.name.trim().toLowerCase()))?.id ?? null;
      template = tplId ? (nameById.get(tplId) ?? "") : "";
      portalTplId = tplId;
      if (tplId) perTemplate.set(tplId, (perTemplate.get(tplId) ?? 0) + 1); // pe id: două șabloane cu același nume nu se adună
      else noTemplate++;
    }
    // șablonul intern (doar la cererile create de noi): numele de acum, altfel cel salvat la creare (șablon șters ulterior)
    let internal = "";
    if (origin === "INTERNAL") {
      if (f?.tplId) {
        internal = internalName.get(f.tplId) ?? (f.tplName ? `${f.tplName} (șters)` : "(șablon șters)");
        const cur = internalCount.get(f.tplId);
        if (cur) cur.n++;
        else internalCount.set(f.tplId, { name: internal, n: 1 });
      } else noInternal++;
    }
    perOrigin[origin]++;
    byId.set(t.id, { origin, template, internal, portalTplId, internalTplId: origin === "INTERNAL" ? (f?.tplId ?? null) : null });
  }
  const summary: ExtraSheet = {
    name: "Sumar",
    rows: [
      ["Cereri exportate", items.length],
      [],
      ["Origine", "Cereri"],
      ["Create din portalul clienților", perOrigin.PORTAL],
      ["Create de noi (în CRM, inclusiv din șabloanele interne)", perOrigin.INTERNAL],
      ...(perOrigin.EMAIL ? [["Primite pe email", perOrigin.EMAIL]] : []),
      [],
      ["Din portalul clienților, pe șabloane", "Cereri"],
      ...templates.map((x): (string | number)[] => [x.name, perTemplate.get(x.id) ?? 0]),
      [NO_TEMPLATE, noTemplate],
      [],
      ["Create de noi, pe șabloane interne", "Cereri"],
      ...internalTemplates.map((x): (string | number)[] => [x.name, internalCount.get(x.id)?.n ?? 0]),
      ...[...internalCount].filter(([id]) => !internalName.has(id)).map(([, v]): (string | number)[] => [v.name, v.n]),
      [NO_INTERNAL, noInternal],
    ],
  };
  // pentru foaia „Raport”: șabloanele din portal, cele interne și cele interne șterse între timp (cu numele salvat)
  const internalRows = [...internalTemplates, ...[...internalCount].filter(([id]) => !internalName.has(id)).map(([id, v]) => ({ id, name: v.name }))];
  return { byId, summary, portalTemplates: templates, internalTemplates: internalRows };
}

