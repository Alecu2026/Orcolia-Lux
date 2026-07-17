import { requirePermission } from "@/lib/dal";
import { getSettings } from "@/lib/queries/settings";
import { listCategories } from "@/lib/queries/categories";
import { listByDateKey, listByDateKeys } from "@/lib/queries/appointments";
import { todayKey, tomorrowKey, weekKeys, addDaysToKey } from "@/lib/date";
import { toVM } from "@/lib/view";
import AppointmentsManager from "@/app/components/AppointmentsManager";
import type { AppointmentStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["NEW", "CONFIRMED", "IN_PROGRESS", "DONE", "CANCELLED", "NO_SHOW"]);

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; create?: string; q?: string; status?: string; category?: string }>;
}) {
  const user = await requirePermission("appointments.view");
  const [settings, categories] = await Promise.all([
    getSettings(user.id),
    listCategories(),
  ]);
  const tz = settings.timezone;
  const { view = "azi", create, q = "", status = "", category = "" } = await searchParams;

  const filter = {
    search: q.trim() || undefined,
    status: (status && VALID_STATUSES.has(status) ? status : undefined) as AppointmentStatus | undefined,
    categoryId: category || undefined,
  };

  const today = todayKey(tz);
  const tomorrow = tomorrowKey(tz);
  let items;
  let grouped = false;

  if (view === "maine") {
    items = (await listByDateKey(user.id, tomorrow, filter)).map((a) => toVM(a, tz));
  } else if (view === "saptamana") {
    items = (await listByDateKeys(user.id, weekKeys(today, tz), filter)).map((a) => toVM(a, tz));
    grouped = true;
  } else if (view === "lista") {
    const keys = Array.from({ length: 14 }, (_, i) => addDaysToKey(today, i, tz));
    items = (await listByDateKeys(user.id, keys, filter)).map((a) => toVM(a, tz));
    grouped = true;
  } else {
    items = (await listByDateKey(user.id, today, filter)).map((a) => toVM(a, tz));
  }

  const quickDefaults = {
    today,
    tomorrow,
    slotMinutes: settings.slotMinutes,
    reminderEmail: settings.defaultReminderEmail,
    reminderTelegram: settings.defaultReminderTelegram,
    reminderOffsets: settings.reminderOffsets,
  };

  return (
    <AppointmentsManager
      initialItems={items}
      initialView={view}
      initialQ={q}
      initialStatus={status}
      initialCategory={category}
      initialGrouped={grouped}
      categories={categories}
      quickDefaults={quickDefaults}
      initialCreate={create === "1"}
      today={today}
      tz={tz}
    />
  );
}
