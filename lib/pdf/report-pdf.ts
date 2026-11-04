import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { ReportSheet } from "../regulatory-report";

/**
 * Raportul „Petiții și reclamații cu privire la furnizarea serviciului” ca PDF (pdfkit, fără browser): A4 pe lățime, în forma formularului de raportare —
 * antet galben cu coloanele și rândul de numerotare, secțiunile 1 / 2 / 3 în culori diferite, chenar negru. Antetul tabelului se repetă pe fiecare pagină.
 * Textul rămâne în română (document oficial), ca la facturile Apă-Canal.
 */
const FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const FILL = { head: "#FFE699", s1: "#E2EFDA", s2: "#DDEBF7", s3: "#FFF2CC" } as const;
/** Lățimile relative ale celor 8 coloane. */
const REL = [5.5, 33, 8, 11.5, 11, 13, 9, 9];

export async function buildReportPdf(o: { sheet: ReportSheet; companyName: string; lines: string[]; today: string }): Promise<Buffer> {
  const { rows } = o.sheet;
  const title = String(rows[0]?.[0] ?? "");
  const head = rows[2] ?? [];
  const numbering = rows[3] ?? [];
  const body = rows.slice(4);
  const blank = body.map((r) => r.length === 0).lastIndexOf(true);
  const data = blank >= 0 ? body.slice(0, blank) : body;
  const footnote = blank >= 0 ? String(body[blank + 1]?.[0] ?? "") : "";

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margins: { top: 28, bottom: 40, left: 28, right: 28 }, bufferPages: true, info: { Title: title, Author: o.companyName } });
  doc.registerFont("R", FONT);
  doc.registerFont("B", FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const L = 28, W = doc.page.width - 56, bottom = doc.page.height - 44;
  const relSum = REL.reduce((a, b) => a + b, 0);
  const cw = REL.map((r) => (r / relSum) * W);
  const xs: number[] = [];
  { let x = L; for (const w of cw) { xs.push(x); x += w; } }
  const PAD = 4;

  const text = (s: string, x: number, y: number, w: number, opt: { bold?: boolean; size?: number; align?: "left" | "center" | "right"; color?: string } = {}) =>
    doc.font(opt.bold ? "B" : "R").fontSize(opt.size ?? 8.5).fillColor(opt.color ?? "#000000").text(s, x, y, { width: w, align: opt.align ?? "left" });

  let y = 30;
  // titlul + datele raportului
  doc.font("B").fontSize(13).fillColor("#000000").text(title, L, y, { width: W, align: "center" });
  y += 22;
  for (const line of o.lines) { text(line, L, y, W, { size: 9, align: "center", color: "#334155" }); y += 12; }
  y += 6;

  const cellBox = (i: number, yy: number, h: number, fill: string) => {
    doc.rect(xs[i], yy, cw[i], h).fillAndStroke(fill, "#000000");
  };
  const drawHead = () => {
    const h1 = 46, h2 = 16;
    head.forEach((t, i) => {
      cellBox(i, y, h1, FILL.head);
      doc.font("B").fontSize(8).fillColor("#000000").text(String(t), xs[i] + PAD, y + 5, { width: cw[i] - PAD * 2, height: h1 - 8, align: "center" });
    });
    y += h1;
    numbering.forEach((t, i) => {
      cellBox(i, y, h2, FILL.head);
      doc.font("B").fontSize(8.5).fillColor("#000000").text(String(t), xs[i], y + 4, { width: cw[i], align: "center" });
    });
    y += h2;
  };
  drawHead();

  let fill: string = FILL.s1;
  for (const r of data) {
    const nr = r[0];
    const isSection = nr !== "" && nr != null;
    if (isSection) fill = nr === 2 ? FILL.s2 : nr === 3 ? FILL.s3 : FILL.s1;
    doc.font(isSection ? "B" : "R").fontSize(8.5);
    const label = String(r[1] ?? "");
    const h = Math.max(18, doc.heightOfString(label, { width: cw[1] - PAD * 2 }) + 8);
    if (y + h > bottom) { doc.addPage(); y = 28; drawHead(); }
    r.forEach((v, i) => {
      cellBox(i, y, h, fill);
      const s = typeof v === "number" ? v.toLocaleString("ro-RO", { maximumFractionDigits: 1 }) : String(v ?? "");
      const bold = isSection || (i === 0);
      doc.font(bold ? "B" : "R").fontSize(8.5).fillColor("#000000");
      if (i === 1) doc.text(s, xs[i] + PAD, y + 4, { width: cw[i] - PAD * 2, align: "left" });
      else doc.text(s, xs[i], y + (h - 10) / 2, { width: cw[i], align: "center" });
    });
    y += h;
  }
  if (footnote) {
    if (y + 30 > bottom) { doc.addPage(); y = 28; }
    text(footnote, L, y + 8, W, { size: 7.5, color: "#475569" });
  }

  // subsol: compania, data generării, numărul paginii
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0; // subsolul stă în marginea de jos: fără asta pdfkit adaugă pagini goale
    const fy = doc.page.height - 30;
    doc.font("R").fontSize(7.5).fillColor("#64748b");
    doc.text(`${o.companyName} · generat la ${o.today}`, L, fy, { width: W / 2, align: "left", lineBreak: false });
    doc.text(`Pagina ${i + 1} din ${range.count}`, L + W / 2, fy, { width: W / 2, align: "right", lineBreak: false });
  }
  doc.end();
  return done;
}
