// Constante partajate pentru Audit Logs (folosite și pe server, și pe client).

export const AUDIT_MODULES = [
  "Tasks",
  "Tickets",
  "Projects",
  "Clients",
  "Invoices",
  "Users",
  "Settings",
  "Auth",
  "Notifications",
  "Payers",
  "Meters",
  "Integrations",
] as const;
export type AuditModuleName = (typeof AUDIT_MODULES)[number];

export const MODULE_LABELS: Record<string, string> = {
  Tasks: "Sarcini",
  Tickets: "Cereri",
  Projects: "Proiecte",
  Clients: "Clienți",
  Invoices: "Facturi",
  Users: "Utilizatori",
  Settings: "Setări",
  Auth: "Autentificare",
  Notifications: "Notificări",
  Payers: "Plătitori",
  Meters: "Contoare",
  Integrations: "Integrări",
};

export const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Autentificare",
  "auth.logout": "Delogare",

  "task.create": "Creare sarcină",
  "task.update": "Editare sarcină",
  "task.edit": "Editare sarcină",
  "task.delete": "Ștergere sarcină",
  "task.status_change": "Schimbare status sarcină",
  "task.progress_change": "Schimbare progres sarcină",
  "task.assign": "Asignare sarcină",

  "ticket.create": "Creare cerere",
  "ticket.update": "Editare cerere",
  "ticket.edit": "Editare cerere",
  "ticket.delete": "Ștergere cerere",
  "ticket.status_change": "Schimbare status cerere",

  "project.create": "Creare proiect",
  "project.update": "Editare proiect",
  "project.delete": "Ștergere proiect",

  "client.create": "Creare client",
  "client.update": "Editare client",
  "client.delete": "Ștergere client",
  "client.bulk_delete": "Ștergere în masă plătitori",

  "invoice.create": "Creare factură",
  "invoice.update": "Editare factură",
  "invoice.delete": "Ștergere factură",
  "invoice.status_change": "Schimbare status factură",
  "invoice.bulk_import": "Import în masă (Apă-Canal)",
  "invoice.bulk_tariff_update": "Aplicare tarif nou la facturi existente",

  "user.create": "Creare utilizator",
  "user.update": "Editare utilizator",
  "user.delete": "Ștergere utilizator",
  "user.activate": "Activare utilizator",
  "user.deactivate": "Dezactivare utilizator",
  "user.permissions_change": "Schimbare permisiuni",
  "user.superadmin_change": "Schimbare super-admin",

  "settings.update": "Modificare setări",
  "notifications.settings_change": "Setări notificări",
  "payer.notify": "Notificare plătitori (email/SMS)",
  "user.update_profile": "Editare profil propriu",
  "user.password_change": "Schimbare parolă",
  "auth.password_reset": "Resetare parolă",
  "client.portal_reset": "Resetare cont portal client",
  "integration.update": "Modificare integrare",
  "meter.reading": "Citire contor din teren",
  "meter.location": "Adresă / locație contor",
};

