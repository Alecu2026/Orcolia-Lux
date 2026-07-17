export type QuietHoursConfig = {
  quietHoursEnabled: boolean;
  quietHoursStart: string; // "HH:MM"
  quietHoursEnd: string;   // "HH:MM"
  quietHoursTz: string;
};

/**
 * Returns true if `now` falls within the configured quiet hours window.
 * Handles overnight spans (e.g. 22:00 – 07:00).
 */
export function isQuietTime(now: Date, cfg: QuietHoursConfig): boolean {
  if (!cfg.quietHoursEnabled) return false;

  const timeStr = new Intl.DateTimeFormat("en-GB", {
    timeZone: cfg.quietHoursTz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const toMins = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
  };

  const start = toMins(cfg.quietHoursStart);
  const end = toMins(cfg.quietHoursEnd);
  const cur = toMins(timeStr);

  return start < end
    ? cur >= start && cur < end   // same-day (e.g. 08:00–20:00)
    : cur >= start || cur < end;  // overnight (e.g. 22:00–07:00)
}
