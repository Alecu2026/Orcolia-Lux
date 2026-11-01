import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { getApaCanalConsumptionHistory, getInvoiceTaskTitles, type getInvoiceByToken } from "../queries/invoices";
import { getCompanySettings } from "../queries/company";
import { withPdfPage } from "../pdf-browser";
import { withPdfSlot } from "../pdf-limiter";
import { selfBaseUrl } from "../self-url";
import { cacheRoot } from "../storage";

/**
 * PDF-ul facturii publice. Trei straturi, ca un val de descărcări să nu pornească sute de browsere:
 *  1. CACHE pe disc: cheia = amprenta tuturor datelor din care se desenează factura (factura cu liniile ei, datele companiei și șablonul, istoricul de consum / sarcinile), plus versiunea
 *     aplicației — orice modificare sau o versiune nouă dă altă cheie, deci nu se servește niciodată un PDF vechi. A doua descărcare a aceleiași facturi e instantanee.
 *  2. O singură generare pentru cererile identice simultane (un email cu același link deschis de mulți).
 *  3. Generarea propriu-zisă: coadă cu cel mult `PDF_CONCURRENCY` deodată (vezi lib/pdf-limiter.ts), într-un Chromium comun (vezi lib/pdf-browser.ts).
 * Cache-ul are plafon de spațiu (`PDF_CACHE_MAX_MB`, implicit 2048): cele mai vechi fișiere se șterg când e depășit.
 */
const RENDER_VERSION = 1; // se mărește când se schimbă cum se generează PDF-ul și nu se schimbă codul paginii
const CACHE_MAX_BYTES = (Number(process.env.PDF_CACHE_MAX_MB) > 0 ? Number(process.env.PDF_CACHE_MAX_MB) : 2048) * 1024 * 1024;
const PRUNE_EVERY_MS = 10 * 60_000;

let buildId: string | null = null;
function appVersion(): string {
  if (buildId) return buildId;
  try {
    buildId = readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    buildId = "dev";
  }
  return buildId;
}

type Invoice = NonNullable<Awaited<ReturnType<typeof getInvoiceByToken>>>;

const g = globalThis as unknown as { __invoicePdf?: { flights: Map<string, Promise<Buffer>>; lastPrune: number } };
const S = (g.__invoicePdf ??= { flights: new Map(), lastPrune: 0 });

const fileOf = (key: string) => path.join(cacheRoot(), "invoice-pdf", key.slice(0, 2), `${key}.pdf`);

async function cacheKey(invoice: Invoice): Promise<string> {
  // datele companiei și istoricul / sarcinile se citesc odată, în paralel
  const [company, extra] = await Promise.all([
    getCompanySettings(),
    invoice.kind === "APA_CANAL"
      ? invoice.clientId
        ? getApaCanalConsumptionHistory(invoice.clientId, 6, invoice.issueDate)
        : Promise.resolve([])
      : getInvoiceTaskTitles(invoice.taskIds ?? []),
  ]);
  return createHash("sha256").update(JSON.stringify([RENDER_VERSION, appVersion(), invoice, company, extra])).digest("hex").slice(0, 40);
}

async function render(token: string, landscape: boolean, requestUrl: string): Promise<Buffer> {
  const url = `${await selfBaseUrl(requestUrl)}/invoice/public/${token}`;
  return withPdfSlot(() =>
    withPdfPage(async (page) => {
      const res = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
      if (!res || res.status() !== 200) throw new Error(`Pagina facturii a răspuns ${res?.status() ?? "fără răspuns"}.`);
      // evenimentul „load” vine când e gata doar scheletul (loading.tsx); conținutul facturii sosește apoi, în același flux: așteptăm să dispară scheletul și să apară textul — altfel PDF-ul ar ieși gol
      await page.waitForFunction(() => document.querySelectorAll(".animate-pulse").length === 0 && document.body.innerText.length > 100, null, { timeout: 20_000 });
      // fonturi, imagini (sigla) și hidratarea componentelor: așteptăm ce așteaptă și tipărirea din browser
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images].map((i) =>
            i.complete
              ? null
              : new Promise((r) => {
                  i.onload = i.onerror = r;
                }),
          ),
        );
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      });
      const pdf = await page.pdf({ format: "A4", landscape, preferCSSPageSize: true, printBackground: true });
      return Buffer.from(pdf);
    }),
  );
}

async function prune(): Promise<void> {
  const dir = path.join(cacheRoot(), "invoice-pdf");
  const files: { f: string; size: number; at: number }[] = [];
  try {
    for (const sub of await fs.readdir(dir)) {
      const d = path.join(dir, sub);
      for (const name of await fs.readdir(d).catch(() => [] as string[])) {
        const f = path.join(d, name);
        const st = await fs.stat(f).catch(() => null);
        if (st?.isFile()) files.push({ f, size: st.size, at: st.mtimeMs });
      }
    }
  } catch {
    return;
  }
  let total = files.reduce((s, x) => s + x.size, 0);
  if (total <= CACHE_MAX_BYTES) return;
  files.sort((a, b) => a.at - b.at);
  for (const x of files) {
    if (total <= CACHE_MAX_BYTES * 0.8) break;
    await fs.unlink(x.f).catch(() => {});
    total -= x.size;
  }
}

/** PDF-ul facturii: din cache dacă datele nu s-au schimbat, altfel generat (o singură dată pentru cererile simultane) și salvat. `etag` = cheia (pentru 304 în browser). */
export async function getInvoicePdf(invoice: Invoice, token: string, requestUrl: string, beforeRender?: () => void): Promise<{ pdf: Buffer; etag: string; cached: boolean }> {
  const key = await cacheKey(invoice);
  const file = fileOf(key);
  const hit = await fs.readFile(file).catch(() => null);
  if (hit && hit.length > 0) return { pdf: hit, etag: key, cached: true };

  let job = S.flights.get(key);
  if (!job) {
    beforeRender?.(); // limita pe adresă se aplică doar generărilor noi (poate arunca PdfRateLimitedError)
    job = (async () => {
      const pdf = await render(token, invoice.kind === "APA_CANAL", requestUrl);
      try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
        await fs.writeFile(tmp, pdf);
        await fs.rename(tmp, file); // atomic: un cititor nu vede niciodată un fișier pe jumătate scris
      } catch (e) {
        console.error("[invoice-pdf] nu am putut salva în cache:", String((e as Error)?.message ?? e).slice(0, 160));
      }
      if (Date.now() - S.lastPrune > PRUNE_EVERY_MS) {
        S.lastPrune = Date.now();
        void prune();
      }
      return pdf;
    })().finally(() => {
      S.flights.delete(key);
    });
    S.flights.set(key, job);
  }
  return { pdf: await job, etag: key, cached: false };
}
