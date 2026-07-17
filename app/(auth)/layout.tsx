import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { getMessages } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/context";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocaleFromCookie();
  const messages = getMessages(locale);

  return (
    <I18nProvider messages={messages} locale={locale}>
      {children}
    </I18nProvider>
  );
}
