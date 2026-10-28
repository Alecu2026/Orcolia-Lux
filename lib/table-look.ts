// Culorile tabelelor, alese de utilizator (paleta completă) și salvate în localStorage: antet, text, fundal, rânduri alternate, hover, linii. Cod partajat de toate tabelele.
import type { CSSProperties } from "react";

export type TableColors = {
  headBg?: string;
  headText?: string;
  text?: string;
  rowBg?: string;
  zebraBg?: string;
  hover?: string;
  border?: string;
};

export const COLOR_FIELDS: { key: keyof TableColors; label: string; hint?: string }[] = [
  { key: "headBg", label: "Fundal antet" },
  { key: "headText", label: "Text antet" },
  { key: "text", label: "Text celule" },
  { key: "rowBg", label: "Fundal rânduri" },
  { key: "zebraBg", label: "Fundal rânduri alternate", hint: "Se vede când „Rânduri alternate” e bifat." },
  { key: "hover", label: "Culoare la hover (rândul de sub cursor)" },
  { key: "border", label: "Culoarea liniilor" },
];

/** Culori de pornire (rapide); orice altă culoare se alege din selectorul complet. */
export const PALETTE = [
  "#ffffff", "#f8fafc", "#f1f5f9", "#e2e8f0", "#94a3b8", "#475569", "#1e293b", "#000000",
  "#fee2e2", "#fecaca", "#ef4444", "#b91c1c", "#ffedd5", "#fdba74", "#f97316", "#c2410c",
  "#fef9c3", "#fde047", "#eab308", "#a16207", "#dcfce7", "#86efac", "#22c55e", "#15803d",
  "#ccfbf1", "#5eead4", "#0d9488", "#0f766e", "#dbeafe", "#93c5fd", "#3b82f6", "#1d4ed8",
  "#ede9fe", "#c4b5fd", "#8b5cf6", "#6d28d9", "#fce7f3", "#f9a8d4", "#ec4899", "#be185d",
];

export const asHex = (v: unknown): string | undefined => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : undefined);

export function sanitizeColors(raw: unknown): TableColors {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: TableColors = {};
  for (const f of COLOR_FIELDS) {
    const h = asHex(r[f.key]);
    if (h) out[f.key] = h;
  }
  return out;
}

export const hasColors = (c: TableColors): boolean => Object.values(c).some(Boolean);

/** Variabilele CSS puse pe containerul tabelului (celulele, hover-ul și liniile le citesc; fără ele rămân culorile temei). */
export function colorVars(c: TableColors): CSSProperties {
  const s: Record<string, string> = {};
  if (c.rowBg) s["--dt-row"] = c.rowBg;
  if (c.zebraBg) s["--dt-zebra"] = c.zebraBg;
  if (c.hover) s["--dt-hover"] = c.hover;
  if (c.border) s["--color-line"] = c.border;
  if (c.text) s.color = c.text;
  return s as CSSProperties;
}

/** Stilul antetului (fundal / text), doar pentru ce a ales utilizatorul. */
export const headStyle = (c: TableColors): CSSProperties => ({
  ...(c.headBg ? { backgroundColor: c.headBg } : {}),
  ...(c.headText ? { color: c.headText } : {}),
});

/** Culoare lizibilă (alb / negru) peste un fundal dat — pentru etichete pe culori alese liber. */
export function readableOn(bg: string): string {
  const h = asHex(bg);
  if (!h) return "#000000";
  const n = parseInt(h.slice(1), 16);
  const l = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return l > 150 ? "#000000" : "#ffffff";
}

// ── Aspectul predefinit de administrator (per utilizator) ───────────────────────────────────────────────────────

export const LOOK_DENSITIES = ["compact", "normal", "roomy"] as const;
export const LOOK_FONTS = [10, 11, 13, 15] as const;
export const LOOK_WIDTHS = [85, 100, 125, 150] as const;
export const LOOK_HEADERS = ["default", "brand", "sky", "emerald", "orange", "violet", "slate"] as const;
export const LOOK_TEXTS = ["default", "brand", "sky", "emerald", "violet", "rose"] as const;

/** Aspectul tabelelor setat de administrator pentru un utilizator. Ce lipsește rămâne implicit. Cine NU are „Personalizare tabele” vede exact acest aspect, fără să-l poată schimba. */
export type TableLookPreset = {
  density?: (typeof LOOK_DENSITIES)[number];
  font?: (typeof LOOK_FONTS)[number];
  width?: (typeof LOOK_WIDTHS)[number];
  zebra?: boolean;
  header?: (typeof LOOK_HEADERS)[number];
  text?: (typeof LOOK_TEXTS)[number];
  colors?: TableColors;
};

export function sanitizePreset(raw: unknown): TableLookPreset {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: TableLookPreset = {};
  if ((LOOK_DENSITIES as readonly unknown[]).includes(r.density)) out.density = r.density as TableLookPreset["density"];
  if ((LOOK_FONTS as readonly unknown[]).includes(r.font)) out.font = r.font as TableLookPreset["font"];
  if ((LOOK_WIDTHS as readonly unknown[]).includes(r.width)) out.width = r.width as TableLookPreset["width"];
  if (r.zebra === true) out.zebra = true;
  if ((LOOK_HEADERS as readonly unknown[]).includes(r.header) && r.header !== "default") out.header = r.header as TableLookPreset["header"];
  if ((LOOK_TEXTS as readonly unknown[]).includes(r.text) && r.text !== "default") out.text = r.text as TableLookPreset["text"];
  const c = sanitizeColors(r.colors);
  if (hasColors(c)) out.colors = c;
  return out;
}

export const hasPreset = (p: TableLookPreset): boolean => Object.keys(p).length > 0;