// Etichete scurte pentru afișarea compactă (un singur rând).
const SHORT_LABELS: Record<string, string> = {
  "auth.login": "Autentificare",
  "auth.logout": "Delogare",
  "task.create": "Sarcină creată",
  "task.update": "Sarcină editată",
  "task.edit": "Sarcină editată",
  "task.delete": "Sarcină ștearsă",
  "task.status_change": "Status schimbat",
  "task.progress_change": "Progres",
  "task.assign": "Asignat",
  "ticket.create": "Cerere creată",
  "ticket.update": "Cerere editată",
  "ticket.edit": "Cerere editată",
  "ticket.delete": "Cerere ștearsă",
  "ticket.status_change": "Status schimbat",
  "project.create": "Proiect creat",
  "project.update": "Proiect editat",
  "project.delete": "Proiect șters",
  "client.create": "Client creat",
  "client.update": "Client editat",
  "client.delete": "Client șters",
  "client.bulk_delete": "Plătitori șterși în masă",
  "invoice.create": "Factură creată",
  "invoice.update": "Factură editată",
  "invoice.delete": "Factură ștearsă",
  "invoice.status_change": "Status factură",
  "invoice.bulk_import": "Import în masă",
  "invoice.bulk_tariff_update": "Tarif nou aplicat retroactiv",
  "user.create": "Utilizator creat",
  "user.update": "Utilizator editat",
  "user.delete": "Utilizator șters",
  "user.activate": "Utilizator activat",
  "user.deactivate": "Utilizator dezactivat",
  "user.permissions_change": "Permisiuni schimbate",
  "user.superadmin_change": "Super-admin schimbat",
  "settings.update": "Setări modificate",
  "notifications.settings_change": "Setări notificări",
  "payer.notify": "Notificare plătitori",
  "user.update_profile": "Profil editat",
  "user.password_change": "Parolă schimbată",
  "auth.password_reset": "Parolă resetată",
  "client.portal_reset": "Cont portal resetat",
  "integration.update": "Integrare modificată",
  "meter.reading": "Citire contor",
  "meter.location": "Adresă / locație contor",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

type Tr = (ro: string) => string;

export function moduleLabel(m: string, t?: Tr): string {
  const l = MODULE_LABELS[m] ?? m;
  return t ? t(l) : l;
}

/** Descriere compactă pentru un singur rând: „Status schimbat: Asignat → În lucru". */
export function rowSummary(
  r: {
    action: string;
    oldValue?: string | null;
    newValue?: string | null;
  },
  t: Tr = (x) => x,
): string {
  const label = t(SHORT_LABELS[r.action] ?? actionLabel(r.action));
  if (r.oldValue != null && r.newValue != null) {
    return `${label}: ${t(r.oldValue)} → ${t(r.newValue)}`;
  }
  return label;
}

// Listă pentru filtrul „tip acțiune" în UI (cheie + etichetă).
export const ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([key, label]) => ({ key, label }));

// ── Detalii structurate ──────────────────────────────────────────────────────────────────────────────────────────

/** O modificare pe un câmp: valoarea veche → cea nouă (text deja formatat pentru afișare; null = gol). */
export type AuditChange = { field: string; label: string; old: string | null; new: string | null };
/** Informații suplimentare (etichetă → valoare), afișate în pop-up (ex. „Consum: 12 m³”). */
export type AuditExtra = { label: string; value: string };
export type AuditDetails = { changes?: AuditChange[]; extra?: AuditExtra[] };

/** Citește câmpul `details` (JSON) fără să arunce: o valoare coruptă înseamnă „fără detalii”. */
export function parseDetails(raw: string | null | undefined): AuditDetails | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as AuditDetails;
    if (!j || typeof j !== "object") return null;
    const changes = Array.isArray(j.changes) ? j.changes.filter((c) => c && typeof c.label === "string") : undefined;
    const extra = Array.isArray(j.extra) ? j.extra.filter((x) => x && typeof x.label === "string") : undefined;
    return changes?.length || extra?.length ? { changes, extra } : null;
  } catch {
    return null;
  }
}

