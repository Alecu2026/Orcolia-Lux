import { requireUser, isSuper } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { unreadCount } from "@/lib/queries/notifications";
import { getCompanySettings } from "@/lib/queries/company";
import AppShell from "@/app/components/AppShell";
import PWARegister from "@/app/components/PWARegister";
import OpenInApp from "@/app/components/OpenInApp";
import PayersPrefetch from "@/app/components/PayersPrefetch";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { getMessages } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const [unread, company, locale] = await Promise.all([
    unreadCount(user.id),
    getCompanySettings(),
    getLocaleFromCookie(),
  ]);
  const messages = getMessages(locale);

  const perms: Record<string, boolean> = {
    "tasks.view": can(user, "tasks.view"),
    "projects.view": can(user, "projects.view"),
    "teams.view": can(user, "teams.view"),
    "invoices.view": can(user, "invoices.view"),
    "clients.view": can(user, "clients.view"),
    "clients.edit": can(user, "clients.edit"),
    "clients.create": can(user, "clients.create"),
    "tasks.create": can(user, "tasks.create"),
    "projects.create": can(user, "projects.create"),
    "appointments.manage": can(user, "appointments.manage"),
    "dashboard.view": can(user, "dashboard.view"),
    "tickets.view": can(user, "tickets.view"),
    "kanban.view": can(user, "kanban.view"),
    "calendar.view": can(user, "calendar.view"),
    "map.view": can(user, "map.view"),
    "payers.view": can(user, "payers.view"),
    "meters.read": can(user, "meters.read"),
    "pbx.view": can(user, "pbx.view"),
    "pbx.manage": can(user, "pbx.manage"),
    "appointments.view": can(user, "appointments.view"),
    "users.manage": can(user, "users.manage"),
    "audit.view": isSuper(user),
  };

  return (
    <AppShell
      userName={user.name}
      demo={DEMO}
      perms={perms}
      unread={unread}
      appointmentsLabel={company.appointmentsLabel}
      messages={messages}
      locale={locale}
    >
      {children}
      <PWARegister unread={unread} />
      <OpenInApp />
      {(perms["payers.view"] || perms["invoices.view"]) && <PayersPrefetch payers={perms["payers.view"]} invoices={perms["invoices.view"]} />}
    </AppShell>
  );
}
