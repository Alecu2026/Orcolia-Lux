// Suprascrieri poziție/mărime pentru editorul vizual al facturii Apă-Canal.
// Fiecare element de pe factură poate fi mutat/redimensionat liber (px<->mm, react-rnd) și,
// dacă e text, poate avea și mărime font + bold suprascrise.

export type ApaCanalElementKey =
  | "title"
  | "titleLine"
  | "datesBlock"
  | "contPersonalBlock"
  | "logo"
  | "chart"
  | "meterTable"
  | "companyInfoText"
  | "billingPeriodText"
  | "servicesTable"
  | "recalculariText"
  | "totalsConnectorLine"
  | "totalsBox"
  | "atentieBox"
  | "anuntBox"
  | "contacteBlock";

export type ApaCanalElementOverride = {
  xMm?: number;
  yMm?: number;
  widthMm?: number;
  heightMm?: number;
  fontSizeMm?: number;
  bold?: boolean;
  /**
   * Text personalizat — dacă e setat, înlocuiește complet conținutul normal al elementului
   * (o linie per paragraf). Util pentru texte fixe (titlu, etichete "ATENȚIE!"/"Anunț!"), dar
   * ATENȚIE: pe elementele care afișează date live ale facturii (sume, indici, tabele), textul
   * suprascris rămâne fix identic pe TOATE facturile — nu recomandat acolo.
   */
  textOverride?: string;
};

export type ApaCanalLayout = Partial<Record<ApaCanalElementKey, ApaCanalElementOverride>> & {
  /** Fotografii adăugate liber pe factură (poziționabile/redimensionabile ca orice element). */
  customImages?: ApaCanalCustomImage[];
};

export type ApaCanalCustomImage = {
  id: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  dataUrl: string;
};

export const APA_CANAL_ELEMENT_LABELS: Record<ApaCanalElementKey, string> = {
  title: "Titlu factură",
  titleLine: "Linia de sub titlu",
  datesBlock: "Data emiterii / limită",
  contPersonalBlock: "Cont personal / adresă / nume",
  logo: "Logo",
  chart: "Grafic consum",
  meterTable: "Tabel contor",
  companyInfoText: "Text companie (adresă/email/nume/cod fiscal)",
  billingPeriodText: "Perioada de calcul",
  servicesTable: "Tabel servicii",
  recalculariText: "Text Recalculări/Penalitate",
  totalsConnectorLine: "Linia spre caseta de total",
  totalsBox: "Caseta de total",
  atentieBox: "Casetă „Atenție”",
  anuntBox: "Casetă „Anunț”",
  contacteBlock: "Bloc Contacte",
};

/** Elemente care au și mărime font + bold editabile (pe lângă poziție/mărime). */
export const APA_CANAL_TEXT_KEYS: ApaCanalElementKey[] = [
  "title",
  "datesBlock",
  "contPersonalBlock",
  "companyInfoText",
  "meterTable",
  "billingPeriodText",
  "servicesTable",
  "recalculariText",
  "totalsBox",
  "atentieBox",
  "anuntBox",
  "contacteBlock",
];

/**
 * Mărimea de font implicită (mm) a fiecărui element de text, folosită ca bază de scalare atunci
 * când utilizatorul redimensionează caseta (trăgând de colț) — fără asta, textul rămâne mereu la
 * mărimea lui implicită indiferent cât de mult crește caseta, dând impresia că "doar rama se
 * mărește, nu și textul".
 */
export const APA_CANAL_DEFAULT_FONT_MM: Partial<Record<ApaCanalElementKey, number>> = {
  title: 4,
  datesBlock: 3,
  contPersonalBlock: 3.6,
  companyInfoText: 4,
  meterTable: 3.6,
  billingPeriodText: 3,
  servicesTable: 2.9,
  recalculariText: 2.9,
  totalsBox: 2.9,
  atentieBox: 2.8,
  anuntBox: 2.7,
  contacteBlock: 2.7,
};

