import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import { SPEC_GROUPS, SPEC_PARTS, STATUS_LABEL_RO, type SpecItem, type SpecStatus } from "../tender-spec";
import { PART_NOTE_EN, STATUS_LABEL_EN, WHERE_EN } from "../tender-spec-en";

/**
 * „Caiet de sarcini” în PDF (pagina Contract): toate punctele cu bifa lor (cine a bifat și când), statusul de acoperire în CRM și, opțional, textul din „i”
 * (unde se găsește / cum e implementat). În română + engleză (implicit), doar română sau doar engleză. Generat pe server (pdfkit) cu DejaVu Sans (ă â î ș ț).
 */

const FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const C = { brand: "#0d9488", brandDark: "#0f766e", brandSoft: "#f0fdfa", ink: "#0f172a", soft: "#64748b", line: "#cbd5e1", head: "#f1f5f9", ok: "#15803d" };
const STATUS_COLOR: Record<SpecStatus, string> = { done: "#15803d", partial: "#b45309", external: "#1d4ed8", na: "#64748b", todo: "#b91c1c" };

export type TenderPdfLang = "both" | "ro" | "en";
export type TenderPdfShow = "all" | "done" | "todo";
export type TenderPdfChecks = Record<string, { by: string; at: string }>;

export const TENDER_PDF_LANGS: TenderPdfLang[] = ["both", "ro", "en"];
export const TENDER_PDF_SHOWS: TenderPdfShow[] = ["all", "done", "todo"];

