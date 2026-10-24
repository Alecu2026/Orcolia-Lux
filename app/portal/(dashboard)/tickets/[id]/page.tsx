import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/client-dal";
import { prisma } from "@/lib/prisma";
import { TASK_STATUS_RO } from "@/lib/telegram";
import { fmtDate } from "@/app/components/invoice-meta";
import TicketChat from "@/app/components/TicketChat";
import { IconChevronLeft } from "@/app/components/icons";

export const dynamic = "force-dynamic";

const STATUS_CLS: Record<string, string> = {
  NEW: "bg-st-new/12 text-st-new",
  ASSIGNED: "bg-st-new/12 text-st-new",
  READ: "bg-st-new/12 text-st-new",
  IN_PROGRESS: "bg-st-progress/12 text-st-progress",
  ON_HOLD: "bg-st-progress/12 text-st-progress",
  REVIEW: "bg-st-progress/12 text-st-progress",
  DONE: "bg-st-done/12 text-st-done",
  CANCELLED: "bg-st-cancelled/12 text-st-cancelled",
};

/** Conversația clientului cu echipa pe un tichet: chat cu mesaje în timp real; un mesaj nou de la echipă ajunge și pe email. */
export default async function PortalTicketPage({ params }: { params: Promise<{ id: string }> }) {
  const client = await requireClient();
  const { id } = await params;
  if (!/^[0-9a-f]{24}$/i.test(id)) notFound();

  const t = await prisma.task.findFirst({
    where: { id, clientId: client.id, type: "TICKET" },
    select: { id: true, seq: true, title: true, description: true, status: true, createdAt: true },
  });
  if (!t) notFound();

  return (
    <div className="flex flex-col gap-3">
      <Link href="/portal/tickets" className="inline-flex items-center gap-1 text-xs text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-3.5" /> Tichetele mele
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-bold leading-snug">
            {t.seq ? <span className="text-ink-soft">#{t.seq} · </span> : ""}
            {t.title}
          </h1>
          <p className="mt-0.5 text-xs text-ink-soft">Deschis pe {fmtDate(t.createdAt)}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLS[t.status] ?? "bg-[var(--color-surface-2)] text-ink-soft"}`}>
          {TASK_STATUS_RO[t.status] ?? t.status}
        </span>
      </div>

      {t.description && (
        <details className="card px-3 py-2 text-sm" open={false}>
          <summary className="cursor-pointer text-xs font-semibold text-ink-soft">Descrierea cererii</summary>
          <p className="mt-1.5 whitespace-pre-wrap text-sm">{t.description}</p>
        </details>
      )}

      <TicketChat ticketId={t.id} viewer="client" ownName={client.name} heightClass="h-[min(34rem,calc(100dvh-17rem))] min-h-[18rem]" />
      <p className="text-center text-[11px] text-ink-soft">
        Răspunsurile echipei apar aici imediat și îți sosesc și pe email{client.email ? ` (${client.email})` : ""}.
      </p>
    </div>
  );
}
