/**
 * Cod partajat (server + client) pentru pagina /notificari-platitori: filtrele tabelului, șabloanele de
 * mesaj cu {variabile}, normalizarea telefoanelor și calculul segmentelor SMS. Fără "server-only" —
 * rulează și în browser (previzualizare mesaj, contor SMS, salvarea filtrelor în localStorage).
 */

import type { PayerRow } from "./queries/payers";

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
  /**
   * Canalul prin care a fost (sau NU a fost) notificat plătitorul, din jurnalul de trimiteri: "EMAIL" | "SMS" | "CALL" | "ANY" (orice canal);
   * prefix "!" = NU a fost notificat (ex. "!SMS"). Se combină cu perioada de mai jos; fără perioadă = oricând.
   */
  via: "" | "ANY" | "EMAIL" | "SMS" | "CALL" | "!ANY" | "!EMAIL" | "!SMS" | "!CALL";
  /** "YYYY-MM-DD" — perioada personalizată pentru `via` (inclusiv ambele capete; oricare poate lipsi). */
  notifiedFrom: string;
  notifiedTo: string;
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
  minDebt: "", maxDebt: "", contact: "", kind: "", notified: "", via: "", notifiedFrom: "", notifiedTo: "", installedFrom: "", sort: "", nameFix: "", invoices: "",
};

/** „Toate" = o pagină cât toată lista (plafon de siguranță; sunt ~19.000 de plătitori). */
export const PER_PAGE_ALL = 25_000;
export const NOTIFY_PER_PAGE = [20, 50, 100, 200, 500, 1000, PER_PAGE_ALL] as const;
export const perPageLabel = (n: number, t?: (ro: string, v?: Record<string, string | number>) => string) =>
  t ? (n === PER_PAGE_ALL ? t("Toate") : t("{n} / pagină", { n })) : n === PER_PAGE_ALL ? "Toate" : `${n} / pagină`;
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

export const VIA_OPTIONS: { value: Exclude<NotifyFilters["via"], "">; label: string }[] = [
  { value: "EMAIL", label: "Notificați prin email" },
  { value: "SMS", label: "Notificați prin SMS" },
  { value: "CALL", label: "Notificați prin apel" },
  { value: "!ANY", label: "Nenotificați (orice canal)" },
  { value: "!EMAIL", label: "Nenotificați prin email" },
  { value: "!SMS", label: "Nenotificați prin SMS" },
  { value: "!CALL", label: "Nenotificați prin apel" },
];

/** „via" e compus din două alegeri: canalul (EMAIL/SMS/CALL) și dacă s-a primit sau nu notificare ("!" în față). */
export const viaChannel = (via: NotifyFilters["via"]): "" | "EMAIL" | "SMS" | "CALL" => {
  const c = via.replace(/^!/, "");
  return c === "EMAIL" || c === "SMS" || c === "CALL" ? c : "";
};
export const viaMode = (via: NotifyFilters["via"]): "" | "yes" | "no" => (!via ? "" : via.startsWith("!") ? "no" : "yes");
export const composeVia = (channel: string, mode: string): NotifyFilters["via"] =>
  (!channel && !mode ? "" : `${mode === "no" ? "!" : ""}${channel || "ANY"}`) as NotifyFilters["via"];

/** Criteriul „canal + perioadă" din filtre (null = inactiv). Perioada fără canal înseamnă „orice canal". */
export type NotifyCriterion = { negate: boolean; channel: "EMAIL" | "SMS" | "CALL" | null; from: string; to: string };
export function notifyCriterion(f: Pick<NotifyFilters, "via" | "notifiedFrom" | "notifiedTo">): NotifyCriterion | null {
  if (!f.via && !f.notifiedFrom && !f.notifiedTo) return null;
  const via = f.via || "ANY";
  const negate = via.startsWith("!");
  const ch = negate ? via.slice(1) : via;
  return { negate, channel: ch === "ANY" ? null : (ch as "EMAIL" | "SMS" | "CALL"), from: f.notifiedFrom, to: f.notifiedTo };
}
/** Cheie stabilă pentru memorarea mulțimii de plătitori (nu depinde de „!"): aceeași mulțime pentru „notificați" și „nenotificați". */
export const notifyCriterionKey = (c: NotifyCriterion) => `${c.channel ?? "ANY"}|${c.from}|${c.to}`;

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
  const day = (k: string) => {
    const v = txt(get(src, k), 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
  };
  let notifiedFrom = day("notifiedFrom");
  let notifiedTo = day("notifiedTo");
  if (notifiedFrom && notifiedTo && notifiedFrom > notifiedTo) [notifiedFrom, notifiedTo] = [notifiedTo, notifiedFrom];
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
    via: ONE_OF(get(src, "via"), ["ANY", "EMAIL", "SMS", "CALL", "!ANY", "!EMAIL", "!SMS", "!CALL"] as const),
    notifiedFrom,
    notifiedTo,
    installedFrom: /^\d{4}-\d{2}-\d{2}$/.test(installedFrom) ? installedFrom : "",
    sort: ONE_OF(get(src, "sort"), ["debtDesc", "debtAsc", "installDesc", "installAsc"] as const),
    nameFix: ONE_OF(get(src, "nameFix"), ["1"] as const),
    invoices: ONE_OF(get(src, "invoices"), ["none"] as const),
  };
}

