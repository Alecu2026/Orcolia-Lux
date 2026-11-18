import { redirect } from "next/navigation";
import { requireUser } from "@/lib/dal";
import { homePath } from "@/lib/permissions";
import { canEditManual, manualEditorLabel } from "@/lib/manual-editor";
import { loadManualShots } from "@/lib/services/manual-shots";
import { getManualState } from "@/lib/services/manual-state";
import { canViewManual, manualAudience, manualFor } from "@/lib/services/manual-access";
import { withoutEmptyShots } from "@/lib/manual/access";
import ManualView from "@/app/components/ManualView";
import { getT } from "@/lib/i18n/server-t";

export const dynamic = "force-dynamic";

/**
 * Manualul de utilizare. La început e o CIORNĂ: îl vede doar contul editor (lib/manual-editor.ts), care pune pozele și apasă „Finalizat”; apoi îl văd și ceilalți, cu dreptul „Manual de utilizare”,
 * doar paginile la care au acces (plus secțiunile generale). Filtrarea se face aici, pe server: conținutul fără drepturi nu ajunge în browser. Cititorii primesc doar pozele puse: cadrele goale
 * („de unde faci poza”) și uneltele pentru poze rămân ale editorului.
 */
export default async function ManualPage() {
  const t = await getT();
  const user = await requireUser();
  const state = await getManualState();
  if (!canViewManual(user, state.published)) redirect(homePath(user));
  const editor = canEditManual(user.email);
  const { sections: allowed, keys } = manualFor(user);
  const all = await loadManualShots();
  const shots = Object.fromEntries(Object.entries(all).filter(([k]) => keys.has(k)));
  const sections = editor ? allowed : withoutEmptyShots(allowed, new Set(Object.keys(shots)));
  const admin = manualAudience(user) === "administrator";
  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-3 print:hidden">
        <h1 className="text-xl font-bold">{admin ? t("Manual de utilizare pentru administrator") : t("Manual de utilizare")}</h1>
        <p className="mt-0.5 text-sm text-ink-soft">
          {admin ? t("Fiecare pagină a aplicației, explicată pas cu pas, simplu.") : t("Explicațiile pentru paginile la care ai acces, pas cu pas, simplu.")}
        </p>
      </div>
      <ManualView
        sections={sections}
        initialShots={shots}
        canEdit={editor}
        editorLabel={manualEditorLabel()}
        published={state.published}
        publishedAt={state.publishedAt}
        publishedBy={state.by}
      />
    </div>
  );
}
