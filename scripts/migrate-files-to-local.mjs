// Mută fișierele deja încărcate în cloud (Vercel Blob) pe discul serverului și convertește pozele în WebP.
// Acoperă: atașamentele task-urilor (TaskAttachment.url) și pozele citirilor de contoare (MeterReading.photoUrl).
//
// Rulare (din folderul aplicației, cu DATABASE_URL și UPLOAD_DIR setate ca la aplicație — ex. `node --env-file=.env scripts/migrate-files-to-local.mjs`):
//   node scripts/migrate-files-to-local.mjs             → RAPORT: câte fișiere, câți MB (nu descarcă, nu modifică nimic)
//   node scripts/migrate-files-to-local.mjs --apply     → descarcă, convertește pozele (JPEG/PNG → WebP ≤ 1920 px), salvează în UPLOAD_DIR, actualizează baza de date
//   --no-webp   nu converti pozele (le copiază ca atare)        --limit=N   procesează cel mult N fișiere (pentru probă)
//
// Sigur de re-rulat: rândurile deja mutate (adresă /files/...) se sar. Fișierele din cloud NU se șterg — după ce verifici că totul merge, golești store-ul din Vercel.
import { randomBytes } from "node:crypto";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const webp = !process.argv.includes("--no-webp");
const limit = Number((process.argv.find((a) => a.startsWith("--limit=")) ?? "").split("=")[1]) || Infinity;
const ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "storage"), "public");
const MAX_PX = 1920;
const QUALITY = 80;
const MIN_BYTES = 100 * 1024;

const prisma = new PrismaClient();
const mb = (n) => (n / 1048576).toFixed(1) + " MB";
const safeName = (n) => n.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").replace(/^[._]+/, "").slice(-80) || "fisier";
const isRemote = (u) => typeof u === "string" && /^https?:\/\//i.test(u);

async function toWebp(buf, type) {
  if (!webp || !["image/jpeg", "image/png"].includes(type) || buf.length < MIN_BYTES) return null;
  const sharp = (await import("sharp")).default;
  const out = await sharp(buf, { failOn: "none" }).rotate().resize({ width: MAX_PX, height: MAX_PX, fit: "inside", withoutEnlargement: true }).webp({ quality: QUALITY }).toBuffer();
  return out.length < buf.length ? out : null;
}

