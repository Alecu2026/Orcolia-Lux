import { requirePermission } from "@/lib/dal";
import { getT } from "@/lib/i18n/server-t";
import { loadTenderChecks } from "@/app/actions/tender";
import TenderChecklist from "@/app/components/TenderChecklist";
import { TENDER_EDITOR_EMAIL, canEditTenderChecks } from "@/lib/tender-editor";
import TenderPdfButton from "@/app/components/TenderPdfButton";

export const dynamic = "force-dynamic";

/**
 * Caietul de sarcini (BD Contract 3 WSS Cahul Rural, secțiunea VII): toate punctele, în engleză și în română, de bifat împreună; fiecare cu un buton „i” care spune unde se găsește în CRM și cum e implementat.
 * Punctele stau în lib/tender-spec.ts; bifele se salvează în baza de date (comune pentru echipă).
 */
export default async function ContractPage() {
  const t = await getT();
  const user = await requirePermission("users.manage");
  const initial = await loadTenderChecks();
  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-3">
        <h1 className="text-xl font-bold">{t("Caiet de sarcini")}</h1>
        <p className="mt-0.5 text-sm text-ink-soft">{t("BD Contract 3 WSS Cahul Rural — Section VII, Particular Technical Specifications. Bifele sunt comune pentru toată echipa și le modifică doar {email}.", { email: TENDER_EDITOR_EMAIL })}</p>
      </div>
      <div className="mb-3">
        <TenderPdfButton />
      </div>
      <TenderChecklist initial={initial} canEdit={canEditTenderChecks(user.email)} editorEmail={TENDER_EDITOR_EMAIL} />
    </div>
  );
}
