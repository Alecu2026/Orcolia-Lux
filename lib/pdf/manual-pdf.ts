import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { Block, ManualSection, Shot } from "../manual/types";
import { AUTHOR } from "../credits";
import { BRAND_LOGO_JPEG_BASE64 } from "./brand-logo";
import { ICONS } from "../manual/icon-data";

/**
 * „Manual de utilizare pentru administrator” ca PDF A4, generat direct pe server cu pdfkit (același motor ca decontarea și facturile; fără browser): copertă, cuprins cu numere de pagină,
 * apoi fiecare secțiune și pagină explicată pas cu pas. Pozele încărcate se includ ca imagini; locurile fără poză apar ca un cadru galben cu instrucțiunea (sau lipsesc, cu `placeholders: false`).
 * Fără emoji: iconițele (secțiuni, sfaturi, atenționări, cadre pentru poze) sunt desenate vectorial din aceleași date ca în pagină (lib/manual/icon-data.ts).
 */

const FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const C = { brand: "#0d9488", brandDark: "#0f766e", brandSoft: "#ccfbf1", ink: "#0f172a", soft: "#64748b", line: "#cbd5e1", tipBg: "#ecfdf5", tipLine: "#6ee7b7", tipInk: "#047857", warnBg: "#fffbeb", warnLine: "#f59e0b", warnInk: "#b45309", shotBg: "#fffbeb", shotLine: "#f59e0b" };

/** Emoji și semne care lipsesc din font: scoase (în PDF contează textul). */
const clean = (s: string): string => s.replace(/[\p{Extended_Pictographic}️‍]/gu, "").replace(/ {2,}/g, " ").trim();

export type ManualImage = { buf: Buffer };

