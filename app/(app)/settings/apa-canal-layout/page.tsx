import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import { getCompanySettings } from "@/lib/queries/company";
import { updateApaCanalLayout } from "@/app/actions/company";
import ApaCanalLayoutEditor from "@/app/components/ApaCanalLayoutEditor";
import { IconChevronLeft } from "@/app/components/icons";

export const dynamic = "force-dynamic";

export default async function ApaCanalLayoutPage() {
  const user = await requireUser();
  if (!can(user, "admin")) redirect("/settings");

  const company = await getCompanySettings();
  const host = (await headers()).get("host") ?? undefined;
  // O factură Apă-Canal reală (cea mai recentă) — editorul o arată în iframe ca să verifici șablonul salvat pe date reale.
  const sample = DEMO
    ? null
    : await prisma.invoice
        .findFirst({ where: { kind: "APA_CANAL" }, orderBy: { issueDate: "desc" }, select: { publicToken: true } })
        .catch(() => null);

  return (
    <div className="w-full">
      <Link href="/settings" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-4" /> Înapoi la setări
      </Link>
      <h1 className="mb-1 text-xl font-bold">Șablon factură Apă-Canal</h1>
      <p className="mb-4 text-sm text-ink-soft">
        Pânza de mai jos e exact pagina din PDF (A4 landscape, 297×210 mm). Trage și redimensionează elementele, sau scrie valorile în mm în panoul din dreapta.
        Se aplică pe toate facturile Apă-Canal ale acestui site, existente și viitoare — în portal, în linkul public și în PDF.
      </p>
      <ApaCanalLayoutEditor company={company} onSave={updateApaCanalLayout} sampleToken={sample?.publicToken ?? null} host={host} />
    </div>
  );
}
