import "server-only";
import { randomBytes } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { env } from "./env";
import { THUMB_WIDTHS } from "./files-url";

/**
 * Stocarea fișierelor pe discul serverului (fără servicii externe).
 *
 *   UPLOAD_DIR/public/sarcini/<cod>-<proiect>/<token>-<nume>   atașamentele sarcinilor, un folder pe proiect (fără proiect: sarcini/fara-proiect)
 *   UPLOAD_DIR/public/cereri/<cod>-<proiect>/<token>-<nume>    atașamentele cererilor (tichete), la fel
 *   UPLOAD_DIR/public/contoare/<AAAA-LL>/<token>-<nume>        pozele citirilor de contoare (un folder pe lună)
 *     → servite la /files/<folder>/<token>-<nume> (adresa nu poate fi ghicită)
 *   UPLOAD_DIR/private/importuri/<token>-<nume>             exporturile 1C în curs de import — NU se servesc niciodată
 *   UPLOAD_DIR/cache/<lățime>/<cale>.webp                   miniaturi generate la cerere (se pot șterge oricând; se refac singure)
 *
 * UPLOAD_DIR implicit: ./storage lângă aplicație. Pune-l pe un disc cu backup (vezi docs/SERVER-PROPRIU.md, secțiunea 7).
 */

export const FILES_PREFIX = "/files/";

const root = () => path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), "storage"));
export const publicRoot = () => path.join(root(), "public");
const privateRoot = () => path.join(root(), "private");
export const cacheRoot = () => path.join(root(), "cache");

/** Creează folderele de bază (dacă lipsesc), ca să existe pe disc încă de la pornire; subfolderele (pe sarcină / cerere / lună) se creează singure la prima încărcare. */
export async function ensureStorageDirs(): Promise<void> {
  await Promise.all([
    ...["sarcini", "cereri", "contoare"].map((d) => fs.mkdir(path.join(publicRoot(), d), { recursive: true })),
    fs.mkdir(path.join(privateRoot(), "importuri"), { recursive: true }),
  ]);
}

/** Folderul de bază al atașamentelor unui task: cererile (tichetele) au folderul lor, separat de sarcini. Subfolderul pe proiect: vezi services/file-folders.ts. */
export const kindDir = (type: string) => (type === "TICKET" ? "cereri" : "sarcini");
/** Folderul pozelor de contoare pentru o lună (AAAA-LL). */
export const meterFolder = (period: string) => `contoare/${period}`;

const safeName = (n: string) =>
  n.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").replace(/^[._]+/, "").slice(-80) || "fisier";
const safeFolder = (f: string) => f.split(/[\\/]+/).map((s) => safeName(s).replace(/\.+/g, "_")).filter(Boolean).join("/") || "misc";

/** Calea de pe disc pentru o cale relativă; null dacă iese din rădăcină (../, caractere ciudate). */
function within(base: string, rel: string): string | null {
  if (!rel || rel.includes("\0") || rel.includes("\\")) return null;
  const abs = path.resolve(base, rel);
  return abs.startsWith(base + path.sep) ? abs : null;
}

