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
  Tasks: "Task-uri",
  Tickets: "Tichete",
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

  "task.create": "Creare task",
  "task.update": "Editare task",
  "task.edit": "Editare task",
  "task.delete": "Ștergere task",
  "task.status_change": "Schimbare status task",
  "task.progress_change": "Schimbare progres task",
  "task.assign": "Asignare task",

  "ticket.create": "Creare tichet",
  "ticket.update": "Editare tichet",
  "ticket.edit": "Editare tichet",
  "ticket.delete": "Ștergere tichet",
  "ticket.status_change": "Schimbare status tichet",

  "project.create": "Creare proiect",
  "project.update": "Editare proiect",
  "project.delete": "Ștergere proiect",

  "client.create": "Creare client",
  "client.update": "Editare client",
  "client.delete": "Ștergere client",

  "invoice.create": "Creare factură",
  "invoice.update": "Editare factură",
  "invoice.delete": "Ștergere factură",
  "invoice.status_change": "Schimbare status factură",

  "user.create": "Creare utilizator",
  "user.update": "Editare utilizator",
  "user.delete": "Ștergere utilizator",
  "user.activate": "Activare utilizator",
  "user.deactivate": "Dezactivare utilizator",
  "user.permissions_change": "Schimbare permisiuni",
  "user.superadmin_change": "Schimbare super-admin",

  "settings.update": "Modificare setări",
  "notifications.settings_change": "Setări notificări",
};

// Etichete scurte pentru afișarea compactă (un singur rând).
const SHORT_LABELS: Record<string, string> = {
  "auth.login": "Autentificare",
  "auth.logout": "Delogare",
  "task.create": "Task creat",
  "task.update": "Task editat",
  "task.edit": "Task editat",
  "task.delete": "Task șters",
  "task.status_change": "Status schimbat",
  "task.progress_change": "Progres",
  "task.assign": "Asignat",
  "ticket.create": "Tichet creat",
  "ticket.update": "Tichet editat",
  "ticket.edit": "Tichet editat",
  "ticket.delete": "Tichet șters",
  "ticket.status_change": "Status schimbat",
  "project.create": "Proiect creat",
  "project.update": "Proiect editat",
  "project.delete": "Proiect șters",
  "client.create": "Client creat",
  "client.update": "Client editat",
  "client.delete": "Client șters",
  "invoice.create": "Factură creată",
  "invoice.update": "Factură editată",
  "invoice.delete": "Factură ștearsă",
  "invoice.status_change": "Status factură",
  "user.create": "Utilizator creat",
  "user.update": "Utilizator editat",
  "user.delete": "Utilizator șters",
  "user.activate": "Utilizator activat",
  "user.deactivate": "Utilizator dezactivat",
  "user.permissions_change": "Permisiuni schimbate",
  "user.superadmin_change": "Super-admin schimbat",
  "settings.update": "Setări modificate",
  "notifications.settings_change": "Setări notificări",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

export function moduleLabel(m: string): string {
  return MODULE_LABELS[m] ?? m;
}

/** Descriere compactă pentru un singur rând: „Status schimbat: Asignat → În lucru". */
export function rowSummary(r: {
  action: string;
  oldValue?: string | null;
  newValue?: string | null;
}): string {
  const label = SHORT_LABELS[r.action] ?? actionLabel(r.action);
  if (r.oldValue != null && r.newValue != null) {
    return `${label}: ${r.oldValue} → ${r.newValue}`;
  }
  return label;
}

// Listă pentru filtrul „tip acțiune" în UI (cheie + etichetă).
export const ACTION_OPTIONS = Object.entries(ACTION_LABELS).map(([key, label]) => ({ key, label }));