export async function buildManualPdf(o: {
  companyName: string;
  today: string;
  sections: ManualSection[];
  /** poza fiecărui loc (JPEG / PNG deja pregătit), după cheie */
  images: Map<string, ManualImage>;
  /** locurile fără poză: cadru galben cu instrucțiunea (true) sau nimic (false) */
  placeholders: boolean;
  shotsTotal: number;
  /** cine citește: titlul și coperta spun „pentru administrator” sau „pentru utilizator” */
  audience?: "administrator" | "utilizator";
}): Promise<Buffer> {
  const { sections, images } = o;
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 64, bottom: 64, left: 56, right: 56 },
    bufferPages: true,
    info: { Title: `AquaCRM · Manual de utilizare pentru ${o.audience ?? "administrator"}`, Author: AUTHOR.name, Creator: `${AUTHOR.name} · ${AUTHOR.siteLabel}` },
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
  const pageH = doc.page.height;
  const L = 56, R = pageW - 56, W = R - L;
  const TOP = 64;
  const bottomY = () => pageH - 64;
  const company = o.companyName || "Apă-Canal";

  /** Dacă n-ai loc pentru încă `h` puncte, trece pe foaia următoare. */
  const ensure = (h: number) => {
    if (doc.y + h > bottomY()) {
      doc.addPage();
      doc.x = L;
      doc.y = TOP;
    }
  };
  const text = (s: string, size: number, font: "R" | "B", color: string, x: number, y: number, width: number, extra: PDFKit.Mixins.TextOptions = {}) =>
    doc.font(font).fontSize(size).fillColor(color).text(clean(s), x, y, { width, ...extra });
  const hOf = (s: string, size: number, font: "R" | "B", width: number, lineGap = 0) => {
    doc.font(font).fontSize(size);
    return doc.heightOfString(clean(s), { width, lineGap });
  };

  /** Iconiță vectorială (doar contur) în pătratul de latură `size`, colț stânga-sus (x, y). */
  const icon = (name: string, x: number, y: number, size: number, color: string, weight = 1.8) => {
    const els = ICONS[name] ?? ICONS.book;
    doc.save();
    doc.translate(x, y).scale(size / 24);
    doc.lineWidth(weight).lineCap("round").lineJoin("round").strokeColor(color);
    for (const el of els) {
      if ("p" in el) doc.path(el.p).stroke();
      else if ("c" in el) doc.circle(el.c[0], el.c[1], el.c[2]).stroke();
      else doc.roundedRect(el.r[0], el.r[1], el.r[2], el.r[3], el.r[4]).stroke();
    }
    doc.restore();
  };

  // ── cuprinsul: înălțimile rândurilor, ca să rezervăm exact foile lui înainte de conținut ──
  type TocEntry = { level: 0 | 1; num: string; title: string; page: number; icon?: string };
  const toc: TocEntry[] = [];
  const SEC_H = 30; // rând de secțiune (cu spațiul de deasupra)
  const PG_H = 16.5;
  const FIRST_TOP = TOP + 50; // pe prima foaie, sub titlul „Cuprins”
  let tocPages = 1;
  {
    let y = FIRST_TOP;
    for (const s of sections) {
      if (y + SEC_H > bottomY()) { tocPages++; y = TOP; }
      y += SEC_H;
      for (let i = 0; i < s.pages.length; i++) {
        if (y + PG_H > bottomY()) { tocPages++; y = TOP; }
        y += PG_H;
      }
    }
  }

  // ── coperta ──
  const band = doc.linearGradient(0, 0, pageW, 250);
  band.stop(0, "#0a3fb5").stop(1, "#02154f");
  doc.rect(0, 0, pageW, 250).fill(band);
  // sigla AquaCRM (pătrat rotunjit) + numele mare, pe două culori ca în siglă
  doc.save();
  doc.roundedRect(L, 44, 112, 112, 24).clip();
  doc.image(Buffer.from(BRAND_LOGO_JPEG_BASE64, "base64"), L, 44, { width: 112, height: 112 });
  doc.restore();
  const nameX = L + 134;
  text("Aqua", 58, "B", "#ffffff", nameX, 62, W, { lineBreak: false });
  const aquaW = (doc.font("B").fontSize(58), doc.widthOfString("Aqua"));
  text("CRM", 58, "B", "#33ccff", nameX + aquaW, 62, W, { lineBreak: false });
  text(company, 12, "B", "#bfe3ff", nameX + 2, 130, W - 134, { lineBreak: false, ellipsis: true });
  text("Manual de utilizare", 30, "B", "#ffffff", L, 176, W);
  text(`pentru ${o.audience ?? "administrator"}`, 17, "R", "#d6ecff", L, 214, W);
  text("Cum folosești fiecare pagină a aplicației, pas cu pas, pe înțelesul tuturor.", 12, "R", C.ink, L, 290, W, { lineGap: 3 });
  text(`Versiunea din ${o.today}`, 10, "R", C.soft, L, 340, W);
  // semnătura autorului, jos pe copertă
  doc.moveTo(L, pageH - 150).lineTo(R, pageH - 150).lineWidth(0.5).strokeColor(C.line).stroke();
  text("Elaborat de", 9, "R", C.soft, L, pageH - 138, W);
  text(AUTHOR.name, 15, "B", C.ink, L, pageH - 124, W);
  text(`${AUTHOR.siteLabel}  ·  tel. ${AUTHOR.phone}`, 11, "R", C.brand, L, pageH - 102, W);
  doc.link(L, pageH - 104, 190, 16, AUTHOR.site);
  const have = images.size;
  if (o.placeholders && have < o.shotsTotal) {
    text(`Notă: ${o.shotsTotal - have} din ${o.shotsTotal} locuri pentru poze sunt încă goale (cadrele galbene).`, 10, "R", C.warnInk, L, 362, W);
  }

  // ── foile cuprinsului (rezervate; se completează la final) ──
  for (let i = 0; i < tocPages; i++) doc.addPage();

  // ── conținutul ──
  const startContent = () => {
    doc.addPage();
    doc.x = L;
    doc.y = TOP;
  };

  const drawShot = (s: Shot) => {
    const img = images.get(s.key);
    if (img) {
      let iw = 0, ih = 0;
      try {
        const o2 = (doc as unknown as { openImage(b: Buffer): { width: number; height: number } }).openImage(img.buf);
        iw = o2.width;
        ih = o2.height;
      } catch {
        iw = 0;
      }
      if (iw > 0 && ih > 0) {
        const maxH = pageH - TOP - 64 - 40;
        let dw = Math.min(W, iw);
        let dh = (dw * ih) / iw;
        if (dh > maxH) {
          dh = maxH;
          dw = (dh * iw) / ih;
        }
        const cap = hOf(s.caption, 8.5, "R", W);
        ensure(dh + cap + 12);
        const y = doc.y + 2;
        doc.image(img.buf, L, y, { width: dw, height: dh });
        doc.rect(L, y, dw, dh).lineWidth(0.6).strokeColor(C.line).stroke();
        text(s.caption, 8.5, "R", C.soft, L, y + dh + 4, W);
        doc.y = y + dh + cap + 12;
        doc.x = L;
        return;
      }
    }
    if (!o.placeholders) return;
    const lines = [
      { t: "Aici pui poza", f: "B" as const, s: 10.5 },
      { t: `De unde faci poza: ${s.where}`, f: "R" as const, s: 9.5 },
      { t: `Ce trebuie să se vadă în poză: ${s.caption}`, f: "R" as const, s: 9.5 },
    ];
    const inner = W - 24;
    const h = lines.reduce((n, l) => n + hOf(l.t, l.s, l.f, l === lines[0] ? inner - 24 : inner, 1.5) + 3, 0) + 18;
    ensure(h + 8);
    const y = doc.y + 2;
    doc.save();
    doc.roundedRect(L, y, W, h, 6).fill(C.shotBg);
    doc.roundedRect(L, y, W, h, 6).dash(4, { space: 3 }).lineWidth(1).strokeColor(C.shotLine).stroke().undash();
    doc.restore();
    icon("camera", L + 12, y + 8, 16, C.warnInk, 1.8);
    let ty = y + 9;
    lines.forEach((l, i) => {
      text(l.t, l.s, l.f, C.ink, L + (i === 0 ? 36 : 12), ty, i === 0 ? inner - 24 : inner, { lineGap: 1.5 });
      ty = doc.y + 3;
    });
    doc.y = y + h + 8;
    doc.x = L;
  };

  const drawBlock = (b: Block) => {
    switch (b.t) {
      case "p": {
        ensure(Math.min(hOf(b.text, 10.5, "R", W, 2.5), 60));
        text(b.text, 10.5, "R", C.ink, L, doc.y, W, { lineGap: 2.5 });
        doc.y += 6;
        break;
      }
      case "steps": {
        if (b.title) {
          ensure(40);
          text(b.title, 10.5, "B", C.ink, L, doc.y, W);
          doc.y += 4;
        }
        b.items.forEach((it, i) => {
          const h = hOf(it, 10.5, "R", W - 28, 2.5);
          ensure(Math.min(h, 160) + 4);
          const y = doc.y;
          doc.circle(L + 9, y + 8, 8).fill(C.brand);
          text(String(i + 1), 8.5, "B", "#ffffff", L + 1, y + 4.5, 16, { align: "center", lineBreak: false });
          text(it, 10.5, "R", C.ink, L + 28, y, W - 28, { lineGap: 2.5 });
          doc.y = Math.max(doc.y, y + 18) + 5;
          doc.x = L;
        });
        doc.y += 3;
        break;
      }
      case "list": {
        if (b.title) {
          ensure(40);
          text(b.title, 10.5, "B", C.ink, L, doc.y, W);
          doc.y += 4;
        }
        for (const it of b.items) {
          const h = hOf(it, 10.5, "R", W - 18, 2.5);
          ensure(Math.min(h, 160) + 2);
          const y = doc.y;
          doc.circle(L + 5, y + 6.5, 2).fill(C.brand);
          text(it, 10.5, "R", C.ink, L + 16, y, W - 16, { lineGap: 2.5 });
          doc.y += 3;
          doc.x = L;
        }
        doc.y += 3;
        break;
      }
      case "tip":
      case "warn": {
        const isTip = b.t === "tip";
        const label = isTip ? "Sfat: " : "Atenție: ";
        const inner = W - 24 - 22;
        const h = Math.max(hOf(label + b.text, 10, "R", inner, 2) + 16, 34);
        ensure(h + 8);
        const y = doc.y + 2;
        doc.roundedRect(L, y, W, h, 6).fillAndStroke(isTip ? C.tipBg : C.warnBg, isTip ? C.tipLine : C.warnLine);
        icon(isTip ? "bulb" : "alert", L + 10, y + 9, 16, isTip ? C.tipInk : C.warnInk, 1.8);
        doc.font("B").fontSize(10).fillColor(C.ink).text(label, L + 34, y + 8, { width: inner, continued: true, lineGap: 2 });
        doc.font("R").fontSize(10).text(clean(b.text), { lineGap: 2 });
        doc.y = y + h + 8;
        doc.x = L;
        break;
      }
      case "shot":
        drawShot(b.shot);
        break;
    }
  };

  sections.forEach((s, si) => {
    startContent();
    toc.push({ level: 0, num: String(si + 1), title: clean(s.title), page: doc.bufferedPageRange().count, icon: s.icon });
    // antetul secțiunii: pătrat colorat cu iconița, „SECȚIUNEA n” și titlul
    const y0 = doc.y;
    doc.roundedRect(L, y0, 40, 40, 9).fill(C.brand);
    icon(s.icon, L + 8, y0 + 8, 24, "#ffffff", 1.7);
    text(`SECȚIUNEA ${si + 1}`, 8.5, "B", C.soft, L + 52, y0 + 2, W - 52, { characterSpacing: 0.8 });
    text(s.title, 21, "B", C.brand, L + 52, y0 + 14, W - 52, { lineBreak: false, ellipsis: true });
    doc.y = y0 + 50;
    doc.moveTo(L, doc.y).lineTo(R, doc.y).lineWidth(1.2).strokeColor(C.brand).stroke();
    doc.y += 10;
    if (s.intro) {
      text(s.intro, 11, "R", C.soft, L, doc.y, W, { lineGap: 3 });
      doc.y += 12;
    }
    s.pages.forEach((pg, pi) => {
      ensure(90);
      toc.push({ level: 1, num: `${si + 1}.${pi + 1}`, title: clean(pg.title), page: doc.bufferedPageRange().count });
      const ty = doc.y;
      text(`${si + 1}.${pi + 1}`, 10, "B", C.brand, L, ty + 4.5, 34, { lineBreak: false });
      text(pg.title, 15, "B", C.brandDark, L + 34, ty, W - 34);
      doc.y += 2;
      const meta = [pg.who, pg.path ? `Pagina din aplicație: ${pg.path}` : ""].filter(Boolean).join("  ·  ");
      if (meta) {
        text(meta, 8.5, "R", C.soft, L + 34, doc.y, W - 34);
        doc.y += 2;
      }
      doc.moveTo(L, doc.y + 2).lineTo(R, doc.y + 2).lineWidth(0.6).strokeColor(C.line).stroke();
      doc.y += 9;
      for (const b of pg.blocks) drawBlock(b);
      doc.y += 10;
    });
  });

  // ── cuprinsul (pe foile rezervate) și subsolul ──
  const total = doc.bufferedPageRange().count;
  const withBottomZero = (fn: () => void) => {
    const bm = doc.page.margins.bottom;
    doc.page.margins.bottom = 0; // altfel textul scris aproape de margine ar deschide o foaie nouă
    fn();
    doc.page.margins.bottom = bm;
  };
  /** Puncte de legătură de la titlu la numărul paginii. */
  const leader = (x1: number, x2: number, y: number) => {
    if (x2 - x1 < 14) return;
    doc.save();
    doc.moveTo(x1 + 4, y).lineTo(x2 - 4, y).dash(0.5, { space: 2.8 }).lineWidth(0.9).lineCap("round").strokeColor(C.line).stroke();
    doc.undash();
    doc.restore();
  };
  let idx = 0;
  for (let tp = 0; tp < tocPages; tp++) {
    doc.switchToPage(1 + tp);
    withBottomZero(() => {
      let y = TOP;
      if (tp === 0) {
        doc.roundedRect(L, y - 4, 34, 34, 8).fill(C.brand);
        icon("book", L + 7, y + 3, 20, "#ffffff", 1.7);
        text("Cuprins", 24, "B", C.brand, L + 46, y, W - 46, { lineBreak: false });
        text("Apasă pe un titlu din cuprinsul din aplicație ca să sari direct la pagină.", 8.5, "R", C.soft, L + 46, y + 28, W - 46, { lineBreak: false });
        y = FIRST_TOP;
      }
      while (idx < toc.length) {
        const e = toc[idx];
        const need = e.level === 0 ? SEC_H : PG_H;
        if (y + need > bottomY()) break;
        idx++;
        if (e.level === 0) {
          // secțiune: cerc cu iconița, titlu îngroșat, număr de pagină
          const cy = y + 12;
          doc.circle(L + 11, cy, 11).fill(C.brand);
          icon(e.icon ?? "book", L + 4, cy - 7, 14, "#ffffff", 2);
          const tw = (doc.font("B").fontSize(11.5), doc.widthOfString(e.title));
          text(`${e.num}. ${e.title}`, 11.5, "B", C.ink, L + 30, cy - 7, W - 100, { lineBreak: false, ellipsis: true });
          const endX = L + 30 + tw + doc.widthOfString(`${e.num}. `) + 4;
          text(String(e.page), 11.5, "B", C.brand, R - 40, cy - 7, 40, { align: "right", lineBreak: false });
          leader(endX, R - 40, cy + 3);
          y += SEC_H;
        } else {
          const cy = y + 3;
          text(e.num, 8.5, "B", C.brand, L + 30, cy, 30, { lineBreak: false });
          text(e.title, 9.5, "R", C.soft, L + 56, cy, W - 56 - 50, { lineBreak: false, ellipsis: true });
          const endX = L + 56 + (doc.font("R").fontSize(9.5), doc.widthOfString(e.title));
          text(String(e.page), 9.5, "R", C.soft, R - 40, cy, 40, { align: "right", lineBreak: false });
          leader(endX, R - 40, cy + 8);
          y += PG_H;
        }
      }
    });
  }
  for (let i = 1; i < total; i++) {
    doc.switchToPage(i);
    withBottomZero(() => {
      const y = pageH - 40;
      doc.moveTo(L, y - 8).lineTo(R, y - 8).lineWidth(0.5).strokeColor(C.line).stroke();
      text(`AquaCRM · Manual de utilizare · ${company} · ${AUTHOR.name}, ${AUTHOR.phone}`, 8, "R", C.soft, L, y, W * 0.7, { lineBreak: false, ellipsis: true });
      text(`Pagina ${i + 1} / ${total}`, 8, "R", C.soft, L + W * 0.7, y, W * 0.3, { align: "right", lineBreak: false });
    });
  }

  doc.end();
  return done;
}