async function write(abs: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${randomBytes(4).toString("hex")}.part`;
  try {
    await fs.writeFile(tmp, data);
    await fs.rename(tmp, abs);
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    throw e;
  }
}

const bytesOf = async (data: File | Buffer): Promise<Buffer> => (Buffer.isBuffer(data) ? data : Buffer.from(await data.arrayBuffer()));
const newRel = (folder: string, name: string) => `${safeFolder(folder)}/${randomBytes(12).toString("hex")}-${safeName(name)}`;

/** Salvează un fișier public; întoarce adresa lui (`/files/...`). */
export async function storePublic(folder: string, data: File | Buffer, name?: string): Promise<{ url: string; size: number }> {
  const buf = await bytesOf(data);
  const rel = newRel(folder, name ?? (data instanceof File ? data.name : "fisier"));
  const abs = within(publicRoot(), rel);
  if (!abs) throw new Error("Cale de stocare invalidă.");
  await write(abs, buf);
  return { url: FILES_PREFIX + rel.split("/").map(encodeURIComponent).join("/"), size: buf.length };
}

/** Salvează un fișier privat; întoarce un identificator (nu o adresă). */
export async function storePrivate(folder: string, data: File | Buffer, name?: string): Promise<{ id: string; size: number }> {
  const buf = await bytesOf(data);
  const rel = newRel(folder, name ?? (data instanceof File ? data.name : "fisier"));
  const abs = within(privateRoot(), rel);
  if (!abs) throw new Error("Cale de stocare invalidă.");
  await write(abs, buf);
  return { id: rel, size: buf.length };
}

const PRIVATE_ID = /^[\w-]+(\/[\w-]+)*\/[0-9a-f]{24}-[\w.-]+$/;

export async function readPrivate(id: string, folder?: string): Promise<Buffer | null> {
  if (!PRIVATE_ID.test(id) || (folder && !id.startsWith(safeFolder(folder) + "/"))) return null;
  const abs = within(privateRoot(), id);
  return abs ? fs.readFile(abs).catch(() => null) : null;
}

export async function deletePrivate(id: string): Promise<void> {
  if (!PRIVATE_ID.test(id)) return;
  const abs = within(privateRoot(), id);
  if (abs) await fs.unlink(abs).catch(() => {});
}

/** Calea de pe disc a unui fișier public după partea din URL de după `/files/` (deja decodată pe segmente). */
export function publicPath(segments: string[]): string | null {
  if (!segments.length || segments.some((s) => !s || s === "." || s === "..")) return null;
  return within(publicRoot(), segments.join("/"));
}

/** Cale de pe disc pentru adresa unui fișier public (`/files/...`); null pentru orice altceva (inclusiv linkuri vechi Vercel Blob). */
export function pathOfUrl(url: string): string | null {
  if (!url.startsWith(FILES_PREFIX)) return null;
  try {
    return publicPath(url.slice(FILES_PREFIX.length).split("?")[0].split("/").map(decodeURIComponent));
  } catch {
    return null;
  }
}

/** Șterge un fișier public după adresa lui. Linkurile externe (Vercel Blob vechi) se ignoră — se curăță prin scriptul de migrare. */
export async function deleteStored(url: string | null | undefined): Promise<void> {
  const abs = url ? pathOfUrl(url) : null;
  if (!abs) return;
  await fs.unlink(abs).catch(() => {});
  const rel = path.relative(publicRoot(), abs);
  await pruneEmptyDirs(path.dirname(abs), publicRoot(), 1);
  await Promise.all(
    THUMB_WIDTHS.map(async (w) => {
      const thumb = path.join(cacheRoot(), String(w), rel + ".webp");
      await fs.unlink(thumb).catch(() => {});
      await pruneEmptyDirs(path.dirname(thumb), path.join(cacheRoot(), String(w)), 1);
    }),
  );
}

/** Un folder de proiect / lună fără niciun fișier nu are rost: după o ștergere, folderele rămase goale se scot, până la folderul tipului (sarcini / cereri / contoare), care rămâne. */
async function pruneEmptyDirs(dir: string, root: string, keepLevels: number): Promise<void> {
  let cur = dir;
  while (cur.startsWith(root + path.sep) && path.relative(root, cur).split(path.sep).length > keepLevels) {
    try {
      await fs.rmdir(cur); // eșuează dacă nu e gol
    } catch {
      return;
    }
    cur = path.dirname(cur);
  }
}

/** Calea unei miniaturi în cache, pentru un fișier public (cale absolută) și o lățime. */
export const thumbFile = (abs: string, width: number): string => path.join(cacheRoot(), String(width), path.relative(publicRoot(), abs) + ".webp");

/** Scrie un fișier în cache (atomic). */
export async function writeCache(abs: string, data: Buffer): Promise<void> {
  await write(abs, data);
}

/**
 * Salvează în stocarea privată direct din fluxul cererii, fără să țină fișierul în memorie (exporturile 1C au zeci de MB).
 * Întrerupe și șterge ce a scris dacă depășește maxBytes.
 */
export async function storePrivateStream(folder: string, body: ReadableStream<Uint8Array>, name: string, maxBytes: number): Promise<{ id: string; size: number } | "too-big"> {
  const rel = newRel(folder, name);
  const abs = within(privateRoot(), rel);
  if (!abs) throw new Error("Cale de stocare invalidă.");
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${randomBytes(4).toString("hex")}.part`;
  let size = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > maxBytes) cb(new Error("TOO_BIG"));
      else cb(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(body as unknown as import("node:stream/web").ReadableStream), limit, createWriteStream(tmp));
    await fs.rename(tmp, abs);
    return { id: rel, size };
  } catch (e) {
    await fs.unlink(tmp).catch(() => {});
    if (e instanceof Error && e.message === "TOO_BIG") return "too-big";
    throw e;
  }
}

/** Adresa completă (pentru servicii care o descarcă singure, de ex. Telegram). */
export const absoluteUrl = (url: string): string => (url.startsWith("/") ? env.appUrl.replace(/\/$/, "") + url : url);

/** Octeții unui fișier public (pentru trimitere ca atașament). */
export async function readStored(url: string): Promise<Buffer | null> {
  const abs = pathOfUrl(url);
  return abs ? fs.readFile(abs).catch(() => null) : null;
}