/** Câte filtre sunt active (sortarea nu se numără — nu restrânge lista). */
export function countActiveFilters(f: NotifyFilters): number {
  // Canalul și perioada formează un singur criteriu: se numără o singură dată.
  const n = (Object.keys(f) as (keyof NotifyFilters)[]).filter((k) => k !== "sort" && k !== "via" && k !== "notifiedFrom" && k !== "notifiedTo" && f[k]).length;
  return n + (f.via || f.notifiedFrom || f.notifiedTo ? 1 : 0);
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
  { key: "link", label: "Link factură (se deschide direct)" },
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
  /** Linkul public al facturii (se deschide fără autentificare). */
  invoiceLink?: string | null;
}): NotifyVars {
  return {
    nume: p.name,
    cont: p.account ?? "—",
    suma: p.amount == null ? "—" : fmtMoney(p.amount, p.currency ?? "MDL"),
    factura: p.invoiceNumber ?? "—",
    scadenta: p.dueDate ? fmtDay(p.dueDate) : "—",
    adresa: p.address ?? "—",
    link: p.invoiceLink ?? "—",
  };
}

export type NotifyPreset = { key: string; label: string; subject: string; email: string; sms: string; call: string };

export const NOTIFY_PRESETS: NotifyPreset[] = [
  {
    key: "debt",
    label: "Reamintire datorie",
    subject: "Reamintire: factură de achitat",
    email:
      "Stimate(ă) {nume},\n\nVă reamintim că aveți de achitat {suma} pentru factura {factura} (cont {cont}). Termen de plată: {scadenta}.\n\nVezi factura: {link}\n\nVă mulțumim!",
    sms: "Apa-Canal: {nume}, aveti de achitat {suma} (factura {factura}, cont {cont}). Factura: {link}",
    call: "Bună ziua, {nume}. Vă sunăm de la Apă-Canal. Aveți de achitat suma de {suma} pentru factura {factura}, cu termen de plată {scadenta}. Vă mulțumim și vă dorim o zi bună!",
  },
  {
    key: "invoice",
    label: "Factură nouă",
    subject: "Factura dumneavoastră {factura} este disponibilă",
    email:
      "Stimate(ă) {nume},\n\nFactura {factura} în valoare de {suma} (cont {cont}) a fost emisă. Scadență: {scadenta}.\n\nVezi factura: {link}\n\nVă mulțumim!",
    sms: "Apa-Canal: factura {factura} de {suma} a fost emisa. Scadenta: {scadenta}. {link}",
    call: "Bună ziua, {nume}. Vă informăm că a fost emisă factura {factura} în valoare de {suma}. Termenul de plată este {scadenta}. Vă mulțumim!",
  },
  {
    key: "announce",
    label: "Anunț general",
    subject: "Anunț important",
    email: "Stimate(ă) {nume},\n\nVă informăm că …\n\nCu stimă.",
    sms: "Apa-Canal: {nume}, va informam ca …",
    call: "Bună ziua, {nume}. Vă informăm că …",
  },
];

// ── Notificări prin apel (robot vocal) ─────────────────────────────────────────────────────────

/**
 * Vocile pentru citirea mesajului de apel. `id` = vocea Piper (open-source, MIT) care rulează direct în browser — fără cont și
 * fără instalare în Windows; se descarcă o dată (~60 MB) și rămâne în browser. Apelul prin PBX Moldcell e cu operator: vocea e
 * pentru ascultarea mesajului în pagină („▶ Ascultă"), nu intră în convorbire. Piper are o singură voce românească (masculină).
 */
