import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { getApaCanalConsumptionHistory, getInvoiceTaskTitles, type getInvoiceByToken } from "../queries/invoices";
import { getCompanySettings } from "../queries/company";
import { buildApaCanalInvoicePdf, buildGenericInvoicePdf } from "../pdf/invoice-pdf";
import { cacheRoot } from "../storage";

/**
 * PDF-ul facturii publice. Generat direct pe server (pdfkit, vezi lib/pdf/invoice-pdf.ts), fără Chromium; trei straturi, ca un val de descărcări să nu repete munca:
 *  1. CACHE pe disc: cheia = amprenta tuturor datelor din care se desenează factura (factura cu liniile ei, datele companiei și șablonul, istoricul de consum / sarcinile), plus versiunea
 *     aplicației — orice modificare sau o versiune nouă dă altă cheie, deci nu se servește niciodată un PDF vechi. A doua descărcare a aceleiași facturi e instantanee.
 *  2. O singură generare pentru cererile identice simultane (un email cu același link deschis de mulți).
 *  3. Limită pe adresă pentru PDF-urile noi (în rută).
 * Cache-ul are plafon de spațiu (`PDF_CACHE_MAX_MB`, implicit 2048): cele mai vechi fișiere se șterg când e depășit.
 */
const RENDER_VERSION = 2; // se mărește când se schimbă cum se generează PDF-ul și nu se schimbă codul paginii
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

async function loadParts(invoice: Invoice) {
  // datele companiei și istoricul / sarcinile se citesc odată, în paralel
  const [company, extra] = await Promise.all([
    getCompanySettings(),
    invoice.kind === "APA_CANAL"
      ? invoice.clientId
        ? getApaCanalConsumptionHistory(invoice.clientId, 6, invoice.issueDate)
        : Promise.resolve([])
      : getInvoiceTaskTitles(invoice.taskIds ?? []),
  ]);
  const key = createHash("sha256").update(JSON.stringify([RENDER_VERSION, appVersion(), invoice, company, extra])).digest("hex").slice(0, 40);
  return { key, company, extra };
}

async function render(invoice: Invoice, parts: { company: Awaited<ReturnType<typeof getCompanySettings>>; extra: unknown }): Promise<Buffer> {
  if (invoice.kind === "APA_CANAL") return buildApaCanalInvoicePdf({ invoice, company: parts.company, history: parts.extra as { label: string; value: number }[] });
  return buildGenericInvoicePdf({ invoice, company: parts.company, tasks: parts.extra as { title: string }[] });
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
export async function getInvoicePdf(invoice: Invoice, beforeRender?: () => void): Promise<{ pdf: Buffer; etag: string; cached: boolean }> {
  const parts = await loadParts(invoice);
  const key = parts.key;
  const file = fileOf(key);
  const hit = await fs.readFile(file).catch(() => null);
  if (hit && hit.length > 0) return { pdf: hit, etag: key, cached: true };

  let job = S.flights.get(key);
  if (!job) {
    beforeRender?.(); // limita pe adresă se aplică doar generărilor noi (poate arunca PdfRateLimitedError)
    job = (async () => {
      const pdf = await render(invoice, parts);
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