/** Poziții/mărimi implicite (mm), folosite doar ca punct de plecare în editor înainte de prima ajustare. */
export const APA_CANAL_LAYOUT_DEFAULTS: Record<ApaCanalElementKey, Required<Pick<ApaCanalElementOverride, "xMm" | "yMm" | "widthMm" | "heightMm">>> = {
  // Valori MĂSURATE pe factura reală (fără șablon, A4 landscape, 2 servicii) — nu estimări. Logo-ul și ce depinde de el depind de imaginea încărcată;
  // editorul le măsoară din nou cu logo-ul real, iar la salvare le scrie explicit.
  title: { xMm: 5, yMm: 5, widthMm: 292, heightMm: 6 },
  titleLine: { xMm: 5, yMm: 11.5, widthMm: 227, heightMm: 3 },
  datesBlock: { xMm: 5, yMm: 16.1, widthMm: 130.2, heightMm: 10.2 },
  contPersonalBlock: { xMm: 140.2, yMm: 16.1, widthMm: 73, heightMm: 24.5 },
  logo: { xMm: 218.2, yMm: 13.6, widthMm: 78.8, heightMm: 40 },
  chart: { xMm: 5, yMm: 43.6, widthMm: 130.2, heightMm: 47.9 },
  meterTable: { xMm: 140.2, yMm: 43.6, widthMm: 73, heightMm: 17.2 },
  companyInfoText: { xMm: 218.2, yMm: 43.6, widthMm: 78.8, heightMm: 18.4 },
  billingPeriodText: { xMm: 5, yMm: 94.5, widthMm: 209.5, heightMm: 4.5 },
  servicesTable: { xMm: 5, yMm: 101.5, widthMm: 209.5, heightMm: 18 },
  recalculariText: { xMm: 5, yMm: 124.9, widthMm: 15.2, heightMm: 10.7 },
  totalsConnectorLine: { xMm: 5, yMm: 133.7, widthMm: 148.5, heightMm: 3 },
  totalsBox: { xMm: 156.5, yMm: 124.9, widthMm: 58, heightMm: 20.3 },
  atentieBox: { xMm: 5, yMm: 147.7, widthMm: 209.5, heightMm: 28.8 },
  anuntBox: { xMm: 219.5, yMm: 94.5, widthMm: 77.5, heightMm: 27.1 },
  contacteBlock: { xMm: 219.5, yMm: 124.6, widthMm: 77.5, heightMm: 34.2 },
};

export const MM_TO_PX = 96 / 25.4;

export const round1 = (n: number) => Math.round(n * 10) / 10;
/** Geometria (mm) se păstrează la 0,01 mm (~0,04 px): destul de fin ca factura salvată să fie identică cu cea măsurată. */
export const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Dimensiunea paginii, limite și protecții ───────────────────────────────────────────────────

/** Pagina facturii: A4 landscape, exact ca în PDF (`@page { size: A4 landscape }`). */
export const PAGE_W_MM = 297;
export const PAGE_H_MM = 210;

export const ALL_ELEMENT_KEYS = Object.keys(APA_CANAL_ELEMENT_LABELS) as ApaCanalElementKey[];

/** Liniile decorative: au zonă de prindere de 3mm, dar pot fi foarte joase. */
export const APA_CANAL_LINE_KEYS: ApaCanalElementKey[] = ["titleLine", "totalsConnectorLine"];

export const FONT_MIN_MM = 1.5;
export const FONT_MAX_MM = 24;
export const MAX_CUSTOM_IMAGES = 10;
export const MAX_IMAGE_DATA_URL = 3_500_000;
export const MAX_TEXT_OVERRIDE = 3000;

/** Dimensiunea minimă (mm) sub care un element nu mai poate fi nici văzut, nici prins cu mouse-ul. */
export function minSizeMm(key: ApaCanalElementKey | "image"): { w: number; h: number } {
  if (key === "image") return { w: 5, h: 5 };
  return APA_CANAL_LINE_KEYS.includes(key) ? { w: 5, h: 1 } : { w: 8, h: 3 };
}

