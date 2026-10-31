import { cookies } from "next/headers";
import { preload } from "react-dom";
import { requirePermission } from "@/lib/dal";
import { listClients } from "@/lib/queries/clients";
import ClientsTable from "@/app/components/ClientsTable";
import { can } from "@/lib/permissions";
import { CLIENTS_V_COOKIE } from "@/lib/payer-prefs";
import { CLIENT_HEAD_ROWS, CLIENT_INLINE_MAX, type ClientRow } from "@/lib/clients-snapshot";
import { getClientSnap } from "@/lib/services/client-cache";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const user = await requirePermission("clients.view");
  const { create } = await searchParams;

  // Lista vine din memoria serverului (lib/services/client-cache.ts). Puțini clienți: toți, direct în pagină, ca înainte. Mulți: doar cei mai recenți; lista completă o aduce browserul o singură
  // dată (IndexedDB, ETag) și filtrarea, sortarea și paginarea rulează tot în browser — vezi DataTable. Fără cache (ex. fără `prisma generate`) se citește ca înainte din baza de date.
  let rows: ClientRow[];
  let total = 0;
  let version: string | null = null;
  try {
    const snap = await getClientSnap();
    total = snap.count;
    if (snap.count <= CLIENT_INLINE_MAX) rows = snap.rows;
    else {
      rows = snap.rows.slice(0, CLIENT_HEAD_ROWS);
      version = snap.version;
      const jar = await cookies();
      if (jar.get(CLIENTS_V_COOKIE)?.value !== snap.version) preload("/api/clients/snapshot", { as: "fetch", crossOrigin: "anonymous" });
    }
  } catch (e) {
    console.error("[clients] cache indisponibil, citesc din baza de date:", e);
    const { items } = await listClients(user.id, { pageSize: 20000 });
    rows = items.map((c) => ({
      id: c.id, name: c.name, phone: c.phone, email: c.email, telegramChatId: c.telegramChatId, notes: c.notes, noShowCount: c.noShowCount,
      lastAppointmentAt: c.lastAppointmentAt ? c.lastAppointmentAt.toISOString() : null,
    }));
    total = rows.length;
  }

  return (
    <div className="w-full">
      <ClientsTable canExport={can(user, "clients.export")} canImport={can(user, "clients.import")} items={rows} total={total} version={version} openCreate={create === "1"} canEdit={can(user, "clients.edit")} canCreate={can(user, "clients.create")} canDelete={can(user, "clients.delete")} />
    </div>
  );
}
