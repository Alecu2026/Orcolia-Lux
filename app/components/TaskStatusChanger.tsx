"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTaskStatus } from "@/app/actions/tasks";
import { useToast } from "./toast";
import { useMessages } from "@/lib/i18n/context";

type Status = "NEW" | "ASSIGNED" | "READ" | "IN_PROGRESS" | "ON_HOLD" | "REVIEW" | "DONE" | "CANCELLED";

const STATUS_COLORS: Record<Status, string> = {
  NEW:         "bg-st-new/15 text-st-new border-st-new/40 hover:bg-st-new/30",
  ASSIGNED:    "bg-st-new/15 text-st-new border-st-new/40 hover:bg-st-new/30",
  READ:        "bg-st-confirmed/15 text-st-confirmed border-st-confirmed/40 hover:bg-st-confirmed/30",
  IN_PROGRESS: "bg-st-progress/15 text-st-progress border-st-progress/40 hover:bg-st-progress/30",
  ON_HOLD:     "bg-st-noshow/15 text-st-noshow border-st-noshow/40 hover:bg-st-noshow/30",
  REVIEW:      "bg-st-confirmed/15 text-st-confirmed border-st-confirmed/40 hover:bg-st-confirmed/30",
  DONE:        "bg-st-done/15 text-st-done border-st-done/40 hover:bg-st-done/30",
  CANCELLED:   "bg-st-cancelled/15 text-st-cancelled border-st-cancelled/40 hover:bg-st-cancelled/30",
};

const ACTIVE_RING: Record<Status, string> = {
  NEW:         "!bg-st-new !text-white !border-st-new",
  ASSIGNED:    "!bg-st-new !text-white !border-st-new",
  READ:        "!bg-st-confirmed !text-white !border-st-confirmed",
  IN_PROGRESS: "!bg-st-progress !text-white !border-st-progress",
  ON_HOLD:     "!bg-st-noshow !text-white !border-st-noshow",
  REVIEW:      "!bg-st-confirmed !text-white !border-st-confirmed",
  DONE:        "!bg-st-done !text-white !border-st-done",
  CANCELLED:   "!bg-st-cancelled !text-white !border-st-cancelled",
};

export default function TaskStatusChanger({
  taskId,
  initialStatus,
}: {
  taskId: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const m = useMessages();
  const [, startTransition] = useTransition();
  const [status, setStatus] = useState(initialStatus as Status);
  const [busy, setBusy] = useState(false);

  const STATUSES = (Object.keys(STATUS_COLORS) as Status[]).map((value) => ({
    value,
    label: m.status[value],
    color: STATUS_COLORS[value],
  }));

  async function change(next: Status) {
    if (next === status || busy) return;
    const prev = status;
    setStatus(next);
    setBusy(true);
    try {
      const res = await setTaskStatus(taskId, next);
      if (res?.error) {
        setStatus(prev);
        toast.error(res.error);
      } else {
        toast.success(`Status: ${m.status[next]}`);
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {STATUSES.map((s) => {
        const isActive = s.value === status;
        return (
          <button
            key={s.value}
            onClick={() => change(s.value)}
            disabled={busy}
            className={[
              "rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all disabled:opacity-50",
              s.color,
              isActive ? ACTIVE_RING[s.value] : "",
              isActive ? "scale-105 shadow-sm" : "opacity-70",
            ].join(" ")}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
