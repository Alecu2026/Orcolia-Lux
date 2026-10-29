import { requireUser } from "@/lib/dal";
import NotificationsInbox from "@/app/components/NotificationsInbox";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Inbox-ul de notificări: fluxul ultimelor notificări, live, grupat pe zile, cu filtre și acțiuni rapide. Lista completă o aduce browserul (memorie → IndexedDB → server,
 * ca la Plătitori), deci pagina nu citește notificările pe server: se deschide instant și rămâne fluidă cu mii de notificări (vezi NotificationsInbox).
 */
export default async function NotificationsPage() {
  const user = await requireUser();
  return (
    <div className="mx-auto w-full max-w-3xl">
      <NotificationsInbox userId={user.id} canAppointments={can(user, "appointments.manage")} />
    </div>
  );
}
