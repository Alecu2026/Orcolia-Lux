import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { isSuper, requireUser, type CurrentUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getSettings } from "@/lib/queries/settings";
import { listCategories } from "@/lib/queries/categories";
import { getCompanySettings } from "@/lib/queries/company";
import { getAdminSettings } from "@/lib/queries/admin-settings";
import SettingsForm from "@/app/components/SettingsForm";
import MyProfileForm from "@/app/components/MyProfileForm";
import CategoriesManager from "@/app/components/CategoriesManager";
import CompanyDetailsForm from "@/app/components/CompanyDetailsForm";
import QuietHoursForm from "@/app/components/QuietHoursForm";
import EmailTicketAutoCloseForm from "@/app/components/EmailTicketAutoCloseForm";
import MeterIssueRulesForm from "@/app/components/MeterIssueRulesForm";
import AutoNotifyForm from "@/app/components/AutoNotifyForm";
import PushToggle from "@/app/components/PushToggle";
import BottomNavSettings from "@/app/components/BottomNavSettings";
import TicketStatusConfigEditor from "@/app/components/TicketStatusConfigEditor";
import { IconChevronRight } from "@/app/components/icons";
import { NAV_META, sanitizeBottomNav } from "@/lib/nav-meta";
import { teamNameMap } from "@/lib/services/meter-issues";
import SecurityPanel from "@/app/components/SecurityPanel";
import { getSessionToken, hashToken } from "@/lib/session";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { env } from "@/lib/env";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

type Tab = "me" | "security" | "company" | "workflow";

/**
 * Setări. Un utilizator obișnuit vede DOAR setările lui (profil, preferințe, notificări push, butoanele rapide, Telegram). Administratorii (rolul Administrator sau permisiunea „admin”)
 * au și filele „Companie” și „Cereri și notificări”. Fiecare filă își citește datele doar când e deschisă, iar datele de administrare nu sunt trimise deloc unui utilizator obișnuit
 * (nici ca formular doar de citit): nu apar în pagină, în HTML sau în răspunsul serverului.
 */
export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const user = await requireUser();
  const isAdmin = can(user, "admin");
  const sp = await searchParams;
  const tab: Tab = sp.tab === "security" ? "security" : isAdmin && (sp.tab === "company" || sp.tab === "workflow") ? sp.tab : "me";

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-5">
      {(
        <nav role="tablist" aria-label={t("Setări")} className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 text-sm" data-settings-tabs="">
          {([["me", "Contul meu", "/settings"], ["security", "Securitate", "/settings?tab=security"], ...(isAdmin ? ([["company", "Companie", "/settings?tab=company"], ["workflow", "Cereri și notificări", "/settings?tab=workflow"]] as const) : [])] as const).map(([k, label, href]) => (
            <Link key={k} href={href} role="tab" aria-selected={tab === k} data-tab={k} className={`tap shrink-0 rounded-lg px-3 py-1.5 font-medium ${tab === k ? "bg-brand text-white" : "text-ink-soft hover:bg-[var(--color-surface-2)]"}`}>
              {t(label)}
            </Link>
          ))}
        </nav>
      )}
      {tab === "me" && <MyTab user={user} />}
      {tab === "security" && <SecurityTab user={user} />}
      {tab === "company" && <CompanyTab user={user} />}
      {tab === "workflow" && <WorkflowTab user={user} />}
    </div>
  );
}

/** Setările personale — pentru orice utilizator. */
async function MyTab({ user }: { user: CurrentUser }) {
  const t = await getT();
  const [settings, me] = await Promise.all([getSettings(user.id), prisma.user.findUnique({ where: { id: user.id }, select: { telegramChatId: true } })]);
  return (
    <>
      <MyProfileForm name={user.name} email={user.email} telegramChatId={me?.telegramChatId ?? null} />
      <SettingsForm settings={settings} />
      <PushToggle />
      <BottomNavSettings
        // paginile la care utilizatorul are acces (aceleași reguli ca meniul)
        available={NAV_META.filter((n) => !n.perm || (n.perm === "audit.view" ? isSuper(user) : can(user, n.perm as never))).map((n) => ({ href: n.href, labelKey: n.labelKey }))}
        selected={sanitizeBottomNav(user.bottomNav)}
      />
      <Link href="/telegram" className="card tap flex items-center justify-between p-5 hover:border-brand">
        <div>
          <h2 className="text-base font-bold">{t("Telegram Bot")}</h2>
          <p className="text-sm text-ink-soft">{t("Conectează botul și gestionează din chat.")}</p>
        </div>
        <IconChevronRight className="size-5 text-brand" />
      </Link>
    </>
  );
}