const TZ = "Europe/Bucharest";
const fmtDate = (d: Date, lang: TenderPdfLang) =>
  d.toLocaleDateString(lang === "en" ? "en-GB" : "ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
const fmtDateTime = (d: Date, lang: TenderPdfLang) =>
  d.toLocaleString(lang === "en" ? "en-GB" : "ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

export async function buildTenderPdf(o: {
  companyName: string;
  generatedBy: string;
  now: Date;
  lang: TenderPdfLang;
  show: TenderPdfShow;
  /** Cu textul din „i” (unde se găsește / cum e implementat). */
  info: boolean;
  checks: TenderPdfChecks;
}): Promise<Buffer> {
  const { lang, show, info, checks } = o;
  const ro = lang !== "en";
  const en = lang !== "ro";
  /** Eticheta în limba/limbile PDF-ului: „română / engleză”, doar româna sau doar engleza. */
  const tx = (r: string, e: string) => (lang === "both" ? `${r} / ${e}` : lang === "ro" ? r : e);
  const company = o.companyName || "Apă-Canal";
  const docTitle = tx("Caiet de sarcini", "Technical specification checklist");

  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 64, bottom: 56, left: 40, right: 40 },
    bufferPages: true,
    info: { Title: `${docTitle} — ${company}`, Author: company },
  });
  doc.registerFont("R", FONT);
  doc.registerFont("B", FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const PW = doc.page.width;
  const L = 40, R = PW - 40, W = R - L;
  const TOP = 64;
  const BOTTOM = doc.page.height - 56;
  const GAP = 1.5;
  let y = TOP;

  const heightOf = (s: string, w: number, font: "R" | "B", size: number) => {
    doc.font(font).fontSize(size);
    return doc.heightOfString(s, { width: w, lineGap: GAP });
  };
  /** Scrie textul la (x, y curent) și întoarce înălțimea. */
  const put = (s: string, x: number, w: number, font: "R" | "B", size: number, color: string, opts: PDFKit.Mixins.TextOptions = {}) => {
    doc.font(font).fontSize(size).fillColor(color).text(s, x, y, { width: w, lineGap: GAP, ...opts });
  };

  const pageHeader = () => {
    doc.font("R").fontSize(8).fillColor(C.soft).text(`${docTitle} · ${company}`, L, 28, { width: W * 0.72, lineBreak: false, ellipsis: true });
    doc.font("R").fontSize(8).fillColor(C.soft).text(fmtDate(o.now, lang), L + W * 0.72, 28, { width: W * 0.28, align: "right", lineBreak: false });
    doc.moveTo(L, 44).lineTo(R, 44).lineWidth(0.5).strokeColor(C.line).stroke();
  };
  const newPage = () => {
    doc.addPage();
    pageHeader();
    y = TOP;
  };
  const ensure = (h: number) => {
    if (y + h > BOTTOM) newPage();
  };
  pageHeader();

  // ── titlu + sumar ──
  const total = SPEC_GROUPS.reduce((n, g) => n + g.items.length, 0);
  const checkedTotal = SPEC_GROUPS.reduce((n, g) => n + g.items.filter((_, i) => checks[`${g.id}-${i + 1}`]).length, 0);

  put(docTitle, L, W, "B", 16, C.brandDark);
  y = doc.y + 2;
  put("BD Contract 3 WSS Cahul Rural — Section VII, Particular Technical Specifications", L, W, "R", 10, C.soft);
  y = doc.y + 2;
  put(
    `${tx("Generat", "Generated")}: ${fmtDateTime(o.now, lang)} · ${tx("de", "by")} ${o.generatedBy} · ${company}`,
    L, W, "R", 9, C.soft,
  );
  y = doc.y + 2;
  const showLabel = show === "done" ? tx("doar punctele bifate", "only checked items") : show === "todo" ? tx("doar punctele nebifate", "only unchecked items") : tx("toate punctele", "all items");
  put(`${tx("Conținut", "Contents")}: ${showLabel}${info ? "" : ` · ${tx("fără detaliile din „i”", "without the “i” details")}`}`, L, W, "R", 9, C.soft);
  y = doc.y + 12;

  // total + pe părți
  const barRow = (label: string, d: number, t: number, bold: boolean) => {
    ensure(18);
    const pct = t ? Math.round((d / t) * 100) : 0;
    doc.font(bold ? "B" : "R").fontSize(9).fillColor(C.ink).text(label, L, y + 2, { width: W * 0.58, lineBreak: false, ellipsis: true });
    const bx = L + W * 0.6, bw = W * 0.2;
    doc.roundedRect(bx, y + 4, bw, 6, 3).fillColor(C.head).fill();
    if (pct > 0) doc.roundedRect(bx, y + 4, Math.max(4, (bw * pct) / 100), 6, 3).fillColor(C.brand).fill();
    doc.font("R").fontSize(9).fillColor(C.soft).text(`${d} / ${t} · ${pct}%`, bx + bw + 6, y + 2, { width: R - (bx + bw + 6), align: "right", lineBreak: false });
    y += 18;
  };
  barRow(tx("În total", "Total"), checkedTotal, total, true);
  for (const p of SPEC_PARTS) {
    const gs = SPEC_GROUPS.filter((g) => g.part === p.id);
    const t = gs.reduce((n, g) => n + g.items.length, 0);
    const d = gs.reduce((n, g) => n + g.items.filter((_, i) => checks[`${g.id}-${i + 1}`]).length, 0);
    barRow(tx(p.titleRo, p.titleEn), d, t, false);
  }

  // cine a bifat: număr de puncte pe persoană
  const byPerson = new Map<string, number>();
  for (const c of Object.values(checks)) byPerson.set(c.by || "—", (byPerson.get(c.by || "—") ?? 0) + 1);
  if (byPerson.size > 0) {
    y += 8;
    ensure(30);
    put(tx("Cine a bifat", "Checked by"), L, W, "B", 10, C.ink);
    y = doc.y + 3;
    const people = [...byPerson.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ro"));
    const colW = W / 2;
    for (let i = 0; i < people.length; i += 2) {
      ensure(14);
      for (let k = 0; k < 2 && i + k < people.length; k++) {
        const [name, n] = people[i + k];
        doc.font("R").fontSize(9).fillColor(C.ink).text(`${name}: ${n}`, L + k * colW, y, { width: colW - 8, lineBreak: false, ellipsis: true });
      }
      y += 13;
    }
  }
  y += 6;

  // ── legendă status ──
  ensure(16);
  doc.font("R").fontSize(8).fillColor(C.soft).text(`${tx("Acoperire în CRM", "Coverage in the CRM")}:`, L, y, { lineBreak: false });
  y += 12;
  let lx = L;
  for (const s of ["done", "partial", "external", "na", "todo"] as SpecStatus[]) {
    const label = lang === "both" ? `${STATUS_LABEL_RO[s]} / ${STATUS_LABEL_EN[s]}` : lang === "ro" ? STATUS_LABEL_RO[s] : STATUS_LABEL_EN[s];
    doc.font("R").fontSize(7.5).fillColor(C.ink);
    const w = doc.widthOfString(label);
    if (lx + 9 + w > R) { y += 11; lx = L; }
    doc.circle(lx + 3, y + 4, 2.5).fillColor(STATUS_COLOR[s]).fill();
    doc.font("R").fontSize(7.5).fillColor(C.ink).text(label, lx + 9, y, { lineBreak: false });
    lx += 9 + w + 12;
  }
  y += 18;

  // ── punctele ──
  const checkbox = (x: number, top: number, on: boolean) => {
    const s = 11;
    if (on) {
      doc.roundedRect(x, top, s, s, 2).fillColor(C.ok).fill();
      doc.moveTo(x + 2.4, top + 5.8).lineTo(x + 4.7, top + 8.2).lineTo(x + 8.7, top + 3).lineWidth(1.5).lineJoin("round").lineCap("round").strokeColor("#ffffff").stroke();
      doc.lineCap("butt");
    } else {
      doc.roundedRect(x + 0.5, top + 0.5, s - 1, s - 1, 2).lineWidth(0.9).strokeColor(C.soft).stroke();
    }
  };

  const STATUS_W = lang === "both" ? 104 : 84;
  const TEXT_X = L + 20;
  const TEXT_W = W - 20 - STATUS_W - 8;

  const drawItem = (it: SpecItem) => {
    const chk = checks[it.id];
    // textele punctului: întâi engleza (ca în contract), apoi româna
    const texts: { s: string; font: "R" | "B"; color: string }[] = [];
    if (en) texts.push({ s: it.en, font: "B", color: C.ink });
    if (ro) texts.push({ s: it.ro, font: en ? "R" : "B", color: en ? C.soft : C.ink });
    const size = 9.5;
    let mainH = 0;
    for (const t of texts) mainH += heightOf(t.s, TEXT_W, t.font, size) + 2;

    const chkLine = chk
      ? `${tx("Bifat de", "Checked by")}: ${chk.by} · ${fmtDateTime(new Date(chk.at), lang)}`
      : tx("Nebifat", "Not checked");
    const chkH = heightOf(chkLine, TEXT_W, "R", 8) + 2;

    const st = it.status;
    const stRo = STATUS_LABEL_RO[st], stEn = STATUS_LABEL_EN[st];
    const stLines: string[] = lang === "both" ? [stRo, stEn] : lang === "ro" ? [stRo] : [stEn];
    const stH = stLines.reduce((n, s, i) => n + heightOf(s, STATUS_W, i === 0 ? "B" : "R", 8) + 1, 0);

    // blocul „i”
    const infoPad = 6;
    const infoW = W - 20 - 2 * infoPad - 4;
    const whereRo = it.where;
    const whereEn = WHERE_EN[it.id] ?? it.where;
    const tagW = lang === "both" ? 16 : 0;
    const infoLabel = tx("Unde se găsește / cum e implementat", "Where it is found / how it is implemented");
    const pages = (it.links ?? []).map((l) => l.href);
    const pagesLine = pages.length ? `${tx("Pagini", "Pages")}: ${pages.join("  ·  ")}` : "";
    let infoH = 0;
    if (info) {
      infoH = infoPad * 2 + heightOf(infoLabel, infoW, "B", 7.5) + 3;
      if (ro) infoH += heightOf(whereRo, infoW - tagW, "R", 8.5) + 3;
      if (en) infoH += heightOf(whereEn, infoW - tagW, "R", 8.5) + 3;
      if (pagesLine) infoH += heightOf(pagesLine, infoW, "R", 7.5) + 2;
    }

    const rowH = Math.max(mainH + chkH, stH) + (info ? infoH + 4 : 0) + 8;
    ensure(rowH);

    const top = y;
    checkbox(L + 2, top + 2, !!chk);
    // texte
    let ty = top;
    for (const t of texts) {
      y = ty;
      put(t.s, TEXT_X, TEXT_W, t.font, size, t.color);
      ty += heightOf(t.s, TEXT_W, t.font, size) + 2;
    }
    y = ty;
    put(chkLine, TEXT_X, TEXT_W, "R", 8, chk ? C.ok : C.soft);
    ty += chkH;
    // status
    let sy = top;
    stLines.forEach((s, i) => {
      y = sy;
      put(s, R - STATUS_W, STATUS_W, i === 0 ? "B" : "R", 8, STATUS_COLOR[st], { align: "right" });
      sy += heightOf(s, STATUS_W, i === 0 ? "B" : "R", 8) + 1;
    });
    // „i”
    let bottom = Math.max(ty, sy);
    if (info) {
      const bx = TEXT_X - 4, by = bottom + 3, bw = W - 20 + 4;
      doc.rect(bx, by, bw, infoH).fillColor(C.brandSoft).fill();
      doc.rect(bx, by, 2.5, infoH).fillColor(C.brand).fill();
      // cercul cu „i”
      const cx = bx + bw - 12, cy = by + 11;
      doc.circle(cx, cy, 6).fillColor(C.brand).fill();
      doc.font("B").fontSize(8).fillColor("#ffffff").text("i", cx - 6, cy - 4.6, { width: 12, align: "center", lineBreak: false });
      let iy = by + infoPad;
      y = iy;
      put(infoLabel.toUpperCase(), bx + 2.5 + infoPad, infoW - 16, "B", 7.5, C.brandDark);
      iy += heightOf(infoLabel, infoW, "B", 7.5) + 3;
      const para = (tag: string, s: string) => {
        y = iy;
        if (tagW) put(tag, bx + 2.5 + infoPad, tagW, "B", 7, C.soft);
        y = iy;
        put(s, bx + 2.5 + infoPad + tagW, infoW - tagW, "R", 8.5, C.ink);
        iy += heightOf(s, infoW - tagW, "R", 8.5) + 3;
      };
      if (ro) para("RO", whereRo);
      if (en) para("EN", whereEn);
      if (pagesLine) {
        y = iy;
        put(pagesLine, bx + 2.5 + infoPad, infoW, "R", 7.5, C.brandDark);
      }
      bottom = by + infoH;
    }
    y = bottom + 5;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.3).strokeColor(C.line).stroke();
    y += 4;
  };

  let anything = false;
  for (const p of SPEC_PARTS) {
    const groups = SPEC_GROUPS.filter((g) => g.part === p.id)
      .map((g) => ({
        g,
        items: g.items
          .map((it, i) => ({ ...it, id: `${g.id}-${i + 1}` }))
          .filter((it) => (show === "done" ? !!checks[it.id] : show === "todo" ? !checks[it.id] : true)),
      }))
      .filter((x) => x.items.length > 0);
    if (groups.length === 0) continue;
    anything = true;

    // titlul părții: pe aceeași pagină dacă mai încape și primul punct, altfel pe pagină nouă
    const note = lang === "both" ? `${p.noteRo}\n${PART_NOTE_EN[p.id]}` : lang === "ro" ? p.noteRo : PART_NOTE_EN[p.id];
    const partTitle = tx(p.titleRo, p.titleEn);
    const nh = heightOf(note, W - 24, "R", 8.5);
    const bh = 30 + nh;
    ensure(bh + 220);
    doc.rect(L, y, W, bh).fillColor(C.brand).fill();
    doc.font("B").fontSize(13).fillColor("#ffffff").text(partTitle, L + 12, y + 8, { width: W - 24, lineBreak: false, ellipsis: true });
    doc.font("R").fontSize(8.5).fillColor("#ccfbf1").text(note, L + 12, y + 26, { width: W - 24, lineGap: GAP });
    y += bh + 10;

    for (const { g, items } of groups) {
      const gTitle = lang === "both" ? `${g.titleRo}\n${g.titleEn}` : lang === "ro" ? g.titleRo : g.titleEn;
      const gDone = g.items.filter((_, i) => checks[`${g.id}-${i + 1}`]).length;
      const introParts = [ro ? g.introRo : undefined, en ? g.introEn : undefined].filter((s): s is string => !!s);
      const intro = introParts.join("\n");
      const CODE_W = 62;
      const hw = W - 16 - CODE_W - 84;
      const gh = heightOf(gTitle, hw, "B", 10) + 10;
      const ih = intro ? heightOf(intro, W - 16, "R", 8) + 8 : 0;
      ensure(gh + ih + 40); // titlul grupului nu rămâne singur la finalul paginii
      doc.rect(L, y, W, gh).fillColor(C.head).fill();
      doc.rect(L, y, W, gh).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.font("B").fontSize(8).fillColor(C.brand).text(g.code, L + 8, y + 6, { width: CODE_W - 4, lineBreak: false });
      doc.font("B").fontSize(10).fillColor(C.ink).text(gTitle, L + 8 + CODE_W, y + 5, { width: hw, lineGap: GAP });
      doc.font("R").fontSize(8.5).fillColor(C.soft).text(`${gDone} / ${g.items.length}`, R - 84, y + 5, { width: 76, align: "right", lineBreak: false });
      y += gh;
      if (intro) {
        y += 4;
        put(intro, L + 8, W - 16, "R", 8, C.soft);
        y = doc.y + 4;
      }
      y += 6;
      for (const it of items) drawItem(it);
      y += 6;
    }
  }
  if (!anything) {
    put(show === "done" ? tx("Niciun punct bifat încă.", "No item has been checked yet.") : tx("Toate punctele sunt bifate.", "All items are checked."), L, W, "R", 11, C.soft);
  }

  // ── subsol: numărul paginii ──
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const bm = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // altfel textul din subsol ar deschide o foaie nouă
    const fy = doc.page.height - 36;
    doc.moveTo(L, fy - 6).lineTo(R, fy - 6).lineWidth(0.5).strokeColor(C.line).stroke();
    doc.font("R").fontSize(8).fillColor(C.soft).text(`${docTitle} · ${company}`, L, fy, { width: W * 0.75, lineBreak: false, ellipsis: true });
    doc.font("R").fontSize(8).fillColor(C.soft).text(`${tx("Pagina", "Page")} ${i + 1} / ${range.count}`, L + W * 0.75, fy, { width: W * 0.25, align: "right", lineBreak: false });
    doc.page.margins.bottom = bm;
  }

  doc.end();
  return done;
}
