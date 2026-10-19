import { requirePermission } from "@/lib/dal";
import { listClients } from "@/lib/queries/clients";
import ClientsTable, { type ClientRow } from "@/app/components/ClientsTable";

export const dynamic = "force-dynamic";

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ create?: string }>;
}) {
  const user = await requirePermission("clients.view");
  const { create } = await searchParams;

  // Toți clienții odată (filtrarea, sortarea și paginarea rulează în browser — vezi DataTable).
  const { items } = await listClients(user.id, { pageSize: 20000 });

  const rows: ClientRow[] = items.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    telegramChatId: c.telegramChatId,
    notes: c.notes,
    noShowCount: c.noShowCount,
    lastAppointmentAt: c.lastAppointmentAt ? c.lastAppointmentAt.toISOString() : null,
  }));

  return (
    <div className="w-full">
      <ClientsTable items={rows} openCreate={create === "1"} />
    </div>
  );
}
