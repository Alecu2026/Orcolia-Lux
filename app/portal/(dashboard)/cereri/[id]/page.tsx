import Link from "next/link";
import { notFound } from "next/navigation";
import { requireClient } from "@/lib/client-dal";
import { prisma } from "@/lib/prisma";
import { TASK_STATUS_RO } from "@/lib/telegram";
import { fmtDate } from "@/app/components/invoice-meta";
import { formatMinutes } from "@/lib/resolution";
import TicketChat from "@/app/components/TicketChat";
import TicketFeedback from "@/app/components/TicketFeedback";
import { IconChevronLeft } from "@/app/components/icons";
import { getT } from "@/lib/i18n/server-t";

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
  const tr = await getT();
  const client = await requireClient();
  const { id } = await params;
  if (!/^[0-9a-f]{24}$/i.test(id)) notFound();

  const t = await prisma.task.findFirst({
    where: { id, clientId: client.id, type: "TICKET" },
    select: { id: true, seq: true, title: true, description: true, status: true, createdAt: true, address: true, consumerName: true, executedAt: true, measuresTaken: true, resolutionMinutes: true, feedbackRating: true, feedbackComment: true },
  });
  if (!t) notFound();

  return (
    <div className="flex flex-col gap-3">
      <Link href="/portal/cereri" className="inline-flex items-center gap-1 text-xs text-ink-soft hover:text-ink">
        <IconChevronLeft className="size-3.5" /> {tr("Cererile mele")}
      </Link>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-base font-bold leading-snug">
            {t.seq ? <span className="text-ink-soft">#{t.seq} · </span> : ""}
            {t.title}
          </h1>
          <p className="mt-0.5 text-xs text-ink-soft">{tr("Deschis pe {v1}", { v1: fmtDate(t.createdAt) })}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLS[t.status] ?? "bg-[var(--color-surface-2)] text-ink-soft"}`}>
          {TASK_STATUS_RO[t.status] ?? t.status}
        </span>
      </div>

      <div className="card grid grid-cols-2 gap-x-4 gap-y-2 p-3 text-sm">
        {t.address && (
          <div className="col-span-2 min-w-0">
            <p className="text-[11px] text-ink-soft">{tr("Adresa")}</p>
            <p className="font-medium">{t.address}</p>
          </div>
        )}
        {t.consumerName && (
          <div className="col-span-2 min-w-0">
            <p className="text-[11px] text-ink-soft">{tr("Nume consumator")}</p>
            <p className="font-medium">{t.consumerName}</p>
          </div>
        )}
        <div>
          <p className="text-[11px] text-ink-soft">{tr("Data depunerii")}</p>
          <p className="font-medium">{fmtDate(t.createdAt)}</p>
        </div>
        <div>
          <p className="text-[11px] text-ink-soft">{tr("Data executării")}</p>
          <p className={`font-medium ${t.executedAt ? "text-st-done" : "text-ink-soft"}`}>{t.executedAt ? fmtDate(t.executedAt) : tr("încă neexecutată")}</p>
        </div>
      </div>

      {t.status === "DONE" && (t.measuresTaken || t.resolutionMinutes != null) && (
        <div className="card border-st-done/30 bg-st-done/5 p-3 text-sm" data-portal-resolution="">
          <p className="mb-1 text-xs font-semibold text-st-done">✓ {tr("Rezolvare")}</p>
          {t.measuresTaken && (
            <div className="mb-2">
              <p className="text-[11px] text-ink-soft">{tr("Măsuri luate")}</p>
              <p className="whitespace-pre-wrap break-words font-medium">{t.measuresTaken}</p>
            </div>
          )}
          {t.resolutionMinutes != null && (
            <div>
              <p className="text-[11px] text-ink-soft">{tr("Timp de rezolvare")}</p>
              <p className="font-medium">{formatMinutes(t.resolutionMinutes)}</p>
            </div>
          )}
        </div>
      )}

      {t.status === "DONE" && (
        <TicketFeedback
          ticketId={t.id}
          initialRating={t.feedbackRating ?? null}
          initialComment={t.feedbackComment ?? null}
          readOnlyReason={client.impersonation ? tr("Simulare: feedback-ul nu se trimite în numele clientului.") : null}
        />
      )}

      {t.description && (
        <details className="card px-3 py-2 text-sm" open={false}>
          <summary className="cursor-pointer text-xs font-semibold text-ink-soft">{tr("Descrierea cererii")}</summary>
          <p className="mt-1.5 whitespace-pre-wrap text-sm">{t.description}</p>
        </details>
      )}

      <TicketChat ticketId={t.id} viewer="client" ownName={client.name} heightClass="h-[min(34rem,calc(100dvh-17rem))] min-h-[18rem]" />
      <p className="text-center text-[11px] text-ink-soft">
        {tr("Răspunsurile echipei apar aici imediat și îți sosesc și pe email{v1}.", { v1: client.email ? ` (${client.email})` : "" })}</p>
    </div>
  );
}
