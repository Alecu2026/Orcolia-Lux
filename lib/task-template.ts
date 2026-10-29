/**
 * Șabloane de task-uri / tichete (cod comun server + browser): tipurile, limitele și înlocuirea variabilelor din titlu / descriere.
 * Variabile: {contor} (numărul următor al șablonului, crește la fiecare folosire), {data} (zz.ll.aaaa), {luna} (ll.aaaa), {an}, {ora}, {operator}, plus cele de PLĂTITOR / APEL
 * ({nume}, {telefon}, {adresa}, {cont}, …) care se completează din datele plătitorului ales (de ex. al celui care sună din pop-up-ul „Apel primit”).
 */

export type TaskTemplateType = "TASK" | "TICKET";

export type TaskTemplate = {
  id: string;
  type: TaskTemplateType;
  name: string;
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  categoryId: string;
  projectId: string;
  clientId: string;
  address: string;
  assigneeIds: string[];
  teamIds: string[];
  /** Termen = azi + atâtea zile; null = fără termen. */
  dueDays: number | null;
  reminderIntervalMinutes: number;
  /** Reamintirea programată: JSON (vezi lib/reminder-schedule.ts) sau "" = fără. */
  reminderSchedule: string;
  /** Următorul număr pentru {contor}. */
  counter: number;
};

export type TaskTemplateDraft = Omit<TaskTemplate, "id" | "type"> & { id?: string };

/** Ce primește fereastra „Task nou" după ce alegi un șablon (variabilele sunt deja înlocuite). */
export type TemplatePrefill = {
  /** Apelul din care s-a pornit (telefonul și momentul), ca variabilele rămase să se poată completa când se alege plătitorul. */
  callPhone?: string;
  callAt?: string;
  templateId: string;
  /** Numărul de {contor} rezervat pentru acest task (dacă renunți, se eliberează). */
  reserved: number;
  title: string;
  description: string;
  priority: TaskTemplate["priority"];
  categoryId: string;
  projectId: string;
  clientId: string;
  address: string;
  assigneeIds: string[];
  teamIds: string[];
  /** "YYYY-MM-DD" sau "" */
  dueDate: string;
  reminderIntervalMinutes: number;
  reminderSchedule: string;
};

export const TEMPLATE_VARIABLES = ["{contor}", "{data}", "{luna}", "{an}", "{ora}", "{operator}"] as const;

/** Variabilele de plătitor / apel: se completează din datele plătitorului ales (sau ale celui care sună). */
export const PAYER_VARIABLES: { key: string; label: string }[] = [
  { key: "{nume}", label: "Numele plătitorului" },
  { key: "{telefon}", label: "Telefonul (al apelului sau din fișă)" },
  { key: "{adresa}", label: "Adresa de consum" },
  { key: "{cont}", label: "Contul personal" },
  { key: "{email}", label: "Email" },
  { key: "{datorie}", label: "Suma de achitat (ultima factură)" },
  { key: "{factura}", label: "Numărul ultimei facturi" },
  { key: "{nr_contor}", label: "Numărul contorului" },
  { key: "{index}", label: "Ultimul index al contorului" },
  { key: "{sector}", label: "Sectorul" },
  { key: "{apel_data}", label: "Data apelului" },
  { key: "{apel_ora}", label: "Ora apelului" },
];

/** Datele plătitorului pentru variabile (valorile lipsă sunt null). */
export type PayerTemplateData = {
  nume: string | null;
  telefon: string | null;
  adresa: string | null;
  cont: string | null;
  email: string | null;
  datorie: string | null;
  factura: string | null;
  nr_contor: string | null;
  index: string | null;
  sector: string | null;
};
export type TemplateContext = {
  /** Plătitorul ales; lipsă ⇒ variabilele de plătitor rămân neînlocuite (se completează când alegi plătitorul). */
  payer?: PayerTemplateData | null;
  operator?: string;
  /** Telefonul de pe care sună (și fără plătitor găsit se poate completa {telefon}). */
  phone?: string | null;
  /** Momentul apelului (ISO), pentru {apel_data} / {apel_ora}; implicit acum. */
  callAt?: string | null;
  /** Ora curentă (HH:mm), calculată de apelant (ora României). */
  time?: string;
};

const PAYER_KEYS = ["nume", "telefon", "adresa", "cont", "email", "datorie", "factura", "nr_contor", "index", "sector"] as const;
const PAYER_VAR_RE = /\{(nume|telefon|adresa|cont|email|datorie|factura|nr_contor|index|sector|apel_data|apel_ora)\}/i;
/** Textul conține încă variabile de plătitor / apel neînlocuite? */
export const hasPayerVariables = (text: string): boolean => PAYER_VAR_RE.test(text);
export const TEMPLATE_MAX_NAME = 60;
export const TEMPLATE_MAX_TITLE = 200;
export const TEMPLATE_MAX_DESCRIPTION = 5000;
export const TEMPLATE_MAX_PER_TYPE = 200;

/**
 * Înlocuiește variabilele. `dateKey` = ziua curentă „YYYY-MM-DD" (ora României, calculată de apelant). Variabilele de plătitor / apel se înlocuiesc doar dacă `ctx.payer` e dat
 * (valoarea lipsă a plătitorului devine „—"); fără plătitor rămân scrise ca atare, ca să se completeze mai târziu.
 */
export function fillTemplate(text: string, counter: number, dateKey: string, ctx: TemplateContext = {}): string {
  const [y, m, d] = dateKey.split("-");
  let out = text
    .replace(/\{contor\}/gi, String(counter))
    .replace(/\{data\}/gi, `${d}.${m}.${y}`)
    .replace(/\{luna\}/gi, `${m}.${y}`)
    .replace(/\{an\}/gi, y)
    .replace(/\{ora\}/gi, ctx.time ?? "")
    .replace(/\{operator\}/gi, ctx.operator ?? "");
  // {telefon}: din apel chiar și fără plătitor; cu plătitor, lipsa devine „—”
  const tel = ctx.payer ? (ctx.payer.telefon ?? ctx.phone ?? "—") : ctx.phone;
  if (tel != null) out = out.replace(/\{telefon\}/gi, tel);
  if (ctx.payer) {
    for (const k of PAYER_KEYS) if (k !== "telefon") out = out.replace(new RegExp(`\\{${k}\\}`, "gi"), () => ctx.payer![k] ?? "—");
  }
  if (ctx.payer || ctx.callAt) {
    const at = ctx.callAt ? new Date(ctx.callAt) : new Date();
    const ok = !Number.isNaN(at.getTime());
    const dt = ok ? at : new Date();
    const day = new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric" }).format(dt);
    const hm = new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", hour: "2-digit", minute: "2-digit", hour12: false }).format(dt);
    out = out.replace(/\{apel_data\}/gi, day).replace(/\{apel_ora\}/gi, hm);
  }
  return out;
}
