/**
 * Șabloane de task-uri / tichete (cod comun server + browser): tipurile, limitele și înlocuirea variabilelor din titlu / descriere.
 * Variabile: {contor} (numărul următor al șablonului, crește la fiecare folosire), {data} (zz.ll.aaaa), {luna} (ll.aaaa), {an}.
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
  /** Următorul număr pentru {contor}. */
  counter: number;
};

export type TaskTemplateDraft = Omit<TaskTemplate, "id" | "type"> & { id?: string };

/** Ce primește fereastra „Task nou" după ce alegi un șablon (variabilele sunt deja înlocuite). */
export type TemplatePrefill = {
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
};

export const TEMPLATE_VARIABLES = ["{contor}", "{data}", "{luna}", "{an}"] as const;
export const TEMPLATE_MAX_NAME = 60;
export const TEMPLATE_MAX_TITLE = 200;
export const TEMPLATE_MAX_DESCRIPTION = 5000;
export const TEMPLATE_MAX_PER_TYPE = 200;

/** Înlocuiește variabilele. `dateKey` = ziua curentă „YYYY-MM-DD" (ora României, calculată de apelant). */
export function fillTemplate(text: string, counter: number, dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return text
    .replace(/\{contor\}/gi, String(counter))
    .replace(/\{data\}/gi, `${d}.${m}.${y}`)
    .replace(/\{luna\}/gi, `${m}.${y}`)
    .replace(/\{an\}/gi, y);
}