/** Securitatea contului: autentificarea în doi pași și sesiunile active — pentru orice utilizator. */
async function SecurityTab({ user }: { user: CurrentUser }) {
  const [me, rows, token, locale] = await Promise.all([
    prisma.user.findUnique({ where: { id: user.id }, select: { totpEnabledAt: true, totpRecovery: true } }),
    prisma.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: "desc" }, take: 20, select: { id: true, userAgent: true, ip: true, lastUsedAt: true, tokenHash: true } }),
    getSessionToken(),
    getLocaleFromCookie(),
  ]);
  const cur = token ? hashToken(token) : null;
  return (
    <SecurityPanel
      enabled={!!me?.totpEnabledAt}
      recoveryLeft={me?.totpRecovery.length ?? 0}
      locale={locale}
      sessions={rows.map((r) => ({ id: r.id, userAgent: r.userAgent, ip: r.ip, lastUsedAt: r.lastUsedAt.toISOString(), current: r.tokenHash === cur }))}
    />
  );
}

/** Datele companiei, categoriile, orele de somn și șabloanele — doar administratori. */
async function CompanyTab({ user }: { user: CurrentUser }) {
  const t = await getT();
  const [company, categories, admin] = await Promise.all([getCompanySettings(), listCategories(), getAdminSettings()]);
  return (
    <>
      <CompanyDetailsForm company={company} canEdit />
      <CategoriesManager categories={categories} canManage />
      <QuietHoursForm config={admin.quietHours} canEdit={user.isSuperAdmin} />
      <Link href="/settings/apa-canal-layout" className="card tap flex items-center justify-between p-5 hover:border-brand">
        <div>
          <h2 className="text-base font-bold">{t("Șablon factură Apă-Canal")}</h2>
          <p className="text-sm text-ink-soft">{t("Editor vizual — trage, redimensionează, ajustează text și linii pe factură.")}</p>
        </div>
        <IconChevronRight className="size-5 text-brand" />
      </Link>
      <Link href="/settings/portal-accounts" className="card tap flex items-center justify-between p-5 hover:border-brand">
        <div>
          <h2 className="text-base font-bold">{t("Conturi portal clienți")}</h2>
          <p className="text-sm text-ink-soft">{t("Cine s-a activat, cine nu, când s-a logat ultima dată.")}</p>
        </div>
        <IconChevronRight className="size-5 text-brand" />
      </Link>
    </>
  );
}

/** Statusurile cererilor, închiderea automată, notificările automate către clienți și regulile neregulilor — doar administratori. */
async function WorkflowTab({ user }: { user: CurrentUser }) {
  const t = await getT();
  void user;
  const [admin, teamMap] = await Promise.all([getAdminSettings(), teamNameMap()]);
  return (
    <>
      <div className="card p-5 space-y-4">
        <div>
          <h2 className="text-base font-bold">{t("Statusuri cereri")}</h2>
          <p className="text-sm text-ink-soft">{t("Configurează etichetele, culorile și comportamentul notificărilor per status.")}</p>
        </div>
        <TicketStatusConfigEditor initial={admin.statusConfigs} />
      </div>
      <EmailTicketAutoCloseForm enabled={admin.autoClose.enabled} hours={admin.autoClose.hours} canEdit />
      <AutoNotifyForm initial={admin.autoNotify} canEdit emailEnabled={env.smtp.enabled} smsEnabled={env.sms.enabled} />
      <MeterIssueRulesForm initial={admin.issueRules} teams={[...teamMap].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ro"))} canEdit />
    </>
  );
}
