import { requirePermission } from "@/lib/dal";
import { getSettings } from "@/lib/queries/settings";
import { listCategories } from "@/lib/queries/categories";
import { listAllForUser } from "@/lib/queries/appointments";
import { todayKey, tomorrowKey } from "@/lib/date";
import { toVM } from "@/lib/view";
import AppointmentsTable from "@/app/components/AppointmentsTable";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const user = await requirePermission("appointments.view");
  const [settings, categories] = await Promise.all([getSettings(user.id), listCategories()]);
  const tz = settings.timezone;
  const { create } = await searchParams;

  const today = todayKey(tz);
  const tomorrow = tomorrowKey(tz);
  // Toate programările odată; filtrarea (perioadă, status, categorie, text…) rulează în browser — vezi DataTable.
  const list = await listAllForUser(user.id);
  // utilizatorii activi cu acces la Programări: pentru lista „Pentru” (asignare) și pentru numele celor care au creat / pentru care e programarea
  const people = (await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true, permissions: true } })).filter((u) => can(u, "appointments.view"));
  const names = Object.fromEntries(people.map((u) => [u.id, u.name]));
  const missing = [...new Set(list.flatMap((a) => [a.userId, a.assigneeId]).filter((id): id is string => Boolean(id) && !names[id as string]))];
  if (missing.length) for (const u of await prisma.user.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } })) names[u.id] = u.name;
  const items = list.map((a) => toVM(a, tz, names));

  const quickDefaults = {
    today,
    tomorrow,
    slotMinutes: settings.slotMinutes,
    tz,
    reminderEmail: settings.defaultReminderEmail,
    reminderTelegram: settings.defaultReminderTelegram,
    reminderOffsets: settings.reminderOffsets,
    assignees: people.map((u) => ({ id: u.id, name: u.name, me: u.id === user.id })).sort((a, b) => a.name.localeCompare(b.name)),
  };

  return (
    <AppointmentsTable
      items={items}
      categories={categories}
      quickDefaults={quickDefaults}
      initialCreate={create === "1"}
      today={today}
      tz={tz}
      canManage={can(user, "appointments.manage")}
      canExport={can(user, "appointments.export")}
      canImport={can(user, "appointments.import")}
      userId={user.id}
    />
  );
}
