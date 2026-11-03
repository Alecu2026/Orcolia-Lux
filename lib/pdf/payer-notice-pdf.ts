import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";

/**
 * Notificări personale pentru plătitori, tipărite: PDF A4 cu câte o foaie separată pentru fiecare plătitor (dacă textul e lung, are mai multe foi,
 * dar niciodată nu se amestecă doi plătitori pe aceeași foaie). Generat direct pe server (pdfkit), cu fontul DejaVu Sans care acoperă româna (ă â î ș ț).
 */

const FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const C = { brand: "#0d9488", brandDark: "#0f766e", ink: "#0f172a", soft: "#64748b", line: "#cbd5e1", head: "#f1f5f9" };

export type PayerNotice = {
  name: string;
  account: string | null;
  address: string | null;
  /** Titlul foii (subiectul), cu variabilele deja completate. */
  title: string;
  /** Textul notificării, cu variabilele deja completate. */
  text: string;
};

export async function buildPayerNoticesPdf(o: { companyName: string; today: string; notices: PayerNotice[]; labels: { to: string; account: string; address: string; sheet: string; notice: string; date: string } }): Promise<Buffer> {
  const { notices, labels } = o;
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 96, bottom: 64, left: 56, right: 56 },
    bufferPages: true,
    info: { Title: `${labels.notice} — ${o.companyName}`, Author: o.companyName || "Apă-Canal" },
  });
  doc.registerFont("R", FONT);
  doc.registerFont("B", FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageW = doc.page.width;
  const L = 56, R = pageW - 56, W = R - L;
  const company = o.companyName || "Apă-Canal";
  /** Primele pagini ale fiecărei notificări + câte pagini are, pentru subsol („Foaia 2 / 3” în cadrul aceleiași notificări). */
  const spans: { start: number; count: number; name: string }[] = [];

  const header = () => {
    doc.rect(0, 0, pageW, 58).fill(C.brand);
    doc.font("B").fontSize(15).fillColor("#ffffff").text(company, L, 18, { width: W * 0.62, lineBreak: false, ellipsis: true });
    doc.font("R").fontSize(9).fillColor("#ccfbf1").text(`${labels.date}: ${o.today}`, L + W * 0.55, 24, { width: W * 0.45, align: "right", lineBreak: false });
  };

  notices.forEach((n, i) => {
    if (i > 0) doc.addPage();
    const startIdx = doc.bufferedPageRange().count - 1;
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
    if (n.title.trim()) {
      doc.font("B").fontSize(13).fillColor(C.brandDark).text(n.title, L, y, { width: W });
      y = doc.y + 10;
    }
    doc.font("R").fontSize(11).fillColor(C.ink).text(n.text, L, y, { width: W, lineGap: 3 });
    const endIdx = doc.bufferedPageRange().count - 1;
    spans.push({ start: startIdx, count: endIdx - startIdx + 1, name: n.name });
  });

  // subsol pe fiecare foaie
  for (const s of spans) {
    for (let k = 0; k < s.count; k++) {
      doc.switchToPage(s.start + k);
      const bm = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // altfel textul din subsol ar deschide o foaie nouă
      const y = doc.page.height - 40;
      doc.moveTo(L, y - 8).lineTo(R, y - 8).lineWidth(0.5).strokeColor(C.line).stroke();
      doc.font("R").fontSize(8).fillColor(C.soft).text(`${labels.notice} · ${company}`, L, y, { width: W * 0.7, lineBreak: false, ellipsis: true });
      if (s.count > 1) doc.font("R").fontSize(8).fillColor(C.soft).text(`${labels.sheet} ${k + 1} / ${s.count}`, L + W * 0.7, y, { width: W * 0.3, align: "right", lineBreak: false });
      doc.page.margins.bottom = bm;
    }
  }

  doc.end();
  return done;
}