const typeOf = (name, header) => {
  if (header && header !== "application/octet-stream") return header.split(";")[0].trim();
  const ext = name.split(".").pop().toLowerCase();
  return { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", pdf: "application/pdf" }[ext] ?? "application/octet-stream";
};

/** Descarcă, convertește, salvează pe disc; întoarce { url, size, name, mimeType }. */
async function move(remoteUrl, folder, name, mimeHint) {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error(`descărcare ${res.status}`);
  let buf = Buffer.from(await res.arrayBuffer());
  let type = typeOf(name, mimeHint || res.headers.get("content-type"));
  let outName = name;
  const conv = await toWebp(buf, type);
  if (conv) { buf = conv; type = "image/webp"; outName = name.replace(/\.[^.]+$/, "") + ".webp"; }
  const rel = `${folder}/${randomBytes(12).toString("hex")}-${safeName(outName)}`;
  const abs = path.join(ROOT, ...rel.split("/"));
  await mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.part`;
  try { await writeFile(tmp, buf); await rename(tmp, abs); } catch (e) { await unlink(tmp).catch(() => {}); throw e; }
  return { abs, url: "/files/" + rel.split("/").map(encodeURIComponent).join("/"), size: buf.length, name: outName, mimeType: type };
}

async function headSize(url) {
  try { const r = await fetch(url, { method: "HEAD" }); return Number(r.headers.get("content-length")) || 0; } catch { return 0; }
}

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}

// Același folder ca în aplicație (lib/services/file-folders.ts): sarcini|cereri / <cod>-<proiect>, sau fara-proiect; la redenumirea proiectului se continuă în folderul existent.
const folderCache = new Map();
const slug = (n) => n.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "proiect";
async function projectFolder(task) {
  const kind = task?.type === "TICKET" ? "cereri" : "sarcini";
  const proj = task?.project;
  if (!task?.projectId || !proj) return `${kind}/fara-proiect`;
  const code = proj.seq != null ? String(proj.seq).padStart(3, "0") : task.projectId.slice(-6);
  const key = kind + ":" + code;
  if (!folderCache.has(key)) {
    const { readdir } = await import("node:fs/promises");
    const existing = (await readdir(path.join(ROOT, kind)).catch(() => [])).find((d) => d.startsWith(code + "-"));
    folderCache.set(key, `${kind}/${existing ?? `${code}-${slug(proj.name)}`}`);
  }
  return folderCache.get(key);
}

const stats = { done: 0, failed: 0, before: 0, after: 0 };

async function main() {
  const host = (process.env.DATABASE_URL || "").replace(/^[a-z+]+:\/\/[^@]*@/, "").split(/[/?]/)[0];
  console.log(`Baza de date: ${host || "(necunoscută)"} · stocare locală: ${ROOT} · ${apply ? "APLICARE" : "RAPORT (nu se modifică nimic)"}${webp ? " · cu WebP" : " · fără WebP"}`);

  const atts = (await prisma.taskAttachment.findMany({ select: { id: true, taskId: true, url: true, name: true, size: true, mimeType: true, task: { select: { type: true, projectId: true, project: { select: { seq: true, name: true } } } } } })).filter((a) => isRemote(a.url));
  const reads = (await prisma.meterReading.findMany({ where: { photoUrl: { not: null } }, select: { id: true, period: true, contor: true, photoUrl: true, photoName: true } })).filter((r) => isRemote(r.photoUrl));
  const jobs = [
    ...(await Promise.all(atts.map(async (a) => ({ kind: "atașament", id: a.id, url: a.url, folder: await projectFolder(a.task), name: a.name || "fisier", mime: a.mimeType, size: a.size, save: (m) => prisma.taskAttachment.update({ where: { id: a.id }, data: { url: m.url, size: m.size, name: m.name, mimeType: m.mimeType } }) })))),
    ...reads.map((r) => ({ kind: "poză contor", id: r.id, url: r.photoUrl, folder: `contoare/${r.period}`, name: r.photoName || `${r.contor}.jpg`, mime: null, size: 0, save: (m) => prisma.meterReading.update({ where: { id: r.id }, data: { photoUrl: m.url, photoName: m.name } }) })),
  ].slice(0, limit);

  console.log(`De mutat: ${atts.length} atașamente + ${reads.length} poze de contor${jobs.length < atts.length + reads.length ? ` (limitat la ${jobs.length})` : ""}.`);
  if (!jobs.length) return;

  if (!apply) {
    let total = 0;
    await pool(jobs, 8, async (j) => { total += j.size || (await headSize(j.url)); });
    console.log(`Spațiu ocupat acum în cloud (aprox.): ${mb(total)}.`);
    console.log("Rulează cu --apply pentru a le muta (pozele mari devin WebP, de obicei de 5–10 ori mai mici).");
    return;
  }

  await pool(jobs, 4, async (j, k) => {
    try {
      const m = await move(j.url, j.folder, j.name, j.mime);
      try {
        await j.save(m);
      } catch (e) {
        await unlink(m.abs).catch(() => {});
        throw e;
      }
      stats.done++; stats.before += j.size || 0; stats.after += m.size;
      if ((k + 1) % 25 === 0 || k + 1 === jobs.length) console.log(`  ${k + 1}/${jobs.length}…`);
    } catch (e) {
      stats.failed++;
      console.error(`  EȘUAT ${j.kind} ${j.id}: ${e.message} (${j.url.slice(0, 90)})`);
    }
  });
  console.log(`Gata: ${stats.done} mutate, ${stats.failed} eșuate. Atașamente — înainte ${mb(stats.before)} → după ${mb(stats.after)} (poze de contor excluse din calcul).`);
  if (stats.failed) console.log("Cele eșuate au rămas neschimbate (încă în cloud); poți rula din nou scriptul.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