/** Valoarea veche / nouă a unui jurnal, ca listă de câmpuri dacă e JSON de tip obiect (altfel null → se afișează ca text). */
export function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw || raw[0] !== "{") return null;
  try {
    const j = JSON.parse(raw);
    return j && typeof j === "object" && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Link spre obiectul afectat (null = nu există pagină sau a fost șters). */
export function objectHref(module: string, objectId: string | null, action: string): string | null {
  if (!objectId || action.endsWith(".delete") || action.endsWith(".bulk_delete")) return null;
  switch (module) {
    case "Tasks":
    case "Tickets":
      return module === "Tickets" ? `/tickets/${objectId}` : `/tasks/${objectId}`;
    case "Projects":
      return `/projects/${objectId}`;
    case "Clients":
    case "Payers":
      return `/platitori/${objectId}`;
    case "Invoices":
      return `/invoices/${objectId}/edit`;
    case "Meters":
      return `/contoare/${encodeURIComponent(objectId)}`;
    default:
      return null;
  }
}

/** Descrie un user-agent pe scurt: browser · sistem · tip dispozitiv. */
export function describeAgent(ua: string | null | undefined): { browser: string; os: string; device: string } | null {
  if (!ua) return null;
  const browser = /Edg\/([\d.]+)/.exec(ua) ? `Edge ${/Edg\/(\d+)/.exec(ua)?.[1]}`
    : /OPR\/(\d+)/.exec(ua) ? `Opera ${/OPR\/(\d+)/.exec(ua)?.[1]}`
    : /Firefox\/(\d+)/.exec(ua) ? `Firefox ${/Firefox\/(\d+)/.exec(ua)?.[1]}`
    : /Chrome\/(\d+)/.exec(ua) ? `Chrome ${/Chrome\/(\d+)/.exec(ua)?.[1]}`
    : /Version\/(\d+).*Safari/.exec(ua) ? `Safari ${/Version\/(\d+)/.exec(ua)?.[1]}`
    : /curl\//.test(ua) ? "curl"
    : "Necunoscut";
  const os = /Windows NT 10/.test(ua) ? "Windows" : /Windows/.test(ua) ? "Windows"
    : /Android (\d+)/.exec(ua) ? `Android ${/Android (\d+)/.exec(ua)?.[1]}`
    : /(iPhone|iPad|iPod)/.test(ua) ? "iOS"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux" : "Necunoscut";
  const device = /iPad|Tablet/.test(ua) ? "Tabletă" : /Mobi|iPhone|Android/.test(ua) ? "Telefon" : "Calculator";
  return { browser, os, device };
}

// ── Filtrele paginii Audit Logs (în adresă și în API) ───────────────────────────────────────────────────────────

export type AuditFilterState = {
  user: string;
  role: "" | "ADMIN" | "STAFF" | "SUPER";
  module: string;
  action: string;
  /** „YYYY-MM-DD” (ziua în fusul firmei). */
  from: string;
  to: string;
  q: string;
  /** Doar jurnalele cu modificări pe câmpuri. */
  changes: boolean;
};

export const EMPTY_AUDIT_FILTERS: AuditFilterState = { user: "", role: "", module: "", action: "", from: "", to: "", q: "", changes: false };

export function sanitizeAuditState(raw: Record<string, unknown>): AuditFilterState {
  const str = (v: unknown, max = 80) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const day = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const role = str(raw.role, 10).toUpperCase();
  return {
    user: /^[0-9a-f]{24}$/i.test(str(raw.user, 30)) ? str(raw.user, 30) : "",
    role: role === "ADMIN" || role === "STAFF" || role === "SUPER" ? role : "",
    module: (AUDIT_MODULES as readonly string[]).includes(str(raw.module)) ? str(raw.module) : "",
    action: /^[a-z_.]{1,60}$/.test(str(raw.action, 60)) ? str(raw.action, 60) : "",
    from: day(raw.from),
    to: day(raw.to),
    q: str(raw.q),
    changes: raw.changes === "1" || raw.changes === true,
  };
}

export function countActiveAuditFilters(f: AuditFilterState): number {
  return (f.user ? 1 : 0) + (f.role ? 1 : 0) + (f.module ? 1 : 0) + (f.action ? 1 : 0) + (f.from || f.to ? 1 : 0) + (f.q ? 1 : 0) + (f.changes ? 1 : 0);
}

/** Câte jurnale pe pagină (numeric) sau „all” = toate, încărcate pe bucăți și afișate cu virtualizare. */
export const AUDIT_PAGE_SIZES = [20, 50, 100, 200, 500, 1000] as const;
export const AUDIT_DEFAULT_PAGE_SIZE = 50;
export type AuditPs = number | "all";
/** „Toate” se oprește la atâtea jurnale (cele mai noi): peste, restrânge filtrele sau exportă. */
export const AUDIT_ALL_CAP = 50_000;
/** Mărimea bucăților în care se aduc „Toate”: prima mică (apare repede), următoarele mari. */
export const AUDIT_FIRST_CHUNK = 1000;
export const AUDIT_NEXT_CHUNK = 5000;
/** Cookie citit de server: câte pe pagină a ales utilizatorul (prima afișare vine cu mărimea potrivită). */
export const AUDIT_PS_COOKIE = "audit-ps";

export function normalizeAuditPs(v: unknown): AuditPs {
  if (v === "all") return "all";
  const n = Number(v);
  return (AUDIT_PAGE_SIZES as readonly number[]).includes(n) ? n : AUDIT_DEFAULT_PAGE_SIZE;
}

export function auditStateToParams(f: AuditFilterState, extra?: { page?: number; ps?: AuditPs }): URLSearchParams {
  const p = new URLSearchParams();
  if (f.user) p.set("user", f.user);
  if (f.role) p.set("role", f.role);
  if (f.module) p.set("module", f.module);
  if (f.action) p.set("action", f.action);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  if (f.q) p.set("q", f.q);
  if (f.changes) p.set("changes", "1");
  if (extra?.page && extra.page > 1) p.set("page", String(extra.page));
  if (extra?.ps && extra.ps !== AUDIT_DEFAULT_PAGE_SIZE) p.set("ps", String(extra.ps));
  return p;
}
