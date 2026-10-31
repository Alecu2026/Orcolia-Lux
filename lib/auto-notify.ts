// Notificările AUTOMATE către clienți (expirarea contractului, verificarea metrologică, termenul de remediere al neregulilor): pot fi oprite, iar canalele se aleg separat —
// SMS-ul costă bani, emailul nu (cod partajat server / browser). Implicit rămâne comportamentul de până acum: pornit, email + SMS.

export const AUTO_NOTIFY_KINDS = ["contract", "metrology", "issue"] as const;
export type AutoNotifyKind = (typeof AUTO_NOTIFY_KINDS)[number];

export type AutoNotifyRule = { enabled: boolean; email: boolean; sms: boolean };
export type AutoNotifySettings = Record<AutoNotifyKind, AutoNotifyRule>;

export const AUTO_NOTIFY_LABELS: Record<AutoNotifyKind, { title: string; desc: string }> = {
  contract: { title: "Expirarea contractului", desc: "Cu 30 și 10 zile înainte de data de expirare a contractului." },
  metrology: { title: "Verificarea metrologică", desc: "Cu 60, 30 și 10 zile înainte de scadența verificării contorului." },
  issue: { title: "Termenul de remediere al neregulilor", desc: "Cu 3 zile înainte și la depășirea termenului, când răspunde clientul." },
};

export const DEFAULT_AUTO_NOTIFY: AutoNotifySettings = {
  contract: { enabled: true, email: true, sms: true },
  metrology: { enabled: true, email: true, sms: true },
  issue: { enabled: true, email: true, sms: true },
};

/** Setările din JSON aduse la forma validă; ce lipsește sau e invalid revine la valoarea implicită. */
export function sanitizeAutoNotify(raw: unknown): AutoNotifySettings {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as AutoNotifySettings;
  for (const k of AUTO_NOTIFY_KINDS) {
    const d = DEFAULT_AUTO_NOTIFY[k];
    const r = src[k] && typeof src[k] === "object" ? (src[k] as Record<string, unknown>) : {};
    out[k] = {
      enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
      email: typeof r.email === "boolean" ? r.email : d.email,
      sms: typeof r.sms === "boolean" ? r.sms : d.sms,
    };
  }
  return out;
}

/** Canalele efective către client: oprit complet sau fără niciun canal bifat = nimic. */
export const effectiveChannels = (r: AutoNotifyRule): { email: boolean; sms: boolean } => ({ email: r.enabled && r.email, sms: r.enabled && r.sms });