export const NOTIFY_VOICES = [
  { id: "ro_RO-mihai-medium", lang: "ro-RO", gender: "m", label: "Română · masculin (Mihai)" },
  { id: "ru_RU-irina-medium", lang: "ru-RU", gender: "f", label: "Русский · женский (Ирина)" },
  { id: "ru_RU-dmitri-medium", lang: "ru-RU", gender: "m", label: "Русский · мужской (Дмитрий)" },
  { id: "ru_RU-denis-medium", lang: "ru-RU", gender: "m", label: "Русский · мужской (Денис)" },
  { id: "ru_RU-ruslan-medium", lang: "ru-RU", gender: "m", label: "Русский · мужской (Руслан)" },
] as const;
export const DEFAULT_VOICE: string = NOTIFY_VOICES[0].id;
export const NOTIFY_MAX_CALL_BODY = 600;
export const voiceById = (id: string | null | undefined) => NOTIFY_VOICES.find((v) => v.id === id) ?? NOTIFY_VOICES[0];

/** Durata aproximativă a mesajului vorbit (~13 caractere/secundă), ca operatorul să știe cât durează apelul. */
export function callSeconds(text: string): number {
  return Math.max(1, Math.round(text.replace(/\s+/g, " ").trim().length / 13));
}

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
export function agoLabel(d: string | Date | null, t: (ro: string, v?: Record<string, string | number>) => string = (ro, v) => (v ? ro.replace(/\{(\w+)\}/g, (m, k: string) => String(v[k] ?? m)) : ro)): string {
  if (!d) return "";
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000);
  if (days <= 0) return t("azi");
  if (days === 1) return t("ieri");
  if (days < 31) return t("acum {n} zile", { n: days });
  const months = Math.floor(days / 30);
  return months < 12 ? t("acum {n} luni", { n: months }) : t("acum {n} ani", { n: Math.floor(months / 12) });
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

export type PayerTemplate = { id: string; name: string; subject: string; email: string; sms: string; call: string; voice: string };
export type PayerTemplateDraft = Omit<PayerTemplate, "id">;
export const NOTIFY_MAX_TEMPLATE_NAME = 60;
export const NOTIFY_MAX_TEMPLATES = 100;

// ── Notițe pe plătitor ─────────────────────────────────────────────────────────────────────────

export type PayerNoteItem = { id: string; body: string; userId: string; userName: string; createdAt: string; updatedAt: string };
export const NOTIFY_MAX_NOTE = 2_000;

// ── Motor local: toți plătitorii în memorie, filtrați/sortați/paginați în JS ───────────────────
// Serverul trimite O DATĂ un snapshot compact (toți plătitorii, ~19.000), iar filtrele/sortarea/paginarea rulează
// în browser — instant, fără interogări în baza de date la fiecare filtru (MongoDB filtrează lent, JS rapid).


export type SnapInvoice = NonNullable<PayerRow["latestInvoice"]>;
/**
 * Un plătitor în motorul local. Câmpurile cu „_" sunt PRE-CALCULATE o singură dată la decodare, ca fiecare schimbare de filtru să fie doar o
 * trecere simplă prin 19.000 de rânduri cu comparații pe numere (fără parsare de date, fără șiruri): _h = text de căutare, _he/_hp = are email /
 * telefon, _nm = ultima notificare (ms, 0 = niciodată), _st = sector (0 necunoscut, 1 privat, 2 comunal), _dk = soldul facturii afișate (NaN = fără factură).
 */
export type SnapRow = PayerRow & { sector: string | null; _h: string; _he: boolean; _hp: boolean; _nm: number; _st: 0 | 1 | 2; _dk: number };

const SECTOR_CODE = (s: string | null): 0 | 1 | 2 => (s === "Sector privat" ? 1 : s === "Sector comunal" ? 2 : 0);

/** Recalculează câmpurile derivate după o modificare locală a rândului (nume/telefon/email/ultima notificare). */
export function refreshDerived<T extends SnapRow>(r: T): T {
  r._h = [r.name, r.meterSeries, r.contract, r.email, r.phone].filter(Boolean).join("\n").toLowerCase();
  r._he = r.email != null && r.email !== "";
  r._hp = r.phone != null && r.phone !== "";
  r._nm = r.lastNotifiedAt ? new Date(r.lastNotifiedAt).getTime() : 0;
  r._st = SECTOR_CODE(r.sector);
  r._dk = r.latestInvoice ? r.latestInvoice.grandTotal : NaN;
  return r;
}

