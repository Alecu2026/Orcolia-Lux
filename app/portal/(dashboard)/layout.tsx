import { requireClient } from "@/lib/client-dal";
import { getCompanySettings } from "@/lib/queries/company";
import { clientLogout } from "@/app/actions/client-auth";
import PortalNav from "@/app/components/PortalNav";
import { IconDroplet, IconLogout } from "@/app/components/icons";
import { getT } from "@/lib/i18n/server-t";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { getMessages } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/context";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";
import ImpersonationBanner from "@/app/components/ImpersonationBanner";

export const dynamic = "force-dynamic";

export default async function PortalDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = await getT();
  const locale = await getLocaleFromCookie();
  const messages = getMessages(locale);
  const client = await requireClient();
  const company = await getCompanySettings();

  return (
    <I18nProvider messages={messages} locale={locale}>
    {/* PWA: fără bandă de simulare, conținutul începe sub bara de stare (ora, rețeaua); cu bandă, ea acoperă zona sigură */}
    <div className={`min-h-dvh bg-[var(--color-app)] ${client.impersonation ? "" : "pt-[env(safe-area-inset-top)]"}`}>
      {/* eslint-disable-next-line react-hooks/purity -- momentul curent afișat la randare (valoare de afișare, nu stare) */}
      {client.impersonation && <ImpersonationBanner who={client.name} by={client.impersonation.byName} expiresAt={client.impersonation.expiresAt} serverNow={Date.now()} exitAction="/api/simulare/portal-exit" className="sticky top-0" />}
      <div className="h-1 bg-brand" />
      <header className="border-b border-[var(--color-line)] bg-[var(--color-surface)] print:hidden">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand text-white">
              <IconDroplet className="size-5" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-4">{company.companyName || "Portal client"}</p>
              <p className="truncate text-xs text-ink-soft">{client.name}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <PortalNav />
            <LanguageSwitcher />
            <form action={clientLogout}>
              <button
                type="submit"
                className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]"
                title={t("Deconectare")}
                aria-label={t("Deconectare")}
              >
                <IconLogout className="size-4" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
    </div>
    </I18nProvider>
  );
}
