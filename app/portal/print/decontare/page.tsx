import { requireClient } from "@/lib/client-dal";
import { getPayerStatement } from "@/lib/services/payer-statement";
import { getCompanySettings } from "@/lib/queries/company";
import PayerStatementView from "@/app/components/PayerStatementView";
import { getT } from "@/lib/i18n/server-t";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { getMessages } from "@/lib/i18n";
import { I18nProvider } from "@/lib/i18n/context";

export const dynamic = "force-dynamic";

/** Pagina de tipărire a decontării (fără meniu / butoane) — o folosește generatorul de PDF și butonul „Printează”. Clientul vine din sesiune. */
export default async function PortalStatementPrintPage() {
  const t = await getT();
  const locale = await getLocaleFromCookie();
  const client = await requireClient();
  const [statement, company] = await Promise.all([getPayerStatement(client.id, { forPortal: true }), getCompanySettings()]);
  const today = new Date().toLocaleDateString(locale === "ru" ? "ru-RU" : locale === "en" ? "en-GB" : "ro-RO", { timeZone: "Europe/Bucharest" });

  return (
    <I18nProvider messages={getMessages(locale)} locale={locale}>
      <div className="min-h-dvh bg-white p-4 text-black">
        <div className="mb-3 flex items-end justify-between gap-4 border-b border-zinc-300 pb-2">
          <div>
            <p className="text-sm font-bold">{company.companyName || "Apă-Canal"}</p>
            <h1 className="text-lg font-bold">{t("Decontare")} — {client.name}</h1>
          </div>
          <p className="text-xs text-zinc-600">{t("Data generării")}: {today}</p>
        </div>
        {statement && (
          <>
            <div className="mb-3 grid grid-cols-2 gap-x-4 text-sm">
              <div><span className="text-xs text-zinc-600">{t("Cont personal")}: </span><b>{statement.client.meterSeries ?? "—"}</b></div>
              <div><span className="text-xs text-zinc-600">{t("Adresă")}: </span><b>{statement.client.consumAddress ?? "—"}</b></div>
            </div>
            <PayerStatementView statement={statement} portal />
          </>
        )}
      </div>
    </I18nProvider>
  );
}