/** Un plătitor în snapshot, ca tuplu (mai puțin JSON): vezi encodarea în getPayerSnapshot (lib/queries/payers.ts). */
export type SnapTuple = [
  id: string, name: string, meterSeries: string | null, contract: string | null, email: string | null, phone: string | null,
  activated: 0 | 1, invoiceCount: number,
  invNumber: string | null, invStatus: string | null, invTotal: number | null, invCurrency: string | null, invDueMs: number | null,
  address: string | null, notifiedMs: number | null, installed: string | null, sector: string | null,
];
/** Factura unei luni: [clientId, număr, status, total, valută, scadență ms]. */
export type MonthTuple = [clientId: string, number: string, status: string, total: number, currency: string, dueMs: number | null];

const collatorRo = new Intl.Collator("ro");
/** Sortarea după nume folosită peste tot (aceeași ordine pe server și în browser). */
export const sortTuplesByName = (tuples: SnapTuple[]): SnapTuple[] => tuples.sort((a, b) => collatorRo.compare(a[1], b[1]));
const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

/** `presorted`: serverul a sortat deja tuplurile după nume (vezi lib/services/payer-cache.ts) — nu mai sortăm încă o dată pe client/pe server. */
export function decodeSnapshot(tuples: SnapTuple[], presorted = false): SnapRow[] {
  const rows: SnapRow[] = tuples.map((t) => ({
    id: t[0],
    name: t[1],
    meterSeries: t[2],
    contract: t[3],
    email: t[4],
    phone: t[5],
    activated: t[6] === 1,
    invoiceCount: t[7],
    latestInvoice:
      t[8] == null
        ? null
        : { number: t[8], status: (t[9] ?? "SENT") as SnapInvoice["status"], grandTotal: t[10] ?? 0, currency: t[11] ?? "MDL", dueDate: iso(t[12]) },
    consumAddress: t[13],
    lastNotifiedAt: iso(t[14]),
    installedAt: t[15],
    sector: t[16],
    _h: [t[1], t[2], t[3], t[4], t[5]].filter(Boolean).join("\n").toLowerCase(),
    _he: t[4] != null && t[4] !== "",
    _hp: t[5] != null && t[5] !== "",
    _nm: t[14] ?? 0,
    _st: SECTOR_CODE(t[16]),
    _dk: t[8] == null ? NaN : (t[10] ?? 0),
  }));
  if (!presorted) rows.sort((a, b) => collatorRo.compare(a.name, b.name)); // o singură dată; filtrarea păstrează ordinea
  return rows;
}

export function decodeMonth(tuples: MonthTuple[]): Map<string, SnapInvoice> {
  return new Map(
    tuples.map((t) => [t[0], { number: t[1], status: t[2] as SnapInvoice["status"], grandTotal: t[3], currency: t[4], dueDate: iso(t[5]) }]),
  );
}

const SECTOR_NAME = { privat: "Sector privat", comunal: "Sector comunal" } as const;

/** Rândurile unei luni (cu factura acelei luni în loc de ultima), construite O DATĂ per hartă de luni și refolosite la fiecare filtru. */
const monthRowsCache = new WeakMap<Map<string, SnapInvoice>, WeakMap<SnapRow[], SnapRow[]>>();
function rowsForMonth(rows: SnapRow[], monthMap: Map<string, SnapInvoice>): SnapRow[] {
  let perRows = monthRowsCache.get(monthMap);
  if (!perRows) monthRowsCache.set(monthMap, (perRows = new WeakMap()));
  let out = perRows.get(rows);
  if (!out) {
    out = [];
    for (const r of rows) {
      const inv = monthMap.get(r.id);
      if (inv) out.push({ ...r, latestInvoice: inv, _dk: inv.grandTotal });
    }
    perRows.set(rows, out);
  }
  return out;
}

/**
 * Ordinea sortată (indici) după sold sau data instalării, calculată o dată per set de rânduri — nu la fiecare schimbare de filtru.
 * Stabilă: la egalitate rămâne ordinea alfabetică. Fără factură / fără dată → la final, indiferent de direcție.
 */
const orderCache = new WeakMap<SnapRow[], Map<string, Uint32Array>>();
function orderFor(rows: SnapRow[], sort: "debtDesc" | "debtAsc" | "installDesc" | "installAsc"): Uint32Array {
  let m = orderCache.get(rows);
  if (!m) orderCache.set(rows, (m = new Map()));
  let ord = m.get(sort);
  if (!ord) {
    const idx = Array.from({ length: rows.length }, (_, k) => k);
    if (sort === "debtDesc" || sort === "debtAsc") {
      const mul = sort === "debtAsc" ? 1 : -1;
      idx.sort((a, b) => {
        const x = rows[a]._dk, y = rows[b]._dk;
        const xn = Number.isNaN(x), yn = Number.isNaN(y);
        if (xn && yn) return a - b;
        if (xn) return 1;
        if (yn) return -1;
        return (x - y) * mul || a - b;
      });
    } else {
      const dir = sort === "installAsc" ? 1 : -1;
      idx.sort((a, b) => {
        const x = rows[a].installedAt ?? "", y = rows[b].installedAt ?? "";
        if (!x && !y) return a - b;
        if (!x) return 1;
        if (!y) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * dir || a - b;
      });
    }
    ord = Uint32Array.from(idx);
    m.set(sort, ord);
  }
  return ord;
}

