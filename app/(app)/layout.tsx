import { requireUser, isSuper } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { unreadCount } from "@/lib/queries/notifications";
import { getCompanySettings } from "@/lib/queries/company";
import AppShell from "@/app/components/AppShell";
import PWARegister from "@/app/components/PWARegister";
import OpenInApp from "@/app/components/OpenInApp";
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
    </AppShell>
  );
}