export type BoxMm = { xMm: number; yMm: number; widthMm: number; heightMm: number };

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.min(max, Math.max(min, v));
}

/** Aduce o casetă în pagină: dimensiune între minim și pagina întreagă, poziție care nu o scoate din pagină. Nu aruncă niciodată. */
export function clampBox(box: BoxMm, min: { w: number; h: number }): BoxMm {
  const w = clamp(box.widthMm, min.w, PAGE_W_MM);
  const h = clamp(box.heightMm, min.h, PAGE_H_MM);
  return {
    widthMm: round2(w),
    heightMm: round2(h),
    xMm: round2(clamp(box.xMm, 0, PAGE_W_MM - w)),
    yMm: round2(clamp(box.yMm, 0, PAGE_H_MM - h)),
  };
}

const finite = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/**
 * Curăță un șablon venit de oriunde (formularul, baza de date, un import): doar cheile cunoscute, doar numere finite,
 * totul în limitele paginii, texte și imagini cu plafon de mărime. Nu aruncă niciodată — o valoare stricată dispare,
 * iar elementul revine la poziția/mărimea implicită, deci o factură nu poate ieși ruptă dintr-un șablon corupt.
 */
export function sanitizeApaCanalLayout(input: unknown): ApaCanalLayout {
  const out: ApaCanalLayout = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  const src = input as Record<string, unknown>;

  for (const key of ALL_ELEMENT_KEYS) {
    const raw = src[key];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const min = minSizeMm(key);
    const base = APA_CANAL_LAYOUT_DEFAULTS[key];
    const o: ApaCanalElementOverride = {};
    const w = finite(r.widthMm);
    const h = finite(r.heightMm);
    const x = finite(r.xMm);
    const y = finite(r.yMm);
    if (w !== undefined) o.widthMm = round2(clamp(w, min.w, PAGE_W_MM));
    if (h !== undefined) o.heightMm = round2(clamp(h, min.h, PAGE_H_MM));
    if (x !== undefined) o.xMm = round2(clamp(x, 0, PAGE_W_MM - (o.widthMm ?? base.widthMm)));
    if (y !== undefined) o.yMm = round2(clamp(y, 0, PAGE_H_MM - (o.heightMm ?? base.heightMm)));
    if (APA_CANAL_TEXT_KEYS.includes(key)) {
      const fs = finite(r.fontSizeMm);
      if (fs !== undefined && fs > 0) o.fontSizeMm = round1(clamp(fs, FONT_MIN_MM, FONT_MAX_MM));
      if (r.bold === true) o.bold = true;
      if (typeof r.textOverride === "string" && r.textOverride.trim() !== "") o.textOverride = r.textOverride.slice(0, MAX_TEXT_OVERRIDE);
    }
    if (Object.keys(o).length) out[key] = o;
  }

  if (Array.isArray(src.customImages)) {
    const images: ApaCanalCustomImage[] = [];
    for (const raw of src.customImages.slice(0, MAX_CUSTOM_IMAGES)) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.dataUrl !== "string" || !r.dataUrl.startsWith("data:image/") || r.dataUrl.length > MAX_IMAGE_DATA_URL) continue;
      const box = clampBox(
        {
          xMm: finite(r.xMm) ?? 100,
          yMm: finite(r.yMm) ?? 80,
          widthMm: finite(r.widthMm) ?? 60,
          heightMm: finite(r.heightMm) ?? 60,
        },
        minSizeMm("image"),
      );
      images.push({ id: typeof r.id === "string" && r.id ? r.id.slice(0, 64) : `img-${images.length}`, dataUrl: r.dataUrl, ...box });
    }
    if (images.length) out.customImages = images;
  }
  return out;
}