/**
 * Aceeași semantică ca filtrele de pe server (buildPayerWhere / matchesMonthInvoice), dar în memorie.
 * Cu `month`, suma/statusul sunt ale facturii acelei luni (`monthMap`); fără, ale ultimei facturi.
 * O singură trecere cu comparații pe câmpuri pre-calculate (vezi SnapRow) și ordine de sortare pre-calculate: milisecunde la 19.000 de rânduri.
 */
export function filterSnapshot(allRows: SnapRow[], f: NotifyFilters, monthMap: Map<string, SnapInvoice> | null, notifySet: Set<string> | null = null): SnapRow[] {
  const crit = notifyCriterion(f);
  if (crit && !notifySet) return []; // mulțimea „notificați în perioada…" încă nu e încărcată: apelantul o cere și reface lista
  const rows = f.month ? (monthMap ? rowsForMonth(allRows, monthMap) : []) : allRows;
  const q = f.q.trim().toLowerCase();
  const street = f.street.trim().toLowerCase();
  const min = f.minDebt === "" ? NaN : Number(f.minDebt);
  const max = f.maxDebt === "" ? NaN : Number(f.maxDebt);
  const hasMin = !Number.isNaN(min), hasMax = !Number.isNaN(max);
  const now = Date.now();
  const d7 = now - 7 * 86_400_000;
  const d30 = now - 30 * 86_400_000;
  const sectorCode = f.sector === "privat" ? 1 : f.sector === "comunal" ? 2 : 0;
  const order = f.sort === "debtDesc" || f.sort === "debtAsc" || f.sort === "installDesc" || f.sort === "installAsc" ? orderFor(rows, f.sort) : null;
  const wantStatus = f.invoiceStatus;
  const money = f.debt !== "" || hasMin || hasMax || wantStatus !== "";
  const out: SnapRow[] = [];

  for (let k = 0, n = rows.length; k < n; k++) {
    const r = order ? rows[order[k]] : rows[k];
    if (q && !r._h.includes(q)) continue;
    if (street && !(r.consumAddress ?? "").toLowerCase().includes(street)) continue;
    if (f.account === "activated" ? !r.activated : f.account === "pending" ? r.activated : false) continue;
    if (sectorCode && r._st !== sectorCode) continue;
    if (f.kind === "person" ? r.meterSeries == null : f.kind === "company" ? r.meterSeries != null : false) continue;
    if (f.nameFix && !r.name.includes("?")) continue;

    switch (f.contact) {
      case "email": if (!r._he) continue; break;
      case "phone": if (!r._hp) continue; break;
      case "both": if (!(r._he && r._hp)) continue; break;
      case "any": if (!(r._he || r._hp)) continue; break;
      case "noemail": if (r._he) continue; break;
      case "nophone": if (r._hp) continue; break;
      case "none": if (r._he || r._hp) continue; break;
    }

    switch (f.notified) {
      case "never": if (r._nm !== 0) continue; break;
      case "7d": if (!(r._nm >= d7 && r._nm !== 0)) continue; break;
      case "30d": if (!(r._nm >= d30 && r._nm !== 0)) continue; break;
      case "not7d": if (r._nm !== 0 && r._nm >= d7) continue; break;
      case "not30d": if (r._nm !== 0 && r._nm >= d30) continue; break;
    }

    if (crit && notifySet!.has(r.id) === crit.negate) continue;

    if (f.installedFrom && !(r.installedAt && r.installedAt >= f.installedFrom)) continue;
    if (f.invoices === "none" && r.latestInvoice) continue;

    if (money) {
      const inv = r.latestInvoice;
      if (wantStatus && inv?.status !== wantStatus) continue;
      const t = r._dk;
      if (f.debt === "has" && !(inv && t > 0)) continue;
      if (f.debt === "none" && !(inv && t <= 0)) continue;
      if (hasMin && !(inv && t >= min)) continue;
      if (hasMax && !(inv && t <= max)) continue;
    }
    out.push(r);
  }
  return out;
}
