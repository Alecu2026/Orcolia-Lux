import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/queries/settings";
import { listCategories } from "@/lib/queries/categories";
import { getCompanySettings, getQuietHoursSettings } from "@/lib/queries/company";
import SettingsForm from "@/app/components/SettingsForm";
import MyProfileForm from "@/app/components/MyProfileForm";
import CategoriesManager from "@/app/components/CategoriesManager";
import CompanyDetailsForm from "@/app/components/CompanyDetailsForm";
import QuietHoursForm from "@/app/components/QuietHoursForm";
import PushToggle from "@/app/components/PushToggle";
import BottomNavSettings from "@/app/components/BottomNavSettings";
import { NAV_META, sanitizeBottomNav } from "@/lib/nav-meta";
import { isSuper } from "@/lib/dal";
import TicketStatusConfigEditor from "@/app/components/TicketStatusConfigEditor";
import { IconChevronRight } from "@/app/components/icons";
import { loadStatusConfigs } from "@/lib/queries/ticket-status-config";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const t = await getT();
  const user = await requireUser();
  const [settings, categories, company, quietHours, statusConfigs, me] = await Promise.all([
    getSettings(user.id),
    listCategories(),
    getCompanySettings(),
    getQuietHoursSettings(),
    loadStatusConfigs(),
    prisma.user.findUnique({ where: { id: user.id }, select: { telegramChatId: true } }),
  ]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      <MyProfileForm name={user.name} email={user.email} telegramChatId={me?.telegramChatId ?? null} />
      <CompanyDetailsForm company={company} canEdit={can(user, "admin")} />
      <SettingsForm settings={settings} />
      <CategoriesManager categories={categories} canManage={user.role === "ADMIN"} />
      <QuietHoursForm config={quietHours} canEdit={user.isSuperAdmin} />
      <PushToggle />
      <BottomNavSettings
        // paginile la care utilizatorul are acces (aceleași reguli ca meniul)
        available={NAV_META.filter((n) => !n.perm || (n.perm === "audit.view" ? isSuper(user) : can(user, n.perm as never))).map((n) => ({ href: n.href, labelKey: n.labelKey }))}
        selected={sanitizeBottomNav(user.bottomNav)}
      />

      {user.role === "ADMIN" && (
        <div className="card p-5 space-y-4">
          <div>
            <h2 className="text-base font-bold">{t("Statusuri cereri")}</h2>
            <p className="text-sm text-ink-soft">
              {t("Configurează etichetele, culorile și comportamentul notificărilor per status.")}
            </p>
          </div>
          <TicketStatusConfigEditor initial={statusConfigs} />
        </div>
      )}

      {can(user, "admin") && (
        <Link
          href="/settings/apa-canal-layout"
          className="card tap flex items-center justify-between p-5 hover:border-brand"
        >
          <div>
            <h2 className="text-base font-bold">{t("Șablon factură Apă-Canal")}</h2>
            <p className="text-sm text-ink-soft">{t("Editor vizual — trage, redimensionează, ajustează text și linii pe factură.")}</p>
          </div>
          <IconChevronRight className="size-5 text-brand" />
        </Link>
      )}

      {can(user, "admin") && (
        <Link
          href="/settings/portal-accounts"
          className="card tap flex items-center justify-between p-5 hover:border-brand"
        >
          <div>
            <h2 className="text-base font-bold">{t("Conturi portal clienți")}</h2>
            <p className="text-sm text-ink-soft">{t("Cine s-a activat, cine nu, când s-a logat ultima dată.")}</p>
          </div>
          <IconChevronRight className="size-5 text-brand" />
        </Link>
      )}

      <Link
        href="/telegram"
        className="card tap flex items-center justify-between p-5 hover:border-brand"
      >
        <div>
          <h2 className="text-base font-bold">{t("Telegram Bot")}</h2>
          <p className="text-sm text-ink-soft">{t("Conectează botul și gestionează din chat.")}</p>
        </div>
        <IconChevronRight className="size-5 text-brand" />
      </Link>
    </div>
  );
}
