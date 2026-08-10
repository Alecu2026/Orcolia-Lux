import { requireClient } from "@/lib/client-dal";
import { prisma } from "@/lib/prisma";
import { TASK_STATUS_RO } from "@/lib/telegram";
import { fmtDate } from "@/app/components/invoice-meta";
import PortalNewTicketForm from "@/app/components/PortalNewTicketForm";

export const dynamic = "force-dynamic";

export default async function PortalTicketsPage() {
  const client = await requireClient();

  const tickets = await prisma.task.findMany({
    where: { clientId: client.id, type: "TICKET" },
    orderBy: { createdAt: "desc" },
    select: { id: true, seq: true, title: true, description: true, status: true, createdAt: true },
  });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-bold">Tichetele mele</h1>

      <div className="card p-4">
        <h2 className="mb-3 text-sm font-semibold">Creează un tichet nou</h2>
        <PortalNewTicketForm />
      </div>

      {tickets.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-soft">Nu ai creat încă niciun tichet.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {tickets.map((t) => (
            <div key={t.id} className="card p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">
                  {t.seq ? `#${t.seq} · ` : ""}
                  {t.title}
                </p>
                <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                  {TASK_STATUS_RO[t.status] ?? t.status}
                </span>
              </div>
              {t.description && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-soft">{t.description}</p>}
              <p className="mt-2 text-xs text-ink-soft">{fmtDate(t.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
