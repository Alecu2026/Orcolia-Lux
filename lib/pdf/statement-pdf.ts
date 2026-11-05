import "server-only";
import path from "node:path";
import PDFDocument from "pdfkit";
import type { PayerStatement } from "../services/payer-statement";
import type { TFn } from "../i18n/t";

/**
 * Decontarea clientului ca PDF, generată DIRECT pe server (pdfkit), fără Chromium: nu depinde de un browser instalat pe server, deci nu mai dă „Nu am putut genera PDF-ul”.
 * Fontul (DejaVu Sans, inclus în assets/fonts) acoperă română (ă â î ș ț), rusă și engleză. Pagină A4 pe lățime, cu antetul tabelului repetat pe fiecare pagină și numărul paginii în subsol.
 */

const FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");

const C = { brand: "#0d9488", brandDark: "#0f766e", brandSoft: "#ccfbf1", ink: "#0f172a", soft: "#64748b", line: "#e2e8f0", zebra: "#f8fafc", head: "#f1f5f9" };
const STATUS: Record<string, { label: string; fg: string; bg: string }> = {
  DRAFT: { label: "Ciornă", fg: "#475569", bg: "#e2e8f0" },
  SENT: { label: "Trimisă", fg: "#1d4ed8", bg: "#dbeafe" },
  PAID: { label: "Plătită", fg: "#15803d", bg: "#dcfce7" },
  OVERDUE: { label: "Restantă", fg: "#b45309", bg: "#fef3c7" },
  CANCELLED: { label: "Anulată", fg: "#b91c1c", bg: "#fee2e2" },
};

const LOCALES = { ro: "ro-RO", ru: "ru-RU", en: "en-GB" } as const;

