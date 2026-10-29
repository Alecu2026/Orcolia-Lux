import "server-only";
import { promises as fs } from "node:fs";
import path from "node:path";
import { prisma } from "../prisma";
import { kindDir, publicRoot } from "../storage";

/**
 * Ierarhia folderelor pentru atașamentele task-urilor: un folder pe PROIECT, în folderul tipului (nu pe fiecare task):
 *
 *   sarcini/<cod>-<proiect>/…     cereri/<cod>-<proiect>/…     sarcini|cereri/fara-proiect/… (task-uri fără proiect)
 *
 * Codul e numărul proiectului (012) — stabil; dacă proiectul e redenumit, se continuă în folderul existent (se caută după cod), nu se creează altul.
 * Folderul se creează la prima poză / primul fișier al proiectului (vezi storePublic).
 */

const known = new Map<string, string>();

const slug = (n: string) =>
  n.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "proiect";

export async function taskFileFolder(type: string, projectId: string | null): Promise<string> {
  const kind = kindDir(type);
  if (!projectId) return `${kind}/fara-proiect`;
  const key = `${kind}:${projectId}`;
  const hit = known.get(key);
  if (hit) return hit;
  const proj = await prisma.project.findUnique({ where: { id: projectId }, select: { seq: true, name: true } });
  if (!proj) return `${kind}/fara-proiect`;
  const code = proj.seq != null ? String(proj.seq).padStart(3, "0") : projectId.slice(-6);
  const existing = (await fs.readdir(path.join(publicRoot(), kind)).catch(() => [] as string[])).find((d) => d.startsWith(code + "-"));
  const folder = `${kind}/${existing ?? `${code}-${slug(proj.name)}`}`;
  known.set(key, folder);
  return folder;
}
