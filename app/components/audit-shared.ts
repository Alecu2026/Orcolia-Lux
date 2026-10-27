// Funcții și tipuri partajate între lista de jurnale și pop-up-ul de detalii (fără React: evită importul circular între cele două).

export type AuditRow = {
  id: string;
  userId: string | null;
  userName: string;
  userRole: string;
  action: string;
  module: string;
  objectId: string | null;
  objectName: string | null;
  oldValue: string | null;
  newValue: string | null;
  ip: string | null;
  hasDetails: boolean;
  createdAt: string;
};

const fmtCache = new Map<string, Intl.DateTimeFormat>();
/** Data și ora în fusul firmei (aceeași ca în export), cu secunde. */
export function fmtStamp(d: string | Date, tag: string, seconds = true): string {
  let f = fmtCache.get(`${tag}|${seconds}`);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, {
      timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", ...(seconds ? { second: "2-digit" } : {}), hour12: false,
    });
    fmtCache.set(`${tag}|${seconds}`, f);
  }
  return f.format(new Date(d));
}

export function roleLabel(r: string): string {
  if (r.includes("SUPER")) return "Super";
  if (r.includes("ADMIN")) return "Admin";
  if (r.includes("STAFF")) return "Staff";
  return r.slice(0, 5);
}
export function roleCls(r: string): string {
  if (r.includes("SUPER")) return "bg-purple-100 text-purple-700";
  if (r.includes("ADMIN")) return "bg-brand/10 text-brand";
  return "bg-[var(--color-surface-2)] text-ink-soft";
}

/** Culoarea modulului (o idee rapidă despre ce s-a întâmplat, fără să citești rândul). */
export function moduleCls(m: string): string {
  switch (m) {
    case "Auth": return "bg-slate-100 text-slate-700";
    case "Users": return "bg-purple-100 text-purple-700";
    case "Invoices": return "bg-amber-100 text-amber-800";
    case "Payers":
    case "Clients": return "bg-sky-100 text-sky-800";
    case "Meters": return "bg-teal-100 text-teal-800";
    case "Settings":
    case "Integrations": return "bg-rose-100 text-rose-700";
    default: return "bg-brand/10 text-brand";
  }
}

