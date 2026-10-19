import { requirePermission } from "@/lib/dal";
import { getSettings } from "@/lib/queries/settings";
import { listCategories } from "@/lib/queries/categories";
import { listAllForUser } from "@/lib/queries/appointments";
import { todayKey, tomorrowKey } from "@/lib/date";
import { toVM } from "@/lib/view";
import AppointmentsTable from "@/app/components/AppointmentsTable";

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
  const items = (await listAllForUser(user.id)).map((a) => toVM(a, tz));

  const quickDefaults = {
    today,
    tomorrow,
    slotMinutes: settings.slotMinutes,
    reminderEmail: settings.defaultReminderEmail,
    reminderTelegram: settings.defaultReminderTelegram,
    reminderOffsets: settings.reminderOffsets,
  };

  return (
    <AppointmentsTable
      items={items}
      categories={categories}
      quickDefaults={quickDefaults}
      initialCreate={create === "1"}
      today={today}
      tz={tz}
    />
  );
}
