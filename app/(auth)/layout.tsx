import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { getMessages } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/context";
import LanguageSwitcher from "@/app/components/LanguageSwitcher";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocaleFromCookie();
  const messages = getMessages(locale);

  return (
    <I18nProvider messages={messages} locale={locale}>
      <div className="fixed right-3 top-3 z-50"><LanguageSwitcher /></div>
      {children}
    </I18nProvider>
  );
}
