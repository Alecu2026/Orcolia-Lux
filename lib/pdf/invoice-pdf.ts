import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { Company } from "../queries/company";
import {
  APA_CANAL_DEFAULT_FONT_MM,
  APA_CANAL_LAYOUT_DEFAULTS,
  APA_CANAL_TEXT_KEYS,
  applyApaCanalVariables,
  sanitizeApaCanalLayout,
  type ApaCanalElementKey,
} from "../apa-canal-layout";
import { buildApaCanalVars, continuationPages, factorOrDash, isApa, niceStep, num2, pageLimits, splitForPages, type ApaCanalInvoiceData, type ConsumPoint, type ContPage, type InvoiceMeter } from "../apa-canal-invoice-vars";
import { fmtDate, money, INVOICE_STATUS, type InvoiceStatusKey } from "../../app/components/invoice-meta";

/**
 * Factura publică ca PDF, desenată DIRECT pe server (pdfkit), fără Chromium: fără browser pornit, fără sute de MB de memorie, în câteva zeci de milisecunde.
 *  - Apă-Canal: A4 pe lat, fiecare element la poziția lui în milimetri (șablonul din editor sau pozițiile implicite măsurate pe factura reală), cu aceleași culori, același grafic, aceleași texte personalizate ({variabile}) și imagini.
 *  - Factură obișnuită: A4 pe înălțime, cu liniile, totalurile și notițele.
 * Fontul e Arimo (compatibil ca dimensiuni cu Arial, deci textul ocupă exact același loc ca în pagina din browser) și acoperă română, rusă și engleză.
 */

