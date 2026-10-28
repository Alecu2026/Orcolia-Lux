export type CategoryLite = {
  id: string;
  name: string;
  color: string;
  defaultDurationMinutes: number;
};

export type QuickDefaults = {
  today: string;
  tomorrow: string;
  slotMinutes: number;
  /** Fusul orar al utilizatorului (din setări), pentru ora implicită a programării. */
  tz?: string;
  reminderEmail: boolean;
  reminderTelegram: boolean;
  reminderOffsets: string[];
};

export type ApptStatus =
  | "NEW"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "DONE"
  | "CANCELLED"
  | "NO_SHOW";

/** View-model pentru UI: orele sunt deja formatate pe server (în fusul userului). */
export type ApptVM = {
  id: string;
  clientId: string;
  clientName: string;
  title: string;
  status: ApptStatus;
  dateKey: string;
  time: string;
  endTime: string;
  categoryName: string | null;
  categoryColor: string | null;
  /** Culoarea rândului în liste (hex), aleasă de utilizator; null = fără. */
  color: string | null;
  remEmail: boolean;
  remTelegram: boolean;
  /** Categoria curentă (pentru editare). */
  categoryId: string | null;
  /** Durata în minute (pentru editare). */
  durationMinutes: number;
  /** Reminderele noi: programarea ca JSON (reminder-schedule.ts) sau ""; intervalul fix în minute (0 = niciunul); pragurile vechi — doar dacă nu există remindere noi. */
  remSchedule: string;
  remInterval: number;
  remOffsets: string[];
  /** „Mesaj / detalii” scris la creare (separat de „Descriere” = titlu). */
  message: string;
};

export type QuickPrefill = Partial<{
  /** Prezent ⇒ editarea programării existente (nu una nouă). */
  id: string;
  title: string;
  /** JSON-ul programării de remindere (sau ""), intervalul fix în minute. */
  reminderSchedule: string;
  reminderIntervalMinutes: number;
  clientId: string;
  clientName: string;
  clientPhone: string;
  clientEmail: string;
  categoryId: string;
  dateKey: string;
  time: string;
  durationMinutes: number;
  message: string;
  reminderEmail: boolean;
  reminderTelegram: boolean;
  reminderOffsets: string[];
  status: "NEW" | "CONFIRMED";
}>;
