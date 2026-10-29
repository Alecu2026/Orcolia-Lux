// Catalog de evenimente pentru notificări „observator" (partajat server + client).
// Un utilizator primește notificare pentru un eveniment dacă cheia e în User.notifyEvents.
// Notă: destinatarii DIRECȚI (asignatul unui task, creatorul la schimbarea statusului)
// sunt notificați mereu — independent de aceste preferințe.

export const NOTIFY_EVENTS = [
  { key: "task.created", label: "Sarcină creată" },
  { key: "ticket.created", label: "Cerere creată" },
  { key: "task.assigned", label: "Sarcină asignată (cuiva)" },
  { key: "task.status", label: "Status sarcină schimbat (orice)" },
  { key: "task.read", label: "Sarcină citită" },
  { key: "task.done", label: "Sarcină finalizată" },
  { key: "task.overdue", label: "Sarcină în întârziere" },
  { key: "task.comment", label: "Comentariu nou pe sarcină" },
  { key: "task.progress", label: "Progres sarcină actualizată" },
  { key: "task.edit", label: "Sarcină/cerere modificată" },
  { key: "task.reminder", label: "Reamintire sarcină (periodică)" },
  { key: "ticket.portal", label: "Cerere nouă din portalul clienților" },
  { key: "meter.portal", label: "Neregulă de contor raportată din portal" },
  { key: "ticket.message", label: "Mesaj nou de la client pe o cerere" },
  { key: "ticket.email", label: "Cerere nouă din email" },
  { key: "project.created", label: "Proiect creat" },
  { key: "invoice.created", label: "Factură creată" },
  { key: "invoice.status", label: "Status factură schimbat" },
] as const;

export type NotifyEventKey = (typeof NOTIFY_EVENTS)[number]["key"];

export const NOTIFY_EVENT_KEYS = NOTIFY_EVENTS.map((e) => e.key) as string[];

export function notifyEventLabel(key: string): string {
  return NOTIFY_EVENTS.find((e) => e.key === key)?.label ?? key;
}