const FONT = path.join(process.cwd(), "assets", "fonts", "Arimo-Regular.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "Arimo-Bold.ttf");

const MM = 72 / 25.4;
const mm = (v: number) => v * MM;
const PX = 25.4 / 96; // 1 px CSS în mm

// Paleta exactă a modelului de factură Apă-Canal (aceeași cu pagina din browser).
const BG = "#FCFDFC";
const BLUE = "#86D3EA";
const BAR = "#5B9BD5";
const BAR_BORDER = "#2E75B6";
const CHART_TEXT = "#404040";
const TEXT = "#202C2A";
const BORDER = "#AEB0B0";
const BORDER_LIGHT = "#D9DDDD";
const RED = "#E53935";
const BRAND = "#0d9488";

// Ascent / descent ale fontului (Arimo = metricile Arial) — pentru a aşeza linia de text ca în CSS (jumătate din interlinie deasupra, jumătate dedesubt).
const ASC = 0.905;
const DESC = 0.212;

type Doc = InstanceType<typeof PDFDocument>;
type Align = "left" | "center" | "right";

function newDoc(o: { landscape: boolean; title: string; author: string }) {
  const doc = new PDFDocument({ size: "A4", layout: o.landscape ? "landscape" : "portrait", margins: { top: 0, bottom: 0, left: 0, right: 0 }, bufferPages: true, info: { Title: o.title, Author: o.author } });
  doc.registerFont("R", FONT);
  doc.registerFont("B", FONT_BOLD);
  doc.page.margins.bottom = -100000; // textul desenat la poziții fixe nu trebuie să deschidă niciodată o pagină nouă
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  return { doc, done };
}

const widthMm = (doc: Doc, s: string, size: number, bold = false) => doc.font(bold ? "B" : "R").fontSize(mm(size)).widthOfString(s) / MM;

/** O linie de text; `top` = marginea de sus a casetei liniei (mm), `lh` = interlinia (înmulțitor), ca în CSS. */
function put(doc: Doc, s: string, x: number, top: number, size: number, lh: number, o: { bold?: boolean; color?: string; align?: Align; width?: number } = {}) {
  if (!s) return;
  const w = o.width ?? 0;
  const sw = o.align && o.align !== "left" ? widthMm(doc, s, size, o.bold) : 0;
  const px = o.align === "right" ? x + w - sw : o.align === "center" ? x + (w - sw) / 2 : x;
  const py = top + ((lh - (ASC + DESC)) * size) / 2;
  doc.font(o.bold ? "B" : "R").fontSize(mm(size)).fillColor(o.color ?? TEXT).text(s, mm(px), mm(py), { lineBreak: false });
}

type Run = { t: string; bold?: boolean };
/** Mai multe porțiuni (normal / aldin) pe aceeași linie. */
function putRuns(doc: Doc, runs: Run[], x: number, top: number, size: number, lh: number, o: { color?: string } = {}): number {
  let cx = x;
  for (const r of runs) {
    put(doc, r.t, cx, top, size, lh, { bold: r.bold, color: o.color });
    cx += widthMm(doc, r.t, size, r.bold);
  }
  return cx;
}

/** Împarte textul în linii care încap în `width` (mm). `keepNewlines`: ca `white-space: pre-line` (rândurile noi se păstrează), altfel se comprimă spațiile. */
function wrap(doc: Doc, text: string, width: number, size: number, bold: boolean, keepNewlines: boolean): string[] {
  const out: string[] = [];
  const paragraphs = keepNewlines ? text.split(/\r?\n/) : [text.replace(/\s+/g, " ").trim()];
  for (const p of paragraphs) {
    const words = p.split(" ").filter((w) => w !== "");
    if (words.length === 0) {
      if (keepNewlines) out.push("");
      continue;
    }
    let cur = "";
    for (const word of words) {
      const next = cur ? `${cur} ${word}` : word;
      if (cur && widthMm(doc, next, size, bold) > width) {
        out.push(cur);
        cur = word;
      } else cur = next;
    }
    out.push(cur);
  }
  return out;
}

const rrect = (doc: Doc, x: number, y: number, w: number, h: number, r: number, fill: string) => {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  doc.roundedRect(mm(x), mm(y), mm(w), mm(h), mm(rr)).fill(fill);
};
const rect = (doc: Doc, x: number, y: number, w: number, h: number, fill: string) => {
  doc.rect(mm(x), mm(y), mm(w), mm(h)).fill(fill);
};
const hline = (doc: Doc, x1: number, x2: number, y: number, thick: number, color: string) => {
  rect(doc, x1, y, Math.max(0, x2 - x1), thick, color);
};

/** Imaginea dintr-un data-URL. PNG / JPEG intră direct; alte formate (webp, gif, svg) se convertesc dacă `sharp` e disponibil, altfel se omit. */
async function imageBuffer(dataUrl: string | null | undefined): Promise<Buffer | null> {
  const m = /^data:image\/([a-z0-9.+-]+);base64,(.+)$/is.exec(dataUrl ?? "");
  if (!m) return null;
  const buf = Buffer.from(m[2], "base64");
  if (/^(png|jpe?g)$/i.test(m[1])) return buf;
  try {
    const sharp = (await import("sharp")).default;
    return await sharp(buf).png().toBuffer();
  } catch {
    return null;
  }
}
function drawImage(doc: Doc, buf: Buffer | null, x: number, y: number, w: number, h: number) {
  if (!buf || w <= 0 || h <= 0) return;
  try {
    doc.image(buf, mm(x), mm(y), { fit: [mm(w), mm(h)], align: "center", valign: "center" });
  } catch {
    /* imagine ilizibilă: factura se desenează fără ea */
  }
}

/* ───────────────────────────── Factura Apă-Canal ───────────────────────────── */

type Box = { x: number; y: number; w: number; h: number };

/** Prima linie din „Cont personal”: numărul de cont + (opțional) sectorul. Desenează dacă `draw`; întoarce mereu coordonata unde se termină. */
function contLine1(doc: Doc, invoice: ApaCanalInvoiceData, x: number, top: number, s: number, draw: boolean): number {
  const text = `Cont personal: ${invoice.contPersonal || "—"}`;
  let cx = x + widthMm(doc, text, s, true);
  if (draw) put(doc, text, x, top, s, 1.7, { bold: true, color: "#000000" });
  if (!invoice.sectorNr) return cx;
  cx += 2.117; // ml-2
  const sec = invoice.sectorNr;
  if (/\s/.test(sec.trim())) {
    // categorie descriptivă („Sector privat”, „Agenti economici 1”): text simplu
    if (draw) put(doc, sec, cx, top, s, 1.7, { color: "#000000" });
    return cx + widthMm(doc, sec, s);
  }
  // cod scurt („5sp”): eticheta „sector nr.” într-un chenar, apoi codul
  const ps = 3.1, label = "sector nr.";
  const tw = widthMm(doc, label, ps);
  if (draw) {
    const baseline = top + ((1.7 - (ASC + DESC)) * s) / 2 + ASC * s;
    const boxTop = baseline - ASC * ps, h = (ASC + DESC) * ps;
    const bw = 1.5 * PX;
    doc.roundedRect(mm(cx + bw / 2), mm(boxTop - bw / 2), mm(tw + 2 - bw), mm(h + bw), mm(1.06)).lineWidth(mm(bw)).stroke("#000000");
    put(doc, label, cx + 1, baseline - (ASC + (1.7 - (ASC + DESC)) / 2) * ps, ps, 1.7, { color: "#000000" });
  }
  cx += tw + 2 + widthMm(doc, " ", s);
  if (draw) put(doc, sec, cx, top, s, 1.7, { color: "#000000" });
  return cx + widthMm(doc, sec, s);
}

/** Lățimile coloanelor tabelului contorului (conținutul cel mai lat + 2mm padding pe fiecare parte). */
function meterColumns(doc: Doc, meters: InvoiceMeter[], s: number): number[] {
  const heads = [["Numărul", "contorului"], ["Indicii", "precedenți"], ["Indicii", "actuali"], ["Volum", "estimativ"]];
  const rowVals = (m: InvoiceMeter) => [m.serial || "—", m.prev || "—", m.curr || "—", m.estimated ? "DA" : ""];
  return heads.map((h, i) => Math.max(widthMm(doc, h[0], s), widthMm(doc, h[1], s), ...meters.map((m) => widthMm(doc, rowVals(m)[i], s, true))) + 4);
}

/**
 * Pagină de continuare (A4 pe lat): contoarele sau liniile de servicii care nu au încăput pe prima pagină — aceeași machetă ca în pagina din browser
 * (ApaCanalContinuationPage): antet cu datele facturii, apoi tabelul rămas, cu numărul paginii în colț.
 */
function drawContinuationPage(doc: Doc, invoice: ApaCanalInvoiceData, page: ContPage, pageNo: number, totalPages: number) {
  const L = 8, R = 289, W = R - L;
  put(doc, `Factura ${invoice.number} — continuare`, L, 6, 4, 1.5, { bold: true });
  hline(doc, L, R, 13.2, 1.1, BLUE);
  const who = (invoice.consumerName || invoice.client?.name || "").toUpperCase();
  const info = `Cont personal: ${invoice.contPersonal || "—"}${who ? ` · ${who}` : ""}${invoice.billingPeriodLabel ? ` · Perioada de calcul: ${invoice.billingPeriodLabel.toUpperCase()}` : ""}`;
  put(doc, info, L, 17, 3.2, 1.6, { bold: true, color: "#000000" });
  if (invoice.consumAddress) put(doc, `Adresa locului de consum: ${invoice.consumAddress}`, L, 17 + 3.2 * 1.6, 3.2, 1.6, { color: "#000000" });
  put(doc, page.kind === "meters" ? `Contoare (continuare, de la nr. ${page.from})` : `Servicii (continuare, de la linia ${page.from})`, L, 30, 3.6, 1.5, { bold: true });

  const s = 3.3, rowH = 6.2;
  // la contoarele cu consumator subordonat (ex. o primărie) apare o coloană în plus cu numele lui
  const withLabel = page.kind === "meters" && page.rows.some((x) => x.label);
  const cols = (withLabel ? [12, 0.17, 0.33, 0.16, 0.16, 0.18] : [12, 0.34, 0.2, 0.2, 0.26]).map((v, i) => (i === 0 ? v : v * (W - 12)));
  const xs: number[] = [];
  cols.reduce((x, w) => (xs.push(x), x + w), L);
  const heads = page.kind === "meters" ? ["Nr.", "Numărul contorului", ...(withLabel ? ["Consumator / loc de consum"] : []), "Indicii precedenți", "Indicii actuali", "Volum estimativ"] : ["Nr.", "Denumirea serviciului", "Volumul, m3", "Tariful lei/m3", "Suma calculată"];
  const align: Align[] = page.kind === "meters" ? (withLabel ? ["left", "left", "left", "right", "right", "center"] : ["left", "left", "right", "right", "center"]) : ["left", "left", "right", "right", "right"];
  let y = 38;
  heads.forEach((h, c) => put(doc, h, xs[c] + 2, y + 1, s, 1.5, { color: BORDER, align: align[c], width: cols[c] - 4 }));
  y += 1 + s * 1.5 + 1;
  hline(doc, L, R, y, PX, BLUE);
  y += PX;
  if (page.kind === "meters") {
    page.rows.forEach((m, i) => {
      const cells = [String(page.from + i), m.serial || "—", ...(withLabel ? [m.label || ""] : []), m.prev || "—", m.curr || "—", m.estimated ? "DA" : ""];
      cells.forEach((t, c) => {
        const w = cols[c] - 4;
        // numele consumatorului poate fi lung: se taie ca să nu intre peste coloana următoare
        let txt = t;
        while (txt.length > 3 && widthMm(doc, txt, s, c > 0 && !(withLabel && c === 2)) > w) txt = txt.slice(0, -2);
        put(doc, txt === t ? t : `${txt.trimEnd()}…`, xs[c] + 2, y + 1.2, s, 1.5, { bold: c > 0 && !(withLabel && c === 2), color: TEXT, align: align[c], width: w });
      });
      y += rowH;
      hline(doc, L, R, y - PX, PX, BORDER_LIGHT);
    });
  } else {
    page.rows.forEach((it, i) => {
      const cells = [String(page.from + i), isApa(it.description) ? "Serviciul de alimentare cu apa" : "Serviciul de canalizare", factorOrDash(it.quantity, it.lineTotal), factorOrDash(it.unitPrice, it.lineTotal), num2(it.lineTotal)];
      cells.forEach((t, c) => put(doc, t, xs[c] + 2, y + 1.2, s, 1.5, { color: TEXT, align: align[c], width: cols[c] - 4 }));
      y += rowH;
      hline(doc, L, R, y - PX, PX, BORDER_LIGHT);
    });
  }
  put(doc, `Pagina ${pageNo} din ${totalPages}`, L, 203.6, 2.8, 1.5, { color: CHART_TEXT, align: "right", width: W });
}

const TABLE_BASELINE_ROWS = 2;
const TABLE_ROW_HEIGHT_MM = 6.2;
const SAFE_PAGE_BOTTOM_MM = 200;

export async function buildApaCanalInvoicePdf(o: { invoice: ApaCanalInvoiceData; company: Company; history: ConsumPoint[] }): Promise<Buffer> {
  const { invoice, company } = o;
  const layout = company.apaCanalLayout ? sanitizeApaCanalLayout(company.apaCanalLayout) : null;
  const custom = !!layout && Object.keys(layout).length > 0;
  const vars = buildApaCanalVars(invoice, company);
  const points: ConsumPoint[] = o.history.length ? o.history : Array.isArray(invoice.monthlyConsumption) ? (invoice.monthlyConsumption as ConsumPoint[]) : [];
  // Contoare și linii de servicii: pe prima pagină cel mult limitele din șablon (implicit 6 + 6), restul pe pagini de continuare (ca în pagina din browser).
  const limits = pageLimits(layout?.limits);
  const sp = splitForPages(invoice, limits);
  const contPages = continuationPages(sp, limits);
  const totalPages = 1 + contPages.length;
  const rows = sp.services;

  const { doc, done } = newDoc({ landscape: true, title: `Factura ${invoice.number}`, author: company.apaCanalCompanyLine || company.companyName || "Apă-Canal" });
  const [logoBuf, ...imgBufs] = await Promise.all([imageBuffer(company.apaCanalLogo), ...(layout?.customImages ?? []).map((i) => imageBuffer(i.dataUrl))]);

  // Tabelul de servicii crește cu fiecare linie în plus; ce e sub el coboară cu atât (plafonat la marginea de jos a paginii).
  const overflow = Math.max(0, rows.length + (sp.servicesRest.length ? 1 : 0) - TABLE_BASELINE_ROWS) * TABLE_ROW_HEIGHT_MM;
  const SHIFTED: ApaCanalElementKey[] = ["recalculariText", "totalsConnectorLine", "totalsBox", "atentieBox"];
  // Fără șablon, coloana din mijloc (cont personal + tabelul contorului) are lățimea conținutului ei, lipită de coloana din dreapta; graficul ocupă restul din stânga.
  const COL3_X = APA_CANAL_LAYOUT_DEFAULTS.logo.xMm, COL_GAP = 5;
  const flowX2 = (() => {
    if (custom) return 0;
    const cs = APA_CANAL_DEFAULT_FONT_MM.contPersonalBlock ?? 3.6;
    const w = Math.max(
      contLine1(doc, invoice, 0, 0, cs, false) - 0,
      widthMm(doc, "Adresa locului de consum:", cs, true),
      widthMm(doc, invoice.consumAddress || "—", cs, true),
      widthMm(doc, (invoice.consumerName || invoice.client?.name || "").toUpperCase(), cs, true),
      meterColumns(doc, sp.meters, APA_CANAL_DEFAULT_FONT_MM.meterTable ?? 3.6).reduce((a, v) => a + v, 0),
    );
    return Math.max(60, COL3_X - COL_GAP - w);
  })();
  // Fără șablon, sigla ia toată lățimea coloanei din dreapta (înălțimea după proporții, cel mult 40mm); un rând de sus mai înalt coboară tot ce urmează.
  const logoBase = APA_CANAL_LAYOUT_DEFAULTS.logo;
  const flowLogoH = (() => {
    if (custom || !logoBuf) return 0;
    try {
      const im = (doc as unknown as { openImage(src: Buffer): { width: number; height: number } }).openImage(logoBuf);
      return Math.min(40, (logoBase.widthMm * im.height) / im.width);
    } catch {
      return 0;
    }
  })();
  const flowDy = custom ? 0 : Math.max(0, Math.max(2.5 + 10.2, 2.5 + 4 * 3.6 * 1.7, flowLogoH) - (2.5 + 4 * 3.6 * 1.7));
  const ABOVE_ROW2: ApaCanalElementKey[] = ["title", "titleLine", "datesBlock", "contPersonalBlock", "logo"];
  const box = (key: ApaCanalElementKey): Box => {
    const ov = layout?.[key];
    const base = APA_CANAL_LAYOUT_DEFAULTS[key];
    let x = ov?.xMm ?? base.xMm, w = ov?.widthMm ?? base.widthMm;
    let h = ov?.heightMm ?? base.heightMm;
    let y = ov?.yMm ?? base.yMm;
    if (!custom) {
      if (key === "contPersonalBlock" || key === "meterTable") x = flowX2;
      if (key === "chart") w = flowX2 - COL_GAP - 5;
      if (key === "logo" && flowLogoH) h = flowLogoH;
      if (!ABOVE_ROW2.includes(key)) y += flowDy;
    }
    if (overflow > 0 && SHIFTED.includes(key)) y += custom ? Math.min(overflow, Math.max(0, SAFE_PAGE_BOTTOM_MM - h - y)) : overflow;
    return { x, y, w, h };
  };
  const sizeOf = (key: ApaCanalElementKey, def: number) => layout?.[key]?.fontSizeMm ?? def;
  const boldOf = (key: ApaCanalElementKey) => !!layout?.[key]?.bold;

  /** „Text personalizat”: înlocuiește conținutul elementului (cu aceleași casete colorate ca la conținutul normal). */
  const drawOverride = (key: ApaCanalElementKey, b: Box): boolean => {
    const text = layout?.[key]?.textOverride;
    if (!text || !APA_CANAL_TEXT_KEYS.includes(key)) return false;
    const boxStyle: Partial<Record<ApaCanalElementKey, { r: number; px: number; py: number; center?: boolean }>> = {
      totalsBox: { r: 3, px: 3, py: 2 },
      atentieBox: { r: 3.5, px: 3.5, py: 2.5 },
      anuntBox: { r: 7, px: 3.5, py: 2.5, center: true },
    };
    const st = boxStyle[key];
    const size = sizeOf(key, APA_CANAL_DEFAULT_FONT_MM[key] ?? 3);
    const bold = boldOf(key);
    doc.save();
    doc.rect(mm(b.x), mm(b.y), mm(b.w), mm(b.h)).clip();
    if (st) rrect(doc, b.x, b.y, b.w, b.h, st.r, BLUE);
    const padX = st?.px ?? 0, padY = st?.py ?? 0;
    let top = b.y + padY;
    const lines = applyApaCanalVariables(text, vars).split("\n");
    for (const line of lines) {
      const parts = line === "" ? [""] : wrap(doc, line, b.w - padX * 2, size, bold, false);
      for (const p of parts) {
        put(doc, p, b.x + padX, top, size, 1.4, { bold, color: TEXT, align: st?.center ? "center" : "left", width: b.w - padX * 2 });
        top += size * 1.4;
      }
    }
    doc.restore();
    return true;
  };

  // ── Titlu + linia de sub titlu ──
  {
    const b = box("title");
    if (!drawOverride("title", b)) put(doc, "Factura pentru serviciul de alimentare cu apă și de canalizare", b.x, b.y, sizeOf("title", 4), 1.5, { bold: true });
    const l = box("titleLine");
    hline(doc, l.x, l.x + l.w, l.y + (l.h - 1.1) / 2, 1.1, BLUE);
  }

  // ── Data emiterii / data limită ──
  {
    const b = box("datesBlock");
    if (!drawOverride("datesBlock", b)) {
      const s = sizeOf("datesBlock", 3), bold = boldOf("datesBlock");
      putRuns(doc, [{ t: "Data emiterii: ", bold }, { t: fmtDate(invoice.issueDate), bold: true }], b.x, b.y, s, 1.7);
      putRuns(doc, [{ t: "Data limită de achitare: ", bold }, { t: fmtDate(invoice.dueDate), bold: true }], b.x, b.y + s * 1.7, s, 1.7);
    }
  }

  // ── Cont personal / adresă / consumator ──
  {
    const b = box("contPersonalBlock");
    if (!drawOverride("contPersonalBlock", b)) {
      const s = sizeOf("contPersonalBlock", 3.6), step = s * 1.7;
      contLine1(doc, invoice, b.x, b.y, s, true);
      putRuns(doc, [{ t: "Adresa locului de consum:", bold: true }], b.x, b.y + step, s, 1.7, { color: "#000000" });
      putRuns(doc, [{ t: invoice.consumAddress || "—", bold: true }], b.x, b.y + step * 2, s, 1.7, { color: "#000000" });
      putRuns(doc, [{ t: (invoice.consumerName || invoice.client?.name || "").toUpperCase(), bold: true }], b.x, b.y + step * 3, s, 1.7, { color: "#000000" });
    }
  }

  // ── Siglă ──
  {
    const b = box("logo");
    drawImage(doc, logoBuf, b.x, b.y, b.w, b.h);
  }

  // ── Graficul de consum ──
  if (points.length > 0) {
    const b = box("chart");
    const LABEL_H = 2.6 * 1.5;
    const chartH = custom ? Math.max(5, b.h - LABEL_H) : 44;
    const BW = PX, PAD = 1.5;
    const maxVal = Math.max(...points.map((p) => p.value), 5);
    const step = niceStep(maxVal / 8);
    const yMax = Math.ceil(maxVal / step) * step;
    const ySteps: number[] = [];
    for (let v = yMax; v >= 0; v -= step) ySteps.push(Math.round(v * 100) / 100);

    rect(doc, b.x, b.y, b.w, chartH, BORDER);
    rect(doc, b.x + BW, b.y + BW, b.w - 2 * BW, chartH - 2 * BW, BG);
    const innerX = b.x + BW + PAD, innerY = b.y + BW + PAD, innerH = chartH - 2 * (BW + PAD);
    const yw = Math.max(...ySteps.map((s) => widthMm(doc, String(s), 2.6)));
    const plotX = innerX + yw + 1.5, plotR = b.x + b.w - BW - PAD, plotW = plotR - plotX;
    ySteps.forEach((s, i) => {
      const top = innerY + (ySteps.length > 1 ? (i * (innerH - 2.6)) / (ySteps.length - 1) : 0);
      put(doc, String(s), innerX, top, 2.6, 1, { color: CHART_TEXT, align: "right", width: yw });
      hline(doc, plotX, plotR, innerY + innerH * (1 - s / yMax) - 0.5 * PX, 0.5 * PX, BORDER_LIGHT);
    });
    const n = points.length, gap = 0.8;
    const slotW = (plotW - gap * (n - 1)) / n;
    const barW = Math.min(slotW, Math.min(20, 84 / n));
    points.forEach((p, i) => {
      if (p.value < 0) return; // o corecție negativă nu se desenează ca bară
      const h = Math.max(0.01 * innerH, (p.value / yMax) * innerH);
      const x = plotX + i * (slotW + gap) + (slotW - barW) / 2;
      doc.rect(mm(x), mm(innerY + innerH - h), mm(barW), mm(h)).fillAndStroke(BAR, BAR_BORDER);
    });
    // etichetele lunilor: sub grafic, începând după coloana de 7mm + 1.5mm (ca în pagina din browser)
    const lx = b.x + 7 + 1.5, lw = b.x + b.w - lx, lslot = (lw - gap * (n - 1)) / n;
    points.forEach((p, i) => put(doc, p.label, lx + i * (lslot + gap), b.y + chartH, 2.6, 1.5, { color: CHART_TEXT, align: "center", width: lslot }));
  }

  // ── Tabelul contorului ──
  {
    const b = box("meterTable");
    if (!drawOverride("meterTable", b)) {
      const s = sizeOf("meterTable", 3.6), bold = boldOf("meterTable");
      const heads = [["Numărul", "contorului"], ["Indicii", "precedenți"], ["Indicii", "actuali"], ["Volum", "estimativ"]];
      let x = b.x;
      const cws = meterColumns(doc, sp.meters, s);
      const rowStep = s * 1.3;
      heads.forEach((h, i) => {
        const cw = cws[i];
        put(doc, h[0], x, b.y, s, 1.5, { color: BORDER, align: "center", width: cw });
        put(doc, h[1], x, b.y + s * 1.5, s, 1.5, { color: BORDER, align: "center", width: cw });
        // un rând per contor (din 1C pot fi zeci): ce nu încape pe prima pagină continuă pe paginile următoare
        sp.meters.forEach((mt, r) => {
          const val = [mt.serial || "—", mt.prev || "—", mt.curr || "—", mt.estimated ? "DA" : ""][i];
          put(doc, val, x, b.y + s * 3 + 1 + r * rowStep, s, 1.5, { bold: true, color: TEXT, align: "center", width: cw });
        });
        x += cw;
      });
      if (sp.metersRest.length > 0) {
        const tw = cws.reduce((a, v) => a + v, 0);
        put(doc, `… încă ${sp.metersRest.length} ${sp.metersRest.length === 1 ? "contor" : "contoare"} — pagina 2 (din ${sp.metersTotal})`, b.x, b.y + s * 3 + 1 + sp.meters.length * rowStep + 0.4, 2.8, 1.5, { color: CHART_TEXT, align: "center", width: tw });
      }
    }
  }

  // ── Datele companiei ──
  {
    const b = box("companyInfoText");
    if (!drawOverride("companyInfoText", b)) {
      const s = sizeOf("companyInfoText", 4), ob = boldOf("companyInfoText");
      let top = b.y;
      const lines: { t: string; bold: boolean }[] = [
        { t: company.apaCanalAddress, bold: ob },
        { t: company.apaCanalEmail, bold: ob },
        { t: company.apaCanalCompanyLine, bold: true },
        { t: company.apaCanalCodFiscal, bold: ob },
      ];
      for (const ln of lines) {
        for (const part of wrap(doc, ln.t ?? "", b.w, s, ln.bold, false)) {
          put(doc, part, b.x, top, s, 1.15, { bold: ln.bold, color: TEXT, align: "center", width: b.w });
          top += s * 1.15;
        }
      }
    }
  }

  // ── Perioada de calcul ──
  if (invoice.billingPeriodLabel) {
    const b = box("billingPeriodText");
    if (!drawOverride("billingPeriodText", b)) put(doc, `Perioada de calcul: ${invoice.billingPeriodLabel.toUpperCase()}`, b.x, b.y, sizeOf("billingPeriodText", 3), 1.5, { bold: true });
  }

  // ── Tabelul de servicii ──
  {
    const b = box("servicesTable");
    if (!drawOverride("servicesTable", b)) {
      const s = sizeOf("servicesTable", 2.9), ob = boldOf("servicesTable");
      const lineH = s * 1.5;
      const heads = ["Denumirea serviciului", "Volumul,m3", "Tariful lei/m3", "Suma calculata"];
      const body = rows.map((it) => [isApa(it.description) ? "Serviciul de alimentare cu apa" : "Serviciul de canalizare", factorOrDash(it.quantity, it.lineTotal), factorOrDash(it.unitPrice, it.lineTotal), num2(it.lineTotal)]);
      // lățimea maximă a conținutului fiecărei coloane (antetul celor numerice are 14mm padding în stânga); restul lățimii se împarte proporțional, ca la un tabel din browser
      const maxc = heads.map((h, c) => Math.max(widthMm(doc, h, s) + (c === 0 ? 0 : 14), ...body.map((r) => widthMm(doc, r[c], s, ob))));
      const sum = maxc.reduce((a, v) => a + v, 0);
      const extra = Math.max(0, b.w - sum);
      const cw = maxc.map((v) => v + (extra * v) / sum);
      const xs: number[] = [];
      cw.reduce((x, w) => (xs.push(x), x + w), b.x);
      const cell = (c: number, t: string, top: number, color: string, bold = false) => {
        if (c === 0) put(doc, t, xs[0], top, s, 1.5, { color, bold });
        else put(doc, t, xs[c], top, s, 1.5, { color, bold, align: "right", width: cw[c] });
      };
      let y = b.y;
      heads.forEach((h, c) => cell(c, h, y + 0.6, BORDER));
      y += 0.6 + lineH + 0.6;
      hline(doc, b.x, b.x + b.w, y, PX, BLUE);
      y += PX;
      if (rows.length === 0) {
        put(doc, "Fără consum înregistrat în această perioadă — nimic de facturat.", b.x, y + 1.5, s, 1.5, { color: CHART_TEXT, align: "center", width: b.w });
      } else {
        body.forEach((r, i) => {
          r.forEach((t, c) => cell(c, t, y + 0.8, TEXT, ob));
          y += 0.8 + lineH + 0.8;
          if (i < body.length - 1 || sp.servicesRest.length > 0) {
            hline(doc, b.x, b.x + b.w, y, PX, BORDER_LIGHT);
            y += PX;
          }
        });
        if (sp.servicesRest.length > 0) {
          const pg = 1 + contPages.findIndex((p) => p.kind === "services") + 1;
          put(doc, `… încă ${sp.servicesRest.length} ${sp.servicesRest.length === 1 ? "linie" : "linii"} de servicii — vezi pagina ${pg} (din ${sp.servicesTotal})`, b.x, y + 0.8, s, 1.5, { color: CHART_TEXT, align: "center", width: b.w });
        }
      }
    }
  }

  // ── Recalculări / Penalitate + linia până la caseta de total ──
  {
    const b = box("recalculariText"), c = box("totalsConnectorLine"), t = box("totalsBox");
    if (!drawOverride("recalculariText", b)) {
      const s = sizeOf("recalculariText", 2.9), bold = boldOf("recalculariText");
      const l1 = `Recalculări:${invoice.recalculari ? ` ${num2(invoice.recalculari)}` : ""}`;
      const l2 = `Penalitate:${invoice.penalitati ? ` ${num2(invoice.penalitati)}` : ""}`;
      put(doc, l1, b.x, b.y + 2, s, 1.3, { bold });
      put(doc, l2, b.x, b.y + 2 + s * 1.3, s, 1.3, { bold });
      if (!custom) {
        // fără șablon: sub text e o linie albastră care continuă până la caseta de total
        const lineY = b.y + 2 + s * 2.6 + 0.6;
        const textW = Math.max(widthMm(doc, l1, s, bold), widthMm(doc, l2, s, bold));
        hline(doc, b.x, b.x + textW, lineY, 2.8 * PX, BLUE);
        hline(doc, b.x + textW, t.x - 3, lineY, 2.8 * PX, BLUE);
      }
    }
    if (custom) hline(doc, c.x, c.x + c.w, c.y + (c.h - 2.8 * PX) / 2, 2.8 * PX, BLUE);
  }

  // ── Caseta cu totaluri ──
  {
    const b = box("totalsBox");
    if (!drawOverride("totalsBox", b)) {
      const s = sizeOf("totalsBox", 2.9), bold = boldOf("totalsBox");
      rrect(doc, b.x, b.y, b.w, b.h, 3, BLUE);
      const ix = b.x + 3, iw = b.w - 6;
      let top = b.y + 2;
      const row = (l: string, v: string) => {
        put(doc, l, ix, top, s, 1.5, { bold });
        put(doc, v, ix, top, s, 1.5, { bold, align: "right", width: iw });
        top += s * 1.5;
      };
      row("Suma calculată", num2(invoice.subtotal));
      row("Datorii(+)/avans(-)", num2(invoice.datoriiAvans));
      top += 1;
      hline(doc, ix, ix + iw, top, PX, TEXT);
      top += PX + 1;
      put(doc, "Suma spre plată :", ix, top, 3.6, 1.5, { bold: true });
      put(doc, num2(invoice.grandTotal), ix, top, 3.6, 1.5, { bold: true, align: "right", width: iw });
    }
  }

  // ── ATENȚIE ──
  {
    const b = box("atentieBox");
    if (!drawOverride("atentieBox", b)) {
      const s = sizeOf("atentieBox", 2.8), bold = boldOf("atentieBox");
      const lines = wrap(doc, company.apaCanalAtentieText ?? "", b.w - 7, s, bold, false);
      const need = 2.5 + 6 + 1 + lines.length * s * 1.5 + 2.5;
      rrect(doc, b.x, b.y, b.w, custom ? b.h : Math.max(b.h, need), 3.5, BLUE);
      put(doc, "ATENȚIE !", b.x + 3.5, b.y + 2.5, 4, 1.5, { bold: true, color: RED });
      lines.forEach((l, i) => put(doc, l, b.x + 3.5, b.y + 2.5 + 6 + 1 + i * s * 1.5, s, 1.5, { bold, color: TEXT }));
    }
  }

  // ── Anunț + Contacte ──
  {
    const b = box("anuntBox");
    let anuntBottom = b.y + b.h;
    if (!drawOverride("anuntBox", b)) {
      const s = sizeOf("anuntBox", 2.7), bold = boldOf("anuntBox");
      const lines = wrap(doc, company.apaCanalAnuntText ?? "", b.w - 7, s, bold, false);
      const need = 2.5 + 6 + 1 + lines.length * s * 1.4 + 2.5;
      const h = custom ? b.h : Math.max(b.h, need);
      anuntBottom = b.y + h;
      rrect(doc, b.x, b.y, b.w, h, 7, BLUE);
      put(doc, "Anunț !", b.x + 3.5, b.y + 2.5, 4, 1.5, { bold: true, color: RED, align: "center", width: b.w - 7 });
      lines.forEach((l, i) => put(doc, l, b.x + 3.5, b.y + 2.5 + 6 + 1 + i * s * 1.4, s, 1.4, { bold, color: TEXT, align: "center", width: b.w - 7 }));
    }
    const c0 = box("contacteBlock");
    // fără șablon, Contactele stau sub Anunț (la 3mm), oricât de lung ar fi textul Anunțului
    const c: Box = custom ? c0 : { ...c0, y: Math.max(c0.y, anuntBottom + 3) };
    if (!drawOverride("contacteBlock", c)) {
      const s = sizeOf("contacteBlock", 2.7), bold = boldOf("contacteBlock");
      putRuns(doc, [{ t: "Contacte: ", bold: true }], c.x, c.y, s, 1.5);
      put(doc, company.apaCanalContactName ?? "", c.x + widthMm(doc, "Contacte: ", s, true), c.y, s, 1.5, { color: BRAND, bold });
      let top = c.y + s * 1.5 + 1;
      for (const l of wrap(doc, company.apaCanalContactsText ?? "", c.w, s, bold, true)) {
        put(doc, l, c.x, top, s, 1.8, { bold, color: TEXT });
        top += s * 1.8;
      }
    }
  }

  // ── Imagini adăugate liber ──
  (layout?.customImages ?? []).forEach((img, i) => drawImage(doc, imgBufs[i] ?? null, img.xMm, img.yMm, img.widthMm, img.heightMm));

  // ── Paginile de continuare ──
  if (contPages.length > 0) {
    put(doc, `Pagina 1 din ${totalPages}`, 5, 205.2, 2.6, 1.5, { color: CHART_TEXT, align: "right", width: 287 });
    contPages.forEach((cp, i) => {
      doc.addPage();
      doc.page.margins.bottom = -100000;
      drawContinuationPage(doc, invoice, cp, i + 2, totalPages);
    });
  }

  doc.end();
  return done;
}

/* ───────────────────────────── Factură obișnuită ───────────────────────────── */

type GenericInvoice = {
  number: string;
  status: string;
  currency: string;
  issueDate: Date;
  dueDate: Date | null;
  subtotal: number;
  taxTotal: number;
  grandTotal: number;
  notes: string | null;
  terms: string | null;
  client: { name: string; phone: string | null; email: string | null } | null;
  project: { name: string } | null;
  items: { id: string; description: string; quantity: number; unitPrice: number; taxRate: number; lineTotal: number }[];
};

const STATUS_COLORS: Record<string, { fg: string; bg: string }> = {
  DRAFT: { fg: "#475569", bg: "#e2e8f0" },
  SENT: { fg: "#1d4ed8", bg: "#dbeafe" },
  PAID: { fg: "#15803d", bg: "#dcfce7" },
  OVERDUE: { fg: "#b45309", bg: "#fef3c7" },
  CANCELLED: { fg: "#b91c1c", bg: "#fee2e2" },
};

export async function buildGenericInvoicePdf(o: { invoice: GenericInvoice; company: Company; tasks: { title: string }[] }): Promise<Buffer> {
  const { invoice: inv, company } = o;
  const { doc, done } = newDoc({ landscape: false, title: `Factura ${inv.number}`, author: company.companyName || "Compania" });
  const logo = await imageBuffer(company.logo);
  const PW = 210, PH = 297, X = 15, W = PW - 2 * X, BOTTOM = PH - 18;
  const INK = "#18181b", SOFT = "#71717a", LINE = "#e4e4e7", LIGHT = "#f4f4f5";
  const FS = (n: number) => n * (25.4 / 72); // pt → mm
  let y = 15;

  // antet: sigla + datele companiei | FACTURĂ + număr + status
  const headTop = y;
  let tx = X;
  if (logo) {
    drawImage(doc, logo, X, y, 17, 17);
    tx = X + 17 + 4;
  }
  put(doc, company.companyName || "Compania", tx, y, FS(15), 1.4, { bold: true, color: INK });
  let cy = y + FS(15) * 1.4 + 0.6;
  const info: string[] = [company.phone, company.email, company.address, company.taxId ? `IDNO/Tax: ${company.taxId}` : "", company.vatNumber ? `TVA: ${company.vatNumber}` : ""].filter((s): s is string => !!s);
  for (const l of info) {
    put(doc, l, tx, cy, FS(8), 1.5, { color: SOFT });
    cy += FS(8) * 1.5;
  }
  put(doc, "FACTURĂ", X, headTop, FS(22), 1.2, { bold: true, color: INK, align: "right", width: W });
  put(doc, inv.number, X, headTop + FS(22) * 1.2 + 1, FS(10.5), 1.4, { bold: true, color: INK, align: "right", width: W });
  const st = INVOICE_STATUS[inv.status as InvoiceStatusKey]?.label ?? inv.status;
  const sc = STATUS_COLORS[inv.status] ?? STATUS_COLORS.SENT;
  {
    const sw = widthMm(doc, st, FS(8), true) + 6, sy = headTop + FS(22) * 1.2 + 1 + FS(10.5) * 1.4 + 1.5;
    rrect(doc, X + W - sw, sy, sw, 5, 2.5, sc.bg);
    put(doc, st, X + W - sw, sy + 0.4, FS(8), 1.6, { bold: true, color: sc.fg, align: "center", width: sw });
    y = Math.max(cy, sy + 5, headTop + 17) + 5;
  }
  hline(doc, X, X + W, y, PX, LINE);
  y += 7;

  // client + datele facturii
  {
    const start = y;
    let ly = y;
    if (inv.client) {
      put(doc, "FACTURAT CĂTRE", X, ly, FS(7.5), 1.5, { bold: true, color: "#a1a1aa" });
      ly += FS(7.5) * 1.5 + 1;
      put(doc, inv.client.name, X, ly, FS(10), 1.5, { bold: true, color: INK });
      ly += FS(10) * 1.5;
      for (const l of [inv.client.phone, inv.client.email]) {
        if (!l) continue;
        put(doc, l, X, ly, FS(10), 1.5, { color: "#3f3f46" });
        ly += FS(10) * 1.5;
      }
    }
    const extra = [inv.project ? `Proiect: ${inv.project.name}` : "", o.tasks.length ? `Task${o.tasks.length > 1 ? "-uri" : ""}: ${o.tasks.map((t) => t.title).join(", ")}` : ""].filter(Boolean).join(" · ");
    if (extra) {
      ly += 1.5;
      for (const l of wrap(doc, extra, W * 0.6, FS(8.5), false, false)) {
        put(doc, l, X, ly, FS(8.5), 1.5, { color: SOFT });
        ly += FS(8.5) * 1.5;
      }
    }
    let ry = start;
    const meta = (k: string, v: string) => {
      const vw = widthMm(doc, v, FS(10), true);
      put(doc, v, X + W - vw, ry, FS(10), 1.5, { bold: true, color: "#3f3f46" });
      put(doc, `${k}: `, X + W - vw - widthMm(doc, `${k}: `, FS(10)), ry, FS(10), 1.5, { color: "#a1a1aa" });
      ry += FS(10) * 1.5;
    };
    meta("Data emiterii", fmtDate(inv.issueDate));
    if (inv.dueDate) meta("Scadență", fmtDate(inv.dueDate));
    y = Math.max(ly, ry) + 6;
  }

  // tabelul cu liniile
  const cols = [
    { h: "Descriere", w: 0.43, a: "left" as Align },
    { h: "Cant.", w: 0.1, a: "right" as Align },
    { h: "Preț", w: 0.17, a: "right" as Align },
    { h: "TVA", w: 0.08, a: "right" as Align },
    { h: "Total", w: 0.22, a: "right" as Align },
  ];
  const cx: number[] = [];
  cols.reduce((x, c) => (cx.push(x), x + c.w * W), X);
  const header = () => {
    hline(doc, X, X + W, y, PX, LINE);
    cols.forEach((c, i) => put(doc, c.h.toUpperCase(), cx[i], y + 1.8, FS(7.5), 1.4, { bold: true, color: "#a1a1aa", align: c.a, width: c.w * W - (i === 0 ? 0 : 0) }));
    y += 1.8 + FS(7.5) * 1.4 + 1.8;
    hline(doc, X, X + W, y, PX, LINE);
    y += PX;
  };
  header();
  const fs = FS(9.5);
  for (const it of inv.items) {
    const descLines = wrap(doc, it.description, cols[0].w * W - 3, fs, false, false);
    const rh = 2.6 + Math.max(1, descLines.length) * fs * 1.5 + 2.6;
    if (y + rh > BOTTOM) {
      doc.addPage();
      doc.page.margins.bottom = -100000;
      y = 15;
      header();
    }
    descLines.forEach((l, i) => put(doc, l, cx[0], y + 2.6 + i * fs * 1.5, fs, 1.5, { color: INK }));
    const num = (c: number, v: string, bold = false) => put(doc, v, cx[c], y + 2.6, fs, 1.5, { bold, color: INK, align: "right", width: cols[c].w * W });
    num(1, String(it.quantity));
    num(2, money(it.unitPrice, inv.currency));
    num(3, `${it.taxRate}%`);
    num(4, money(it.lineTotal, inv.currency), true);
    y += rh;
    hline(doc, X, X + W, y, PX, LIGHT);
    y += PX;
  }

  // totaluri
  {
    if (y + 28 > BOTTOM) {
      doc.addPage();
      doc.page.margins.bottom = -100000;
      y = 15;
    }
    y += 5;
    const tw = 64, tx2 = X + W - tw;
    const row = (k: string, v: string) => {
      put(doc, k, tx2, y, FS(9.5), 1.5, { color: "#52525b" });
      put(doc, v, tx2, y, FS(9.5), 1.5, { color: "#52525b", align: "right", width: tw });
      y += FS(9.5) * 1.5 + 0.8;
    };
    row("Subtotal", money(inv.subtotal, inv.currency));
    row("TVA total", money(inv.taxTotal, inv.currency));
    y += 1.2;
    hline(doc, tx2, tx2 + tw, y, PX, LINE);
    y += 2;
    put(doc, "Total general", tx2, y, FS(12), 1.5, { bold: true, color: INK });
    put(doc, money(inv.grandTotal, inv.currency), tx2, y, FS(12), 1.5, { bold: true, color: INK, align: "right", width: tw });
    y += FS(12) * 1.5 + 6;
  }

  // notițe / termeni / detalii bancare
  {
    const blocks: { title: string; text: string; full?: boolean }[] = [];
    if (inv.notes) blocks.push({ title: "Notițe", text: inv.notes });
    if (inv.terms) blocks.push({ title: "Termeni", text: inv.terms });
    if (company.bankDetails) blocks.push({ title: "Detalii bancare", text: company.bankDetails, full: true });
    if (blocks.length) {
      if (y + 20 > BOTTOM) {
        doc.addPage();
        doc.page.margins.bottom = -100000;
        y = 15;
      }
      hline(doc, X, X + W, y, PX, LINE);
      y += 6;
      const fsm = FS(8.5);
      const half = (W - 8) / 2;
      const lay = (b: { title: string; text: string }, x: number, top: number, width: number) => {
        put(doc, b.title, x, top, fsm, 1.5, { bold: true, color: "#27272a" });
        let t = top + fsm * 1.5 + 1;
        for (const l of wrap(doc, b.text, width, fsm, false, true)) {
          if (t + fsm * 1.5 > BOTTOM) break;
          put(doc, l, x, t, fsm, 1.5, { color: "#52525b" });
          t += fsm * 1.5;
        }
        return t;
      };
      const pair = blocks.filter((b) => !b.full);
      let bottom = y;
      pair.forEach((b, i) => (bottom = Math.max(bottom, lay(b, X + i * (half + 8), y, half))));
      const full = blocks.find((b) => b.full);
      if (full) lay(full, X, pair.length ? bottom + 4 : y, W);
    }
  }

  doc.end();
  return done;
}
