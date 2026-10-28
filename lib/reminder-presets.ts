/**
 * Presetări de remindere pentru programări — partajate între UI (client) și
 * calculul efectiv al orei de trimitere (server). Fără dependențe server-only
 * ca să poată fi importate direct în componente client.
 */
export const REMINDER_PRESETS = [
  { key: "DAY_BEFORE_8AM", label: "Cu o zi înainte (08:00)" },
  { key: "H3", label: "Cu 3 ore înainte" },
  { key: "M30", label: "Cu 30 minute înainte" },
  { key: "M10", label: "Cu 10 minute înainte" },
] as const;

export type ReminderPresetKey = (typeof REMINDER_PRESETS)[number]["key"];

export const REMINDER_PRESET_KEYS: ReminderPresetKey[] = REMINDER_PRESETS.map((p) => p.key);

/** "Standard" — selecția implicită la o programare nouă. */
export const DEFAULT_REMINDER_PRESETS: ReminderPresetKey[] = ["DAY_BEFORE_8AM", "H3"];

/**
 * Pragurile fixe vechi, exprimate în minute înainte de începere (pentru noul selector de remindere, care lucrează cu minute).
 * „Cu o zi înainte (08:00)” depinde de ora programării: cu `time` (HH:mm) e exact (de la 08:00 ziua precedentă), fără ea — 1440.
 */
export function presetsToMinutes(keys: string[], time?: string): number[] {
  const [hh, mm] = (time ?? "").split(":").map(Number);
  const dayBefore = Number.isFinite(hh) && Number.isFinite(mm) ? 16 * 60 + hh * 60 + mm : 1440;
  const map: Record<ReminderPresetKey, number> = { DAY_BEFORE_8AM: dayBefore, H3: 180, M30: 30, M10: 10 };
  return [...new Set(sanitizeReminderPresets(keys).map((k) => map[k]))].sort((a, b) => b - a);
}

export function sanitizeReminderPresets(keys: string[]): ReminderPresetKey[] {
  const valid = keys.filter((k): k is ReminderPresetKey =>
    (REMINDER_PRESET_KEYS as string[]).includes(k),
  );
  return [...new Set(valid)];
}
