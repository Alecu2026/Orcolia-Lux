import { z } from "zod";

const dateKeyRe = /^\d{4}-\d{2}-\d{2}$/;
const timeRe = /^\d{2}:\d{2}$/;
const hexColorRe = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/;

export const APPOINTMENT_STATUSES = [
  "NEW",
  "CONFIRMED",
  "IN_PROGRESS",
  "DONE",
  "CANCELLED",
  "NO_SHOW",
] as const;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email invalid."),
  password: z.string().min(1, "Introdu parola."),
});

export const clientSchema = z.object({
  name: z.string().trim().min(1, "Numele e obligatoriu.").max(120),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Email invalid.")
    .optional()
    .or(z.literal("")),
  telegramChatId: z.string().trim().max(40).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Numele categoriei e obligatoriu.").max(60),
  color: z.string().regex(hexColorRe, "Culoare hex invalidă.").default("#6366f1"),
  // Durată flexibilă: zecimale permise, fără plafon strict; fallback 30 dacă e gol/invalid.
  defaultDurationMinutes: z.coerce.number().gt(0).max(100000).catch(30),
});

/**
 * Formular rapid de programare. Acceptă fie un client existent (clientId),
 * fie un client nou (clientName + opțional telefon/email) — creat automat.
 */
export const quickAppointmentSchema = z
  .object({
    clientId: z.string().trim().optional().or(z.literal("")),
    clientName: z.string().trim().max(120).optional().or(z.literal("")),
    clientPhone: z.string().trim().max(40).optional().or(z.literal("")),
    clientEmail: z
      .string()
      .trim()
      .toLowerCase()
      .email("Email client invalid.")
      .optional()
      .or(z.literal("")),
    categoryId: z.string().trim().optional().or(z.literal("")),
    dateKey: z.string().regex(dateKeyRe, "Dată invalidă (YYYY-MM-DD)."),
    time: z.string().regex(timeRe, "Oră invalidă (HH:mm)."),
    durationMinutes: z.coerce.number().gt(0).max(100000).catch(30),
    title: z.string().trim().max(120).optional().or(z.literal("")),
    message: z.string().trim().max(2000).optional().or(z.literal("")),
    reminderEmail: z.coerce.boolean().default(false),
    reminderTelegram: z.coerce.boolean().default(false),
    reminderOffsets: z.array(z.string()).default([]),
    status: z.enum(["NEW", "CONFIRMED"]).default("NEW"),
  })
  .refine((d) => Boolean(d.clientId) || Boolean(d.clientName), {
    message: "Alege un client sau introdu un nume.",
    path: ["clientName"],
  });

export const updateStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(APPOINTMENT_STATUSES),
});

export const rescheduleSchema = z.object({
  id: z.string().min(1),
  dateKey: z.string().regex(dateKeyRe),
  time: z.string().regex(timeRe),
  durationMinutes: z.coerce.number().gt(0).max(100000).optional(),
});

export const settingsSchema = z.object({
  timezone: z.string().trim().min(1).default("Europe/Bucharest"),
  locale: z.string().trim().min(1).default("ro"),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  workdayStart: z.string().regex(timeRe).default("09:00"),
  workdayEnd: z.string().regex(timeRe).default("18:00"),
  slotMinutes: z.coerce.number().gt(0).max(100000).catch(30),
  defaultReminderEmail: z.coerce.boolean().default(false),
  defaultReminderTelegram: z.coerce.boolean().default(true),
  reminderOffsets: z.array(z.string()).default(["DAY_BEFORE_8AM", "H3"]),
  emailFromName: z.string().trim().max(80).optional().or(z.literal("")),
  emailFromAddr: z
    .string()
    .trim()
    .email()
    .optional()
    .or(z.literal("")),
});

/** Structura extrasă de AI din comanda vocală (înainte de confirmare). */
export const voiceParsedSchema = z.object({
  intent: z.enum(["create", "reschedule", "unknown"]).default("create"),
  clientName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  category: z.string().trim().optional(),
  dateKey: z.string().regex(dateKeyRe).optional(),
  time: z.string().regex(timeRe).optional(),
  durationMinutes: z.number().int().optional(),
  message: z.string().trim().optional(),
  reminderEmail: z.boolean().optional(),
  reminderTelegram: z.boolean().optional(),
});

/** Structura extrasă de AI pentru task/tichet vocal. */
export const taskVoiceParsedSchema = z.object({
  title: z.string().trim().optional(),
  type: z.enum(["TASK", "TICKET"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: z.string().regex(dateKeyRe).optional(),
  dueTime: z.string().regex(timeRe).optional(),
  assigneeId: z.string().trim().optional(),
  teamId: z.string().trim().optional(),
  projectId: z.string().trim().optional(),
  newProjectName: z.string().trim().optional(),
  clientId: z.string().trim().optional(),
  newClientName: z.string().trim().optional(),
});

/** Schema universală pentru orice comandă vocală CRM. */
export const universalVoiceParsedSchema = z.object({
  entity: z.enum(["task", "ticket", "project", "client", "invoice"]).default("task"),
  // Titlu principal (task title / project name / client name / invoice desc)
  title: z.string().trim().optional(),
  // Task/Ticket
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueDate: z.string().regex(dateKeyRe).optional(),
  dueTime: z.string().regex(timeRe).optional(),
  assigneeId: z.string().trim().optional(),
  teamId: z.string().trim().optional(),
  projectId: z.string().trim().optional(),
  newProjectName: z.string().trim().optional(),
  // Client comun (task/project/invoice)
  clientId: z.string().trim().optional(),
  newClientName: z.string().trim().optional(),
  // Project
  description: z.string().trim().optional(),
  // Client extra
  clientPhone: z.string().trim().optional(),
  clientEmail: z.string().trim().optional(),
  // Invoice
  invoiceAmount: z.number().optional(),
  invoiceDueDate: z.string().regex(dateKeyRe).optional(),
  invoiceNotes: z.string().trim().optional(),
  invoiceItems: z.array(z.object({
    description: z.string(),
    qty: z.number().default(1),
    unitPrice: z.number().default(0),
  })).optional(),
});

export type QuickAppointmentInput = z.infer<typeof quickAppointmentSchema>;
export type ClientInput = z.infer<typeof clientSchema>;
export type SettingsInput = z.infer<typeof settingsSchema>;
export type VoiceParsed = z.infer<typeof voiceParsedSchema>;
export type TaskVoiceParsed = z.infer<typeof taskVoiceParsedSchema>;
export type UniversalVoiceParsed = z.infer<typeof universalVoiceParsedSchema>;
