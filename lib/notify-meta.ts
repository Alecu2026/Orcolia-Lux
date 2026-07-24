// Catalog de evenimente pentru notificări „observator" (partajat server + client).
// Un utilizator primește notificare pentru un eveniment dacă cheia e în User.notifyEvents.
// Notă: destinatarii DIRECȚI (asignatul unui task, creatorul la schimbarea statusului)
// sunt notificați mereu — independent de aceste preferințe.

export const NOTIFY_EVENTS = [
  { key: "task.created", label: "Task creat" },
  { key: "ticket.created", label: "Tichet creat" },
  { key: "task.assigned", label: "Task asignat (cuiva)" },
  { key: "task.status", label: "Status task schimbat (orice)" },
  { key: "task.read", label: "Task citit" },
  { key: "task.done", label: "Task finalizat" },
  { key: "task.overdue", label: "Task în întârziere" },
  { key: "task.comment", label: "Comentariu nou pe task" },
  { key: "task.progress", label: "Progres task actualizat" },
  { key: "task.edit", label: "Task/tichet modificat" },
  { key: "project.created", label: "Proiect creat" },
  { key: "invoice.created", label: "Factură creată" },
  { key: "invoice.status", label: "Status factură schimbat" },
] as const;

export type NotifyEventKey = (typeof NOTIFY_EVENTS)[number]["key"];

export const NOTIFY_EVENT_KEYS = NOTIFY_EVENTS.map((e) => e.key) as string[];

export function notifyEventLabel(key: string): string {
  return NOTIFY_EVENTS.find((e) => e.key === key)?.label ?? key;
}
