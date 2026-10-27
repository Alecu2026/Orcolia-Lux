import { requirePermission } from "@/lib/dal";
import { can, canViewTaskData } from "@/lib/permissions";
import { currentPeriod } from "@/lib/meter-readings";
import MeterPageClient from "@/app/components/MeterPageClient";

export const dynamic = "force-dynamic";

/**
 * Pagina unui contor. Serverul face doar verificarea accesului și trimite scheletul: conținutul se construiește în browser din lista de contoare
 * deja încărcată (memorie / IndexedDB), iar de pe server se cer numai datele care lipsesc din ea — vezi app/components/MeterPageClient.tsx și
 * app/api/contoare/page/route.ts. Id-ul din adresă e stabil între sincronizările 1C (vezi lib/queries/meters.ts).
 */
export default async function MeterPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission("payers.view");
  const { id: rawId } = await params;
  let id = rawId;
  try {
    id = decodeURIComponent(rawId);
  } catch {}
  return (
    <MeterPageClient
      id={id}
      currentPeriod={currentPeriod()}
      canTask={can(user, "tasks.create")}
      canEditInvoices={can(user, "invoices.edit")}
      canRead={can(user, "meters.read")}
      canViewTasks={canViewTaskData(user)}
    />
  );
}
