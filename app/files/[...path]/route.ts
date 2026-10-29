import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { NextRequest } from "next/server";
import { publicPath, thumbFile, writeCache } from "@/lib/storage";
import { THUMB_WIDTHS } from "@/lib/files-url";
import { withSharp } from "@/lib/services/image-pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Fișierele încărcate (poze, atașamente) de pe discul serverului. Adresa conține un cod aleator, deci nu poate fi ghicită (ca la linkurile publice de stocare). */

// Tipuri afișate direct în browser; orice altceva se descarcă (nu se rulează niciodată HTML / SVG din încărcări).
const INLINE: Record<string, string> = {
  webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", avif: "image/avif",
  heic: "image/heic", heif: "image/heif", pdf: "application/pdf",
};
const THUMBABLE = new Set(["webp", "jpg", "jpeg", "png"]);
const building = new Map<string, Promise<boolean>>();

/** Miniatura (WebP) a unei poze: se face o singură dată, se ține pe disc, iar cererile simultane așteaptă aceeași conversie. Poza deja mai mică decât lățimea cerută se servește ca atare. */
async function ensureThumb(file: string, width: number): Promise<string | null> {
  const out = thumbFile(file, width);
  if (await fs.stat(out).then((s) => s.isFile()).catch(() => false)) return out;
  let job = building.get(out);
  if (!job) {
    job = (async () => {
      try {
        const buf = await withSharp(async (sharp) => {
          const img = sharp(file, { failOn: "none", sequentialRead: true });
          const meta = await img.metadata();
          if (!meta.width || meta.width <= width) return null;
          return img.rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
        });
        if (!buf) return false;
        await writeCache(out, buf);
        return true;
      } catch {
        return false;
      } finally {
        building.delete(out);
      }
    })();
    building.set(out, job);
  }
  return (await job) ? out : null;
}

const headersFor = (name: string, type: string | undefined, size: number, mtime: Date) => {
  const nice = name.replace(/^[0-9a-f]{24}-/, "");
  return new Headers({
    "Content-Type": type ?? "application/octet-stream",
    "Content-Length": String(size),
    "Accept-Ranges": "bytes",
    // numele din adresă nu se schimbă niciodată pentru același conținut
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${type ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(nice)}`,
    ETag: `"${size.toString(16)}-${Math.floor(mtime.getTime() / 1000).toString(16)}"`,
  });
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const segs = (await params).path.map((s) => {
    try { return decodeURIComponent(s); } catch { return ""; }
  });
  const file = publicPath(segs);
  const st = file ? await fs.stat(file).catch(() => null) : null;
  if (!file || !st || !st.isFile()) return new Response("Not found", { status: 404 });

  const base = path.basename(file);
  const ext = base.split(".").pop()?.toLowerCase() ?? "";

  // ?w=160|320|640 → miniatură (doar pentru poze); orice altceva se servește ca atare
  let target = file;
  let size = st.size;
  let mtime = st.mtime;
  let type = INLINE[ext];
  const w = Number(req.nextUrl.searchParams.get("w"));
  if ((THUMB_WIDTHS as readonly number[]).includes(w) && THUMBABLE.has(ext)) {
    const t = await ensureThumb(file, w);
    const ts = t ? await fs.stat(t).catch(() => null) : null;
    if (t && ts) {
      target = t;
      size = ts.size;
      mtime = ts.mtime;
      type = "image/webp";
    }
  }

  const h = headersFor(base, type, size, mtime);
  if (req.headers.get("if-none-match") === h.get("ETag")) return new Response(null, { status: 304, headers: { ETag: h.get("ETag")!, "Cache-Control": h.get("Cache-Control")! } });

  // Range (previzualizare PDF, reluare descărcare)
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end || start >= size) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    start = Math.max(0, start);
    h.set("Content-Range", `bytes ${start}-${end}/${size}`);
    h.set("Content-Length", String(end - start + 1));
    return new Response(Readable.toWeb(createReadStream(target, { start, end })) as unknown as ReadableStream, { status: 206, headers: h });
  }
  return new Response(Readable.toWeb(createReadStream(target)) as unknown as ReadableStream, { headers: h });
}
