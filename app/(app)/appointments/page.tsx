import { requirePermission } from "@/lib/dal";
import { getSettings } from "@/lib/queries/settings";
import { listCategories } from "@/lib/queries/categories";
import { apptPeople, getApptManifest, getUserNameMap, listApptWindow } from "@/lib/services/appointment-cache";
import { addDaysToKey, todayKey, tomorrowKey } from "@/lib/date";
import { toVM } from "@/lib/view";
import AppointmentsTable from "@/app/components/AppointmentsTable";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const user = await requirePermission("appointments.view");
  // utilizatorii activi cu acces la Programări (lista „Pentru”) și numele tuturor (cei care au creat / pentru care e programarea) vin din memorie, în paralel cu setările
  const [settings, categories, allPeople, nameMap] = await Promise.all([getSettings(user.id), listCategories(), apptPeople(), getUserNameMap()]);
  const tz = settings.timezone;
  const { create } = await searchParams;

  const today = todayKey(tz);
  const tomorrow = tomorrowKey(tz);
  // Prima afișare: doar programările apropiate (azi − 7 zile … azi + 90 de zile); istoricul vine în browser lună cu lună (IndexedDB, doar lunile noi / modificate — vezi
  // lib/services/appointment-cache.ts), iar filtrarea (perioadă, status, categorie, text…) rulează tot în browser — vezi DataTable. Înainte se încărcau TOATE programările la fiecare deschidere.
  const [list, manifest] = await Promise.all([listApptWindow(user.id, addDaysToKey(today, -7, tz), addDaysToKey(today, 90, tz)), getApptManifest(user.id)]);
  const people = allPeople.filter((u) => can(u, "appointments.view"));
  const items = list.map((a) => toVM(a, tz, nameMap));

  const quickDefaults = {
    today,
    tomorrow,
    slotMinutes: settings.slotMinutes,
    tz,
    reminderEmail: settings.defaultReminderEmail,
    reminderTelegram: settings.defaultReminderTelegram,
    reminderOffsets: [], // fără remindere standard: la o programare nouă nu e bifat nimic, se aleg per programare
    assignees: people.map((u) => ({ id: u.id, name: u.name, me: u.id === user.id })).sort((a, b) => a.name.localeCompare(b.name)),
  };

  return (
    <AppointmentsTable
      items={items}
      manifest={manifest}
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
