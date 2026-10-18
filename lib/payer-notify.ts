/**
 * Cod partajat (server + client) pentru pagina /notificari-platitori: filtrele tabelului, șabloanele de
 * mesaj cu {variabile}, normalizarea telefoanelor și calculul segmentelor SMS. Fără "server-only" —
 * rulează și în browser (previzualizare mesaj, contor SMS, salvarea filtrelor în localStorage).
 */

// ── Filtre ──────────────────────────────────────────────────────────────────────────────────────

export type NotifyFilters = {
  /** Căutare text: nume, cont personal, nr. contract, email, telefon. */
  q: string;
  street: string;
  /** "YYYY-MM" — doar plătitorii cu factură în luna aceea (suma/statusul sunt ale lunii). */
  month: string;
  account: "" | "activated" | "pending";
  sector: "" | "privat" | "comunal";
  invoiceStatus: string;
  debt: "" | "has" | "none";
  minDebt: string;
  maxDebt: string;
  /** Ce date de contact are plătitorul (necesare pentru a-l putea notifica). */
  contact: "" | "email" | "phone" | "both" | "any" | "none" | "noemail" | "nophone";
  kind: "" | "person" | "company";
  /** Când a fost notificat ultima dată (din jurnalul de trimiteri). */
  notified: "" | "never" | "7d" | "30d" | "not7d" | "not30d";
  /** "YYYY-MM-DD" — contor instalat la sau după data asta. */
  installedFrom: string;
  sort: "" | "debtDesc" | "debtAsc" | "installDesc" | "installAsc";
  /** "1" = doar numele cu „?" (litere românești pierdute la importul din 1C). */
  nameFix: "" | "1";
  /** "none" = plătitori fără nicio factură (de ex. conturi de test de curățat). */
  invoices: "" | "none";
};

export const EMPTY_FILTERS: NotifyFilters = {
  q: "", street: "", month: "", account: "", sector: "", invoiceStatus: "", debt: "",
  minDebt: "", maxDebt: "", contact: "", kind: "", notified: "", installedFrom: "", sort: "", nameFix: "", invoices: "",
};

/** „Toate" = o pagină cât toată lista (plafon de siguranță; sunt ~19.000 de plătitori). */
export const PER_PAGE_ALL = 25_000;
export const NOTIFY_PER_PAGE = [20, 50, 100, 200, 500, 1000, PER_PAGE_ALL] as const;
export const perPageLabel = (n: number) => (n === PER_PAGE_ALL ? "Toate" : `${n} / pagină`);
export const DEFAULT_PER_PAGE = 50;

export const CONTACT_OPTIONS: { value: NotifyFilters["contact"]; label: string }[] = [
  { value: "any", label: "Au email sau telefon" },
  { value: "both", label: "Au email și telefon" },
  { value: "email", label: "Au email" },
  { value: "phone", label: "Au telefon" },
  { value: "noemail", label: "Fără email" },
  { value: "nophone", label: "Fără telefon" },
  { value: "none", label: "Fără niciun contact" },
];

export const NOTIFIED_OPTIONS: { value: NotifyFilters["notified"]; label: string }[] = [
  { value: "never", label: "Niciodată notificați" },
  { value: "not7d", label: "Nenotificați în ultimele 7 zile" },
  { value: "not30d", label: "Nenotificați în ultimele 30 de zile" },
  { value: "7d", label: "Notificați în ultimele 7 zile" },
  { value: "30d", label: "Notificați în ultimele 30 de zile" },
];

const ONE_OF = <T extends string>(v: unknown, allowed: readonly T[]): T | "" =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : "";

const MONEY_RE = /^\d{1,9}([.,]\d{1,2})?$/;
const cleanMoney = (v: unknown): string => {
  const s = typeof v === "string" ? v.trim() : "";
  return MONEY_RE.test(s) ? s.replace(",", ".") : "";
};

const txt = (v: unknown, max = 120): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

type Source = URLSearchParams | Record<string, unknown>;
const get = (src: Source, k: string): unknown => (src instanceof URLSearchParams ? src.get(k) : src[k]);

