import Link from "next/link";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { getCompanySettings } from "@/lib/queries/company";
import { updateApaCanalLayout } from "@/app/actions/company";
import ApaCanalLayoutEditor from "@/app/components/ApaCanalLayoutEditor";
import { IconChevronLeft } from "@/app/components/icons";

export const dynamic = "force-dynamic";

export default async function ApaCanalLayoutPage() {
  const user = await requireUser();
  if (!can(user, "admin")) redirect("/settings");

  const company = await getCompanySettings();

  return (
    <div className="w-full">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-4" /> Înapoi la setări
      </Link>
      <h1 className="mb-1 text-xl font-bold">Șablon factură Apă-Canal</h1>
      <p className="mb-4 text-sm text-ink-soft">
        Trage și redimensionează elementele direct pe factura de exemplu de mai jos, sau editează valorile exact în panoul din dreapta.
        Se aplică pe toate facturile Apă-Canal, existente și viitoare.
      </p>
      <ApaCanalLayoutEditor company={company} onSave={updateApaCanalLayout} />
    </div>
  );
}
