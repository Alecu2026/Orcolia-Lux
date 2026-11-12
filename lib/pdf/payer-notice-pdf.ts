import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";

/**
 * Notificări personale pentru plătitori, tipărite: PDF A4 cu câte o foaie separată pentru fiecare plătitor (dacă textul e lung, are mai multe foi,
 * dar niciodată nu se amestecă doi plătitori pe aceeași foaie). Generat direct pe server (pdfkit), cu fonturi care acoperă româna (ă â î ș ț).
 *
 * Două formate:
 *  - `plain`  — foaia simplă (bandă colorată sus, destinatar, titlu, text);
 *  - `letter` — DOCUMENT OFICIAL, ca o adresă a firmei: antet (denumirea firmei, adresa, logo), „Nr. ____ din data”, destinatarul în dreapta, titlul centrat,
 *    textul notificării justificat la mijloc și semnătura jos („Cu respect,” + funcția și numele semnatarului). În text: **îngroșat**, __îngroșat și subliniat__, ~~cursiv~~.
 */

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const FONT = path.join(FONT_DIR, "DejaVuSans.ttf");
const FONT_BOLD = path.join(FONT_DIR, "DejaVuSans-Bold.ttf");
// document oficial: font cu serife (metrici Times New Roman), cu diacritice românești
const SERIF = path.join(FONT_DIR, "Tinos-Regular.ttf");
const SERIF_BOLD = path.join(FONT_DIR, "Tinos-Bold.ttf");
const SERIF_ITALIC = path.join(FONT_DIR, "Tinos-Italic.ttf");
const SERIF_BOLD_ITALIC = path.join(FONT_DIR, "Tinos-BoldItalic.ttf");
const C = { brand: "#0d9488", brandDark: "#0f766e", ink: "#0f172a", soft: "#64748b", line: "#cbd5e1", head: "#f1f5f9", black: "#111111" };

export type PayerNotice = {
  name: string;
  account: string | null;
  address: string | null;
  /** Titlul foii (subiectul), cu variabilele deja completate. În formatul „document” poate avea mai multe rânduri (fiecare centrat). */
  title: string;
  /** Textul notificării, cu variabilele deja completate. */
  text: string;
};

export type NoticeLayout = "plain" | "letter";

/** Antetul și semnătura documentului oficial. */
export type LetterInfo = {
  /** denumirea firmei în antet */
  companyLine: string;
  /** adresa, telefonul etc., pe un rând, sub linia antetului */
  address: string;
  /** logo (PNG / JPEG), sus în dreapta; null = fără */
  logo: Buffer | null;
  /** funcția semnatarului („Director Financiar”); firma se adaugă după ea */
  signTitle: string;
  signName: string;
};

type Seg = { t: string; b?: boolean; u?: boolean; i?: boolean };

/** Împarte un paragraf după marcajele **îngroșat**, __îngroșat + subliniat__ și ~~cursiv~~. */
export function parseRich(s: string): Seg[] {
  const out: Seg[] = [];
  const re = /\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index > last) out.push({ t: s.slice(last, m.index) });
    if (m[1] != null) out.push({ t: m[1], b: true });
    else if (m[2] != null) out.push({ t: m[2], b: true, u: true });
    else out.push({ t: m[3], i: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: s.slice(last) });
  return out.filter((x) => x.t.length > 0);
}

