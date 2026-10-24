import { getMessages } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/context";

// Factura (linkul public, previzualizarea din „Vezi", PDF-ul) este un document în română, indiferent de limba aplicației.
export default function InvoiceLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider messages={getMessages("ro")} locale="ro">
      {children}
    </I18nProvider>
  );
}
