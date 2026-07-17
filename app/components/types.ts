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
  remEmail: boolean;
  remTelegram: boolean;
};

export type QuickPrefill = Partial<{
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