/** Șablon complet: pentru FIECARE element, poziție + mărime explicite (din `defaults`, apoi din suprascrieri). Salvat așa, factura nu mai depinde de nimic implicit. */
export function completeApaCanalLayout(
  layout: ApaCanalLayout,
  defaults: Partial<Record<ApaCanalElementKey, BoxMm>> = {},
): ApaCanalLayout {
  const out: ApaCanalLayout = { ...layout };
  for (const key of ALL_ELEMENT_KEYS) {
    const base = defaults[key] ?? APA_CANAL_LAYOUT_DEFAULTS[key];
    const o = layout[key] ?? {};
    out[key] = {
      ...o,
      xMm: o.xMm ?? base.xMm,
      yMm: o.yMm ?? base.yMm,
      widthMm: o.widthMm ?? base.widthMm,
      heightMm: o.heightMm ?? base.heightMm,
    };
  }
  return sanitizeApaCanalLayout(out);
}

// ── Variabile pentru texte personalizate ───────────────────────────────────────────────────────

export type ApaCanalVariable = { key: string; label: string; group: string };

/** Variabilele care se pot scrie în „Text personalizat”, ca {cont}: se înlocuiesc cu valorile REALE ale fiecărei facturi. */
export const APA_CANAL_VARIABLES: ApaCanalVariable[] = [
  { key: "numar", label: "Număr factură", group: "Factură" },
  { key: "emitere", label: "Data emiterii", group: "Factură" },
  { key: "scadenta", label: "Data limită de achitare", group: "Factură" },
  { key: "perioada", label: "Perioada de calcul", group: "Factură" },
  { key: "valuta", label: "Valută", group: "Factură" },
  { key: "cont", label: "Cont personal", group: "Consumator" },
  { key: "sector", label: "Sector", group: "Consumator" },
  { key: "consumator", label: "Nume consumator", group: "Consumator" },
  { key: "adresa", label: "Adresa locului de consum", group: "Consumator" },
  { key: "contor", label: "Număr contor", group: "Contor" },
  { key: "indPrec", label: "Indici precedenți", group: "Contor" },
  { key: "indAct", label: "Indici actuali", group: "Contor" },
  { key: "volumEst", label: "Volum estimativ (DA / gol)", group: "Contor" },
  { key: "apaVolum", label: "Apă — volum, m³", group: "Servicii" },
  { key: "apaTarif", label: "Apă — tarif, lei/m³", group: "Servicii" },
  { key: "apaSuma", label: "Apă — sumă calculată", group: "Servicii" },
  { key: "canalVolum", label: "Canalizare — volum, m³", group: "Servicii" },
  { key: "canalTarif", label: "Canalizare — tarif, lei/m³", group: "Servicii" },
  { key: "canalSuma", label: "Canalizare — sumă calculată", group: "Servicii" },
  { key: "recalculari", label: "Recalculări", group: "Totaluri" },
  { key: "penalitati", label: "Penalitate", group: "Totaluri" },
  { key: "suma", label: "Suma calculată", group: "Totaluri" },
  { key: "datorii", label: "Datorii(+) / avans(-)", group: "Totaluri" },
  { key: "total", label: "Suma spre plată", group: "Totaluri" },
  { key: "firma", label: "Denumirea companiei", group: "Companie" },
  { key: "firmaAdresa", label: "Adresa companiei", group: "Companie" },
  { key: "firmaEmail", label: "Email companie", group: "Companie" },
  { key: "firmaCodFiscal", label: "Cod fiscal", group: "Companie" },
  { key: "contactNume", label: "Persoana de contact", group: "Companie" },
  { key: "contacte", label: "Lista de contacte", group: "Companie" },
  { key: "atentie", label: "Textul „Atenție”", group: "Companie" },
  { key: "anunt", label: "Textul „Anunț”", group: "Companie" },
];

/** Înlocuiește {variabila} cu valoarea ei; ce nu e variabilă cunoscută rămâne neatins (se vede imediat în previzualizare). */
export function applyApaCanalVariables(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, k: string) => (Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : whole));
}