/** Normalizează orice sursă (URL, localStorage, corp de cerere) la un `NotifyFilters` valid — valorile necunoscute dispar. */
export function sanitizeFilters(src: Source): NotifyFilters {
  const month = txt(get(src, "month"), 7);
  const installedFrom = txt(get(src, "installedFrom"), 10);
  return {
    q: txt(get(src, "q")),
    street: txt(get(src, "street")),
    month: /^\d{4}-\d{2}$/.test(month) ? month : "",
    account: ONE_OF(get(src, "account"), ["activated", "pending"] as const),
    sector: ONE_OF(get(src, "sector"), ["privat", "comunal"] as const),
    invoiceStatus: ONE_OF(get(src, "invoiceStatus"), ["DRAFT", "SENT", "PAID", "OVERDUE", "CANCELLED"] as const),
    debt: ONE_OF(get(src, "debt"), ["has", "none"] as const),
    minDebt: cleanMoney(get(src, "minDebt")),
    maxDebt: cleanMoney(get(src, "maxDebt")),
    contact: ONE_OF(get(src, "contact"), ["email", "phone", "both", "any", "none", "noemail", "nophone"] as const),
    kind: ONE_OF(get(src, "kind"), ["person", "company"] as const),
    notified: ONE_OF(get(src, "notified"), ["never", "7d", "30d", "not7d", "not30d"] as const),
    installedFrom: /^\d{4}-\d{2}-\d{2}$/.test(installedFrom) ? installedFrom : "",
    sort: ONE_OF(get(src, "sort"), ["debtDesc", "debtAsc", "installDesc", "installAsc"] as const),
    nameFix: ONE_OF(get(src, "nameFix"), ["1"] as const),
    invoices: ONE_OF(get(src, "invoices"), ["none"] as const),
  };
}

/** Câte filtre sunt active (sortarea nu se numără — nu restrânge lista). */
export function countActiveFilters(f: NotifyFilters): number {
  return (Object.keys(f) as (keyof NotifyFilters)[]).filter((k) => k !== "sort" && f[k]).length;
}

export function filtersToParams(f: NotifyFilters, extra: Record<string, string | number> = {}): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) p.set(k, v);
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p;
}

export function normalizePerPageClient(v: unknown): number {
  const n = Math.floor(Number(v));
  return (NOTIFY_PER_PAGE as readonly number[]).includes(n) ? n : DEFAULT_PER_PAGE;
}

// ── Șabloane de mesaj ──────────────────────────────────────────────────────────────────────────

export const NOTIFY_TOKENS = [
  { key: "nume", label: "Nume" },
  { key: "cont", label: "Cont / contract" },
  { key: "suma", label: "Suma de achitat" },
  { key: "factura", label: "Nr. factură" },
  { key: "scadenta", label: "Scadență" },
  { key: "adresa", label: "Adresă" },
] as const;
export type NotifyTokenKey = (typeof NOTIFY_TOKENS)[number]["key"];
export type NotifyVars = Record<NotifyTokenKey, string>;

/** Înlocuiește {nume}, {suma}… — token necunoscut rămâne neatins (se vede imediat în previzualizare). */
export function renderTemplate(tpl: string, vars: NotifyVars): string {
  return tpl.replace(/\{(\w+)\}/g, (whole, k: string) => (k in vars ? vars[k as NotifyTokenKey] : whole));
}

export function usesTokens(...tpls: string[]): boolean {
  return tpls.some((t) => /\{\w+\}/.test(t));
}

