import Link from "next/link";
import { requireClient } from "@/lib/client-dal";
import { prisma } from "@/lib/prisma";
import { TASK_STATUS_RO } from "@/lib/telegram";
import { fmtDate } from "@/app/components/invoice-meta";
import PortalNewTicketForm from "@/app/components/PortalNewTicketForm";
import { IconTicket } from "@/app/components/icons";

export const dynamic = "force-dynamic";

const TICKET_STATUS_CLS: Record<string, string> = {
  NEW: "bg-st-new/12 text-st-new",
  ASSIGNED: "bg-st-new/12 text-st-new",
  READ: "bg-st-new/12 text-st-new",
  IN_PROGRESS: "bg-st-progress/12 text-st-progress",
  ON_HOLD: "bg-st-progress/12 text-st-progress",
  REVIEW: "bg-st-progress/12 text-st-progress",
  DONE: "bg-st-done/12 text-st-done",
  CANCELLED: "bg-st-cancelled/12 text-st-cancelled",
};

export default async function PortalTicketsPage() {
  const client = await requireClient();

  const rows = await prisma.task.findMany({
    where: { clientId: client.id, type: "TICKET" },
    select: {
      id: true, seq: true, title: true, description: true, status: true, createdAt: true,
      chatLastMsgAt: true, chatLastSender: true, chatClientReadAt: true,
    },
  });
  // cele cu activitate recentă (mesaj nou) primele
  const tickets = rows.sort((a, b) => (b.chatLastMsgAt ?? b.createdAt).getTime() - (a.chatLastMsgAt ?? a.createdAt).getTime());

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-bold">Cererile mele</h1>
        <p className="mt-0.5 text-xs text-ink-soft">{tickets.length} tichete în total</p>
      </div>

      <div className="card p-4">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
          <IconTicket className="size-4 text-brand" />
          Creează un tichet nou
        </h2>
        <PortalNewTicketForm />
      </div>

      {tickets.length === 0 ? (
        <div className="card p-6 text-center text-sm text-ink-soft">Nu ai creat încă nicio cerere.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {tickets.map((t) => (
            <Link key={t.id} href={`/portal/tickets/${t.id}`} className="card block cursor-pointer p-4 hover:border-brand">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm font-semibold">
                  {t.seq ? <span className="text-ink-soft">#{t.seq} · </span> : ""}
                  {t.title}
                </p>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${TICKET_STATUS_CLS[t.status] ?? "bg-[var(--color-surface-2)] text-ink-soft"}`}>
                  {TASK_STATUS_RO[t.status] ?? t.status}
                </span>
              </div>
              {t.description && <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-soft">{t.description}</p>}
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-ink-soft">
                <span>{fmtDate(t.createdAt)}</span>
                {t.chatLastSender === "STAFF" && (!t.chatClientReadAt || (t.chatLastMsgAt && t.chatClientReadAt < t.chatLastMsgAt)) ? (
                  <span className="rounded-full bg-brand px-2 py-0.5 font-semibold text-white">● Mesaj nou</span>
                ) : (
                  <span className="font-medium text-brand">💬 Deschide conversația →</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