export async function buildPayerNoticesPdf(o: {
  companyName: string;
  today: string;
  notices: PayerNotice[];
  labels: { to: string; account: string; address: string; sheet: string; notice: string; date: string };
  layout?: NoticeLayout;
  letter?: LetterInfo;
}): Promise<Buffer> {
  const { notices, labels } = o;
  const letterMode = o.layout === "letter";
  const doc = new PDFDocument({
    size: "A4",
    margins: letterMode ? { top: 64, bottom: 64, left: 62, right: 62 } : { top: 96, bottom: 64, left: 56, right: 56 },
    bufferPages: true,
    info: { Title: `${labels.notice} — ${o.companyName}`, Author: o.companyName || "Apă-Canal" },
  });
  doc.registerFont("R", FONT);
  doc.registerFont("B", FONT_BOLD);
  doc.registerFont("TR", SERIF);
  doc.registerFont("TB", SERIF_BOLD);
  doc.registerFont("TI", SERIF_ITALIC);
  doc.registerFont("TBI", SERIF_BOLD_ITALIC);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const ML = letterMode ? 62 : 56;
  const L = ML, R = pageW - ML, W = R - L;
  const company = o.companyName || "Apă-Canal";
  /** Primele pagini ale fiecărei notificări + câte pagini are, pentru subsol („Foaia 2 / 3” în cadrul aceleiași notificări). */
  const spans: { start: number; count: number; name: string }[] = [];

  // ── formatul simplu ──
  const header = () => {
    doc.rect(0, 0, pageW, 58).fill(C.brand);
    doc.font("B").fontSize(15).fillColor("#ffffff").text(company, L, 18, { width: W * 0.62, lineBreak: false, ellipsis: true });
    doc.font("R").fontSize(9).fillColor("#ccfbf1").text(`${labels.date}: ${o.today}`, L + W * 0.55, 24, { width: W * 0.45, align: "right", lineBreak: false });
  };

  const drawPlain = (n: PayerNotice) => {
    header();
    let y = 78;
    // destinatarul
    doc.font("R").fontSize(8).fillColor(C.soft).text(labels.to.toUpperCase(), L, y, { width: W });
    y = doc.y + 2;
    doc.font("B").fontSize(14).fillColor(C.ink).text(n.name, L, y, { width: W });
    y = doc.y + 3;
    if (n.account) { doc.font("R").fontSize(10).fillColor(C.ink).text(`${labels.account}: ${n.account}`, L, y, { width: W }); y = doc.y + 1; }
    if (n.address) { doc.font("R").fontSize(10).fillColor(C.ink).text(`${labels.address}: ${n.address}`, L, y, { width: W }); y = doc.y + 1; }
    y += 10;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.8).strokeColor(C.line).stroke();
    y += 14;
    // titlul + textul
    const title = n.title.replace(/\s*[\r\n]+\s*/g, " ").trim();
    if (title) {
      doc.font("B").fontSize(13).fillColor(C.brandDark).text(title, L, y, { width: W });
      y = doc.y + 10;
    }
    doc.font("R").fontSize(11).fillColor(C.ink).text(n.text.replace(/\*\*|__|~~/g, ""), L, y, { width: W, lineGap: 3 });
  };

  // ── documentul oficial ──
  const SIZE = 11;
  const LINE_H = SIZE * 1.2 + 2.2;
  const INDENT = 28;
  type Piece = { text: string; font: string; u: boolean; space: boolean; w: number };
  /**
   * Un paragraf justificat, cu fragmente de stiluri diferite pe același rând (îngroșat, subliniat, cursiv). Cuvintele se așază pe rânduri după lățimea măsurată, iar spațiile se
   * lărgesc ca rândul să umple lățimea (ultimul rând rămâne neîntins); sublinierea se desenează sub cuvinte. Întoarce poziția y de după paragraf.
   */
  const richParagraph = (text: string, x: number, y0: number): number => {
    const segs = parseRich(text);
    if (segs.length === 0) return y0;
    const pieces: Piece[] = [];
    let spaceNext = false; // între fragmente fără spațiu (ex. „**5,00 MDL**,”) cuvintele se lipesc
    for (const g of segs) {
      const font = g.b && g.i ? "TBI" : g.b ? "TB" : g.i ? "TI" : "TR";
      doc.font(font).fontSize(SIZE);
      for (const part of g.t.split(/(\s+)/)) {
        if (part === "") continue;
        if (/^\s+$/.test(part)) { spaceNext = true; continue; }
        pieces.push({ text: part, font, u: !!g.u, space: spaceNext && pieces.length > 0, w: doc.widthOfString(part) });
        spaceNext = false;
      }
    }
    doc.font("TR").fontSize(SIZE);
    const spaceW = doc.widthOfString(" ");
    const bottom = pageH - 64;
    let y = y0;
    let i = 0;
    let first = true;
    while (i < pieces.length) {
      const avail = W - (first ? INDENT : 0);
      let j = i;
      let natural = 0;
      while (j < pieces.length) {
        const add = pieces[j].w + (j > i && pieces[j].space ? spaceW : 0);
        if (j > i && natural + add > avail) break;
        natural += add;
        j++;
      }
      const line = pieces.slice(i, j);
      const gaps = line.slice(1).filter((p) => p.space).length;
      const last = j >= pieces.length;
      const extra = !last && gaps > 0 ? (avail - natural) / gaps : 0;
      if (y + LINE_H > bottom) {
        doc.addPage();
        y = 80;
      }
      let cx = x + (first ? INDENT : 0);
      line.forEach((p, k) => {
        const gap = k > 0 && p.space ? spaceW + extra : 0;
        cx += gap;
        doc.font(p.font).fontSize(SIZE).fillColor(C.black).text(p.text, cx, y, { lineBreak: false });
        if (p.u) {
          const from = k > 0 && p.space && line[k - 1].u ? cx - gap : cx;
          doc.moveTo(from, y + SIZE + 0.6).lineTo(cx + p.w, y + SIZE + 0.6).lineWidth(0.6).strokeColor(C.black).stroke();
        }
        cx += p.w;
      });
      y += LINE_H;
      first = false;
      i = j;
    }
    return y;
  };

  const drawLetter = (n: PayerNotice) => {
    const info = o.letter ?? { companyLine: company, address: "", logo: null, signTitle: "", signName: "" };
    let y = 38;
    // antetul: denumirea firmei, linia, adresa; logo în dreapta
    if (info.logo) {
      try {
        doc.image(info.logo, R - 46, 22, { fit: [46, 46], align: "right", valign: "center" });
      } catch {
        /* logo ilizibil: antetul rămâne fără el */
      }
    }
    doc.font("TB").fontSize(16).fillColor(C.black).text(info.companyLine || company, L, y + 6, { width: W - 70, lineBreak: false, ellipsis: true });
    y = 72;
    doc.moveTo(L, y).lineTo(R, y).lineWidth(0.9).strokeColor(C.black).stroke();
    if (info.address) doc.font("TI").fontSize(8).fillColor("#333333").text(info.address, L, y + 3, { width: W - 70, lineGap: 1 });

    // „Nr. ____ din data” (stânga) și destinatarul (dreapta)
    y = 112;
    doc.font("TB").fontSize(11.5).fillColor(C.black).text("Nr.", L, y, { lineBreak: false });
    doc.moveTo(L + 24, y + 13).lineTo(L + 130, y + 13).lineWidth(0.7).strokeColor(C.black).stroke();
    doc.font("TB").fontSize(11.5).text("din", L, y + 22, { lineBreak: false });
    doc.font("TB").fontSize(11.5).text(o.today, L + 26, y + 22, { lineBreak: false, underline: true });
    const rx = L + W * 0.54;
    doc.font("TR").fontSize(11.5).fillColor(C.black).text(n.name, rx, y, { width: R - rx });
    let ry = doc.y + 1;
    if (n.address) {
      doc.font("TR").fontSize(11).text(n.address, rx, ry, { width: R - rx });
      ry = doc.y;
    }
    y = Math.max(ry, y + 40) + 24;

    // titlul (rânduri centrate, îngroșate)
    for (const line of n.title.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
      doc.font("TB").fontSize(13).fillColor(C.black).text(line, L, y, { width: W, align: "center" });
      y = doc.y + 2;
    }
    y += 12;

    // textul notificării, justificat; fiecare rând nou = paragraf nou
    for (const p of n.text.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean)) {
      y = richParagraph(p, L, y) + 5;
    }

    // semnătura: dacă nu mai încape pe foaia curentă, trece pe următoarea
    y += 12;
    if (y > pageH - 64 - 96) {
      doc.addPage();
      y = 96;
    }
    doc.font("TR").fontSize(SIZE).fillColor(C.black).text("Cu respect,", L, y, { width: W });
    y = doc.y + 26;
    const signTitle = [info.signTitle, info.signTitle ? company : ""].filter(Boolean).join(" ").trim();
    if (signTitle) doc.font("TR").fontSize(SIZE).text(signTitle, L, y, { width: W * 0.62 });
    if (info.signName) doc.font("TR").fontSize(SIZE).text(info.signName, L + W * 0.66, y, { width: W * 0.34, align: "right" });
  };

  notices.forEach((n, i) => {
    if (i > 0) doc.addPage();
    const startIdx = doc.bufferedPageRange().count - 1;
    if (letterMode) drawLetter(n);
    else drawPlain(n);
    const endIdx = doc.bufferedPageRange().count - 1;
    spans.push({ start: startIdx, count: endIdx - startIdx + 1, name: n.name });
  });

  // subsol pe fiecare foaie (la documentul oficial: doar când o notificare are mai multe foi)
  for (const s of spans) {
    if (letterMode && s.count <= 1) continue;
    for (let k = 0; k < s.count; k++) {
      doc.switchToPage(s.start + k);
      const bm = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // altfel textul din subsol ar deschide o foaie nouă
      const y = doc.page.height - 40;
      if (!letterMode) {
        doc.moveTo(L, y - 8).lineTo(R, y - 8).lineWidth(0.5).strokeColor(C.line).stroke();
        doc.font("R").fontSize(8).fillColor(C.soft).text(`${labels.notice} · ${company}`, L, y, { width: W * 0.7, lineBreak: false, ellipsis: true });
      }
      if (s.count > 1) doc.font(letterMode ? "TR" : "R").fontSize(8).fillColor(C.soft).text(`${labels.sheet} ${k + 1} / ${s.count}`, L + W * 0.7, y, { width: W * 0.3, align: "right", lineBreak: false });
      doc.page.margins.bottom = bm;
    }
  }

  doc.end();
  return done;
}
