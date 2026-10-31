"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTicketResolutionAction } from "@/app/actions/tasks";
import { formatElapsed, formatMinutes } from "@/lib/resolution";
import { useResolutionPrompt } from "./ResolutionDialog";
import { useToast } from "./toast";
import { useT } from "@/lib/i18n/context";

/**
 * „Rezolvare” la o cerere închisă: măsurile luate, timpul de rezolvare (cât a lucrat echipa) și durata totală de la depunere până la închidere.
 * Cine poate edita poate corecta măsurile și timpul (aceeași fereastră ca la finalizare).
 */
export default function TicketResolution({
  taskId,
  measures,
  minutes,
  createdAt,
  closedAt,
  canEdit,
}: {
  taskId: string;
  measures: string | null;
  minutes: number | null;
  createdAt: string;
  closedAt: string | null;
  canEdit: boolean;
}) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const rp = useResolutionPrompt();
  const [, start] = useTransition();
  const [busy, setBusy] = useState(false);
  const total = closedAt ? new Date(closedAt).getTime() - new Date(createdAt).getTime() : null;

  function edit() {
    rp.ask({ initial: { measures, minutes }, createdAt, confirmLabel: t("Salvează") }, (r) => {
      setBusy(true);
      start(async () => {
        const res = await setTicketResolutionAction(taskId, r);
        setBusy(false);
        if (res?.error) return toast.error(t(res.error));
        toast.success(t("Rezolvarea a fost salvată."));
        router.refresh();
      });
    });
  }

  return (
    <section className="mt-4 rounded-xl border border-st-done/30 bg-st-done/5 p-3" data-ticket-resolution="">
      {rp.node}
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold">{t("Rezolvare")}</h3>
        {canEdit && (
          <button type="button" onClick={edit} disabled={busy} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft disabled:opacity-50">
            ✎ {t("Editează")}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <div className="col-span-2 min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{t("Măsuri luate")}</p>
          <p className="whitespace-pre-wrap break-words font-medium">{measures || <span className="text-ink-soft">—</span>}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{t("Timp de rezolvare")}</p>
          <p className="font-medium">{minutes != null ? formatMinutes(minutes) : "—"}</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">{t("Durată totală (de la depunere)")}</p>
          <p className="font-medium">{total != null && total >= 0 ? formatElapsed(total, t) : "—"}</p>
        </div>
      </div>
    </section>
  );
}