const fmtMoney = (n: number, currency: string) =>
  `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

const fmtDay = (d: string | Date) =>
  new Date(d).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" });

export function buildVars(p: {
  name: string;
  account: string | null;
  amount: number | null;
  currency: string | null;
  invoiceNumber: string | null;
  dueDate: string | Date | null;
  address: string | null;
}): NotifyVars {
  return {
    nume: p.name,
    cont: p.account ?? "—",
    suma: p.amount == null ? "—" : fmtMoney(p.amount, p.currency ?? "MDL"),
    factura: p.invoiceNumber ?? "—",
    scadenta: p.dueDate ? fmtDay(p.dueDate) : "—",
    adresa: p.address ?? "—",
  };
}

export type NotifyPreset = { key: string; label: string; subject: string; email: string; sms: string };

export const NOTIFY_PRESETS: NotifyPreset[] = [
  {
    key: "debt",
    label: "Reamintire datorie",
    subject: "Reamintire: factură de achitat",
    email:
      "Stimate(ă) {nume},\n\nVă reamintim că aveți de achitat {suma} pentru factura {factura} (cont {cont}). Termen de plată: {scadenta}.\n\nVă mulțumim!",
    sms: "Apa-Canal: {nume}, aveti de achitat {suma} (factura {factura}, cont {cont}). Multumim!",
  },
  {
    key: "invoice",
    label: "Factură nouă",
    subject: "Factura dumneavoastră {factura} este disponibilă",
    email:
      "Stimate(ă) {nume},\n\nFactura {factura} în valoare de {suma} (cont {cont}) a fost emisă. Scadență: {scadenta}.\n\nVă mulțumim!",
    sms: "Apa-Canal: factura {factura} de {suma} a fost emisa. Scadenta: {scadenta}.",
  },
  {
    key: "announce",
    label: "Anunț general",
    subject: "Anunț important",
    email: "Stimate(ă) {nume},\n\nVă informăm că …\n\nCu stimă.",
    sms: "Apa-Canal: {nume}, va informam ca …",
  },
];

// ── Telefon & SMS ──────────────────────────────────────────────────────────────────────────────

/**
 * Telefon → format internațional E.164 (+373…), sau null dacă nu arată a număr valid. Implicit Moldova
 * (+373): „069123456", „69123456", „+373 69 123 456", „0037369123456". România (+40) doar pentru
 * „07xxxxxxxx" (10 cifre). Orice alt număr trebuie să vină deja cu „+" sau „00".
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const plus = s.startsWith("+");
  let d = s.replace(/\D/g, "");
  if (!d) return null;
  if (!plus && d.startsWith("00")) d = d.slice(2);
  else if (!plus) {
    if (d.length === 9 && d.startsWith("0")) d = "373" + d.slice(1);
    else if (d.length === 8) d = "373" + d;
    else if (d.length === 10 && d.startsWith("07")) d = "40" + d.slice(1);
  }
  return d.length >= 9 && d.length <= 15 ? `+${d}` : null;
}

export const isEmail = (s: string | null | undefined): s is string =>
  !!s && s.length <= 254 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/.test(s.trim());

/** Scoate diacriticele LATINE (ă→a, ș→s…) ca SMS-ul să încapă în alfabetul GSM — cirilica rămâne neatinsă. */
export function stripLatinDiacritics(text: string): string {
  return text.replace(/[À-ɏḀ-ỿ]/g, (ch) => ch.normalize("NFD").replace(/[̀-ͯ]/g, ""));
}

const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXT = "^{}\\[~]|€";

/** Segmente SMS și lungime: GSM-7 (160/153) dacă toate caracterele intră, altfel UCS-2 (70/67). */
export function smsInfo(text: string): { length: number; segments: number; unicode: boolean } {
  let len = 0;
  let unicode = false;
  for (const ch of text) {
    if (GSM_BASIC.includes(ch)) len += 1;
    else if (GSM_EXT.includes(ch)) len += 2;
    else { unicode = true; break; }
  }
  if (unicode) {
    const length = [...text].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
    return { length, segments: length === 0 ? 0 : length <= 70 ? 1 : Math.ceil(length / 67), unicode: true };
  }
  return { length: len, segments: len === 0 ? 0 : len <= 160 ? 1 : Math.ceil(len / 153), unicode: false };
}

/** „acum 3 zile" / „azi" pentru coloana „Ultima notificare". */
export function agoLabel(d: string | Date | null): string {
  if (!d) return "";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return "azi";
  if (days === 1) return "ieri";
  if (days < 31) return `acum ${days} zile`;
  const months = Math.floor(days / 30);
  return months < 12 ? `acum ${months} luni` : `acum ${Math.floor(months / 12)} ani`;
}

// ── Limite comune (client + server) ────────────────────────────────────────────────────────────

export const NOTIFY_CHUNK_SIZE = 25;
/** Plafon de siguranță pentru o singură campanie. */
export const NOTIFY_MAX_RECIPIENTS = 25_000;
export const NOTIFY_MAX_SUBJECT = 200;
export const NOTIFY_MAX_EMAIL_BODY = 5_000;
export const NOTIFY_MAX_SMS_BODY = 1_000;

/** Notificat în ultimele 7 zile? (marcajul verde din coloana „Ultima notificare" — evită trimiterea dublă). */
export function notifiedRecently(d: string | Date | null): boolean {
  return !!d && Date.now() - new Date(d).getTime() < 7 * 86_400_000;
}

// ── Șabloane salvate ───────────────────────────────────────────────────────────────────────────

export type PayerTemplate = { id: string; name: string; subject: string; email: string; sms: string };
export type PayerTemplateDraft = Omit<PayerTemplate, "id">;
export const NOTIFY_MAX_TEMPLATE_NAME = 60;
export const NOTIFY_MAX_TEMPLATES = 100;

// ── Notițe pe plătitor ─────────────────────────────────────────────────────────────────────────

export type PayerNoteItem = { id: string; body: string; userId: string; userName: string; createdAt: string; updatedAt: string };
export const NOTIFY_MAX_NOTE = 2_000;
