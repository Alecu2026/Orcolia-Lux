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
  | "contacteBlock"
  | "scanQrBlock";

export type ApaCanalElementOverride = {
  xMm?: number;
  yMm?: number;
  widthMm?: number;
  heightMm?: number;
  fontSizeMm?: number;
  bold?: boolean;
};

export type ApaCanalLayout = Partial<Record<ApaCanalElementKey, ApaCanalElementOverride>>;

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
  scanQrBlock: "Bloc „Scanează și achită”",
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

/** Poziții/mărimi implicite (mm), folosite doar ca punct de plecare în editor înainte de prima ajustare. */
export const APA_CANAL_LAYOUT_DEFAULTS: Record<ApaCanalElementKey, Required<Pick<ApaCanalElementOverride, "xMm" | "yMm" | "widthMm" | "heightMm">>> = {
  title: { xMm: 2.2, yMm: 2.2, widthMm: 200, heightMm: 8 },
  titleLine: { xMm: 2.2, yMm: 12, widthMm: 190, heightMm: 3 },
  datesBlock: { xMm: 2.2, yMm: 19.3, widthMm: 75, heightMm: 12 },
  contPersonalBlock: { xMm: 80, yMm: 14.9, widthMm: 122, heightMm: 26 },
  logo: { xMm: 205, yMm: 3, widthMm: 88.9, heightMm: 40.1 },
  chart: { xMm: 2.2, yMm: 40.1, widthMm: 96.5, heightMm: 51 },
  meterTable: { xMm: 101.5, yMm: 40.1, widthMm: 90, heightMm: 28.2 },
  companyInfoText: { xMm: 205, yMm: 49, widthMm: 89.1, heightMm: 20.8 },
  billingPeriodText: { xMm: 2.2, yMm: 93.6, widthMm: 150, heightMm: 5 },
  servicesTable: { xMm: 2.2, yMm: 98.7, widthMm: 158, heightMm: 17.1 },
  recalculariText: { xMm: 2.2, yMm: 121, widthMm: 35, heightMm: 10 },
  totalsConnectorLine: { xMm: 2.2, yMm: 132.9, widthMm: 145.5, heightMm: 3 },
  totalsBox: { xMm: 147.8, yMm: 121, widthMm: 49.7, heightMm: 20 },
  atentieBox: { xMm: 2.2, yMm: 148.5, widthMm: 195.3, heightMm: 29 },
  anuntBox: { xMm: 205.7, yMm: 80.2, widthMm: 88.4, heightMm: 30.4 },
  contacteBlock: { xMm: 205.7, yMm: 115.1, widthMm: 88.4, heightMm: 44.6 },
  scanQrBlock: { xMm: 205.7, yMm: 163, widthMm: 88.4, heightMm: 30 },
};

export const MM_TO_PX = 96 / 25.4;

export const round1 = (n: number) => Math.round(n * 10) / 10;
