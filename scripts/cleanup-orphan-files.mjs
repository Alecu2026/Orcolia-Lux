// Curăță fișierele de pe disc la care nu mai trimite nimic din baza de date (rămase după ștergeri, încărcări întrerupte etc.) și miniaturile lor.
//
// Rulare (din folderul aplicației, cu DATABASE_URL și UPLOAD_DIR ca la aplicație — ex. `node --env-file=.env scripts/cleanup-orphan-files.mjs`):
//   node scripts/cleanup-orphan-files.mjs            → RAPORT: ce ar șterge (nu șterge nimic)
//   node scripts/cleanup-orphan-files.mjs --apply    → șterge efectiv
//
// Nu atinge fișierele mai noi de 24 de ore (pot fi în curs de salvare) și nu atinge nimic din baza de date. Poate rula oricând, de ex. săptămânal din cron.
import { readdir, rmdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const apply = process.argv.includes("--apply");
const base = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "storage"));
const PUB = path.join(base, "public");
const PRIV = path.join(base, "private");
const CACHE = path.join(base, "cache");
const DAY = 24 * 3600 * 1000;
const prisma = new PrismaClient();
const mb = (n) => (n / 1048576).toFixed(1) + " MB";

async function walk(dir) {
  const out = [];
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

/** Șterge folderele rămase goale (fără a atinge rădăcinile). */
async function pruneEmpty(dir, keep) {
  let entries = [];
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) if (e.isDirectory()) await pruneEmpty(path.join(dir, e.name), false);
  if (!keep && (await readdir(dir).catch(() => ["x"])).length === 0) await rmdir(dir).catch(() => {});
}

async function main() {
  console.log(`Stocare: ${base} · ${apply ? "APLICARE" : "RAPORT (nu se șterge nimic)"}`);
  const refs = new Set();
  const add = (u) => { if (typeof u === "string" && u.startsWith("/files/")) { try { refs.add(decodeURIComponent(u.slice(7).split("?")[0])); } catch {} } };
  for (const a of await prisma.taskAttachment.findMany({ select: { url: true } })) add(a.url);
  for (const r of await prisma.meterReading.findMany({ where: { photoUrl: { not: null } }, select: { photoUrl: true } })) add(r.photoUrl);

  const now = Date.now();
  const doomed = [];
  const rel = (abs, root) => path.relative(root, abs).split(path.sep).join("/");
  for (const f of await walk(PUB)) {
    const st = await stat(f).catch(() => null);
    if (!st) continue;
    const old = now - st.mtimeMs > DAY;
    if (f.endsWith(".part") ? now - st.mtimeMs > 3600 * 1000 : old && !refs.has(rel(f, PUB))) doomed.push({ f, size: st.size, why: f.endsWith(".part") ? "încărcare întreruptă" : "fără rând în baza de date" });
  }
  for (const f of await walk(PRIV)) {
    const st = await stat(f).catch(() => null);
    if (st && now - st.mtimeMs > DAY) doomed.push({ f, size: st.size, why: "import neterminat" });
  }
  // miniaturi: cache/<lățime>/<cale>.webp are rost doar dacă originalul există
  for (const f of await walk(CACHE)) {
    const inner = rel(f, CACHE).split("/").slice(1).join("/").replace(/\.webp$/, "");
    const st = await stat(f).catch(() => null);
    if (st && !refs.has(inner)) doomed.push({ f, size: st.size, why: "miniatură fără original" });
  }

  const total = doomed.reduce((s, d) => s + d.size, 0);
  const byWhy = {};
  for (const d of doomed) byWhy[d.why] = (byWhy[d.why] ?? 0) + 1;
  console.log(`Fișiere de curățat: ${doomed.length} (${mb(total)})${doomed.length ? " — " + Object.entries(byWhy).map(([k, v]) => `${v} × ${k}`).join(", ") : ""}.`);
  if (!doomed.length) return;
  if (!apply) { for (const d of doomed.slice(0, 20)) console.log("  ", path.relative(base, d.f), `(${d.why})`); if (doomed.length > 20) console.log(`   … și încă ${doomed.length - 20}`); console.log("Rulează cu --apply ca să le ștergi."); return; }
  let n = 0;
  for (const d of doomed) { await unlink(d.f).then(() => n++).catch(() => {}); }
  for (const r of [PUB, PRIV, CACHE]) await pruneEmpty(r, true);
  console.log(`Șterse: ${n} fișiere, ${mb(total)} eliberați.`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