export async function buildStatementPdf(o: { statement: PayerStatement; clientName: string; companyName: string; locale: "ro" | "ru" | "en"; t: TFn; today: string }): Promise<Buffer> {
  const { statement, t } = o;
  const nfLocale = LOCALES[o.locale] ?? "ro-RO";
  const money = (n: number) => n.toLocaleString(nfLocale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const vol = (n: number | null) => (n == null ? "—" : n.toLocaleString(nfLocale, { maximumFractionDigits: 3 }));
  const currency = statement.rows[0]?.currency ?? "MDL";
  const amount = (n: number, cur: string) => money(n) + (cur === currency ? "" : ` ${cur}`);

  const doc = new PDFDocument({ size: "A4", layout: "landscape", margins: { top: 28, bottom: 40, left: 28, right: 28 }, bufferPages: true, info: { Title: `${t("Decontare")} — ${o.clientName}`, Author: o.companyName || "Apă-Canal" } });
  doc.registerFont("R", FONT);
  doc.registerFont("B", FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageW = doc.page.width, pageH = doc.page.height;
  const L = 28, R = pageW - 28, W = R - L;
  const bottom = pageH - 44;
  const txt = (s: string, x: number, y: number, w: number, opt: { bold?: boolean; size?: number; color?: string; align?: "left" | "right" | "center" } = {}) => {
    doc.font(opt.bold ? "B" : "R").fontSize(opt.size ?? 9).fillColor(opt.color ?? C.ink).text(s, x, y, { width: w, align: opt.align ?? "left", lineBreak: false, ellipsis: true });
  };

  // ── antet: banda de brand ──
  doc.rect(0, 0, pageW, 62).fill(C.brand);
  txt(o.companyName || "Apă-Canal", L, 14, W * 0.6, { bold: true, size: 15, color: "#ffffff" });
  txt(t("Decontare"), L, 36, W * 0.6, { size: 11, color: "#ccfbf1" });
  txt(`${t("Data generării")}: ${o.today}`, L + W * 0.55, 24, W * 0.45, { size: 9, color: "#ccfbf1", align: "right" });

  // ── clientul + cardurile ──
  txt(o.clientName, L, 76, W, { bold: true, size: 14 });
  const first = statement.rows[0], last = statement.rows[statement.rows.length - 1];
  const period = first && last ? (first.billingPeriodLabel === last.billingPeriodLabel ? (first.billingPeriodLabel ?? "") : `${first.billingPeriodLabel ?? ""} – ${last.billingPeriodLabel ?? ""}`) : "—";
  const acct = statement.client.account;
  const cards: { label: string; value: string; w: number; hi?: boolean }[] = [
    { label: statement.client.accountKind === "contract" ? t("Contract") : t("Cont personal"), value: acct ?? "—", w: 0.17 },
    { label: t("Adresă"), value: statement.client.address ?? "—", w: 0.38 },
    { label: `${t("Perioadă")} · ${statement.rows.length} ${t("facturi")}`, value: period, w: 0.25 },
    { label: t("Total de plată"), value: `${money(statement.totals.grandTotal)} ${currency}`, w: 0.2, hi: true },
  ];
  let cx = L;
  const gap = 8, cy = 98, ch = 40;
  const usable = W - gap * (cards.length - 1);
  for (const c of cards) {
    const cw = usable * c.w;
    doc.roundedRect(cx, cy, cw, ch, 6).fill(c.hi ? C.brandSoft : C.zebra);
    doc.roundedRect(cx, cy, cw, ch, 6).lineWidth(0.6).stroke(c.hi ? C.brand : C.line);
    txt(c.label.toUpperCase(), cx + 9, cy + 7, cw - 18, { size: 6.5, color: C.soft, bold: true });
    txt(c.value, cx + 9, cy + 19, cw - 18, { size: c.hi ? 12 : 9.5, bold: true, color: c.hi ? C.brandDark : C.ink });
    cx += cw + gap;
  }

  // ── tabelul ──
  const cols = [
    { k: "period", h: t("Perioadă"), w: 104, a: "left" as const },
    { k: "prev", h: t("Index ant."), w: 50, a: "right" as const },
    { k: "curr", h: t("Index curent"), w: 50, a: "right" as const },
    { k: "apa", h: t("Apă (m³)"), w: 42, a: "right" as const },
    { k: "canal", h: t("Canal (m³)"), w: 42, a: "right" as const },
    { k: "calc", h: t("Calculat ({currency})", { currency }), w: 72, a: "right" as const },
    { k: "sold", h: t("Sold anterior / regularizare"), w: 82, a: "right" as const },
    { k: "recalc", h: t("Recalculări"), w: 62, a: "right" as const },
    { k: "pen", h: t("Penalități"), w: 58, a: "right" as const },
    { k: "total", h: t("Total de plată"), w: 78, a: "right" as const },
    { k: "prevPaid", h: t("Plătit înainte de factură"), w: 68, a: "right" as const },
    { k: "paid", h: t("Achitat din factură"), w: 68, a: "right" as const },
    { k: "status", h: t("Status"), w: 62, a: "center" as const },
  ];
  const sum = cols.reduce((a, c) => a + c.w, 0);
  const scale = W / sum;
  for (const c of cols) c.w *= scale;
  const xs: number[] = [];
  { let x = L; for (const c of cols) { xs.push(x); x += c.w; } }

  const PAD = 5;
  let y = cy + ch + 14;
  const header = () => {
    const h = 30;
    doc.rect(L, y, W, h).fill(C.head);
    cols.forEach((c, i) => {
      doc.font("B").fontSize(7).fillColor(C.soft).text(c.h.toUpperCase(), xs[i] + PAD, y + 6, { width: c.w - PAD * 2, align: c.a, height: h - 8, ellipsis: true });
    });
    doc.moveTo(L, y + h).lineTo(R, y + h).lineWidth(0.8).stroke(C.line);
    y += h;
  };
  header();

  const rowH = 30;
  const newPage = () => {
    doc.addPage();
    y = 36;
    header();
  };
  statement.rows.forEach((r, idx) => {
    if (y + rowH > bottom) newPage();
    if (idx % 2 === 1) doc.rect(L, y, W, rowH).fill(C.zebra);
    const st = STATUS[r.status] ?? STATUS.SENT;
    const cell = (i: number, s: string, bold = false) => txt(s, xs[i] + PAD, y + 10, cols[i].w - PAD * 2, { bold, size: 8.5, align: cols[i].a });
    txt(r.billingPeriodLabel ?? new Date(r.issueDate).toLocaleDateString(nfLocale), xs[0] + PAD, y + 6, cols[0].w - PAD * 2, { bold: true, size: 8.5, color: C.brandDark });
    txt(r.number, xs[0] + PAD, y + 17, cols[0].w - PAD * 2, { size: 7, color: C.soft });
    cell(1, r.meterPrevReading ?? "—"); cell(2, r.meterCurrReading ?? "—"); cell(3, vol(r.apaQty)); cell(4, vol(r.canalQty));
    cell(5, amount(r.subtotal, r.currency)); cell(6, amount(r.datoriiAvans, r.currency)); cell(7, amount(r.recalculari, r.currency)); cell(8, amount(r.penalitati, r.currency));
    cell(9, amount(r.grandTotal, r.currency), true);
    cell(10, r.prevPaid == null ? "—" : amount(r.prevPaid, r.currency)); cell(11, r.paidAmount == null ? "—" : amount(r.paidAmount, r.currency));
    // status ca „pastilă”
    const label = t(st.label);
    const pw = Math.min(cols[12].w - 8, doc.font("B").fontSize(7).widthOfString(label) + 14);
    const px = xs[12] + (cols[12].w - pw) / 2;
    doc.roundedRect(px, y + 8, pw, 14, 7).fill(st.bg);
    txt(label, px, y + 12, pw, { bold: true, size: 7, color: st.fg, align: "center" });
    doc.moveTo(L, y + rowH).lineTo(R, y + rowH).lineWidth(0.4).stroke(C.line);
    y += rowH;
  });

  // ── TOTAL ──
  if (y + rowH + 6 > bottom) newPage();
  const tot = statement.totals;
  doc.rect(L, y, W, rowH).fill(C.brandSoft);
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1).stroke(C.brand);
  const tcell = (i: number, s: string) => txt(s, xs[i] + PAD, y + 10, cols[i].w - PAD * 2, { bold: true, size: 9, color: C.brandDark, align: cols[i].a });
  tcell(0, t("TOTAL")); tcell(3, vol(tot.apaQty)); tcell(4, vol(tot.canalQty)); tcell(5, money(tot.subtotal)); tcell(6, money(tot.datoriiAvans));
  tcell(7, money(tot.recalculari)); tcell(8, money(tot.penalitati)); tcell(9, money(tot.grandTotal)); tcell(10, money(tot.paid));
  y += rowH;

  // ── subsol: companie + pagina x / y ──
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // altfel textul din subsol ar deschide o pagină nouă
    doc.moveTo(L, pageH - 30).lineTo(R, pageH - 30).lineWidth(0.4).stroke(C.line);
    txt(o.companyName || "Apă-Canal", L, pageH - 24, W * 0.6, { size: 7.5, color: C.soft });
    txt(t("Pagina {a} / {b}", { a: i + 1, b: range.count }), L + W * 0.6, pageH - 24, W * 0.4, { size: 7.5, color: C.soft, align: "right" });
  }
  doc.end();
  return done;
}
