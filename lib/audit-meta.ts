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
