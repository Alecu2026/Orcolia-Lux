"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTaskExecutionDateAction } from "@/app/actions/tasks";
import { useToast } from "./toast";
import { useT } from "@/lib/i18n/context";

/**
 * „Data executării” a unei cereri: o stabilește echipa (o dată calendaristică). La finalizarea cererii se completează singură cu data zilei, dacă n-a fost setată;
 * se poate corecta oricând. Clientul o vede în portal.
 */
export default function ExecutionDateField({ taskId, value, canEdit }: { taskId: string; value: string | null; canEdit: boolean }) {
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const [v, setV] = useState(value ?? "");
  const [pending, start] = useTransition();
  const shown = value ? value.split("-").reverse().join(".") : null;

  if (!canEdit) return <p className="text-sm font-medium">{shown ?? "—"}</p>;

  function save(next: string) {
    start(async () => {
      const res = await setTaskExecutionDateAction(taskId, next || null);
      if (res?.error) {
        toast.error(t(res.error));
        setV(value ?? "");
        return;
      }
      toast.success(next ? t("Data executării a fost salvată.") : t("Data executării a fost ștearsă."));
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        type="date"
        value={v}
        disabled={pending}
        onChange={(e) => setV(e.target.value)}
        aria-label={t("Data executării")}
        className="h-8 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm outline-none focus:border-brand"
      />
      {v !== (value ?? "") && (
        <button type="button" disabled={pending} onClick={() => save(v)} className="tap h-8 cursor-pointer rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
          {t("Salvează")}
        </button>
      )}
    </div>
  );
}
