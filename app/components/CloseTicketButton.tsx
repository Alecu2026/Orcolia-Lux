"use client";

import { useState, useTransition } from "react";
import { setTaskStatus } from "@/app/actions/tasks";
import { useRouter } from "next/navigation";
import { useMessages } from "@/lib/i18n/context";
import { useToast } from "./toast";

export default function CloseTicketButton({ taskId }: { taskId: string }) {
  const m = useMessages();
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();
  const toast = useToast();

  function handleClose() {
    startTransition(async () => {
      const res = await setTaskStatus(taskId, "DONE");
      // Fără permisiunea de închidere, tichetul se finalizează doar după ce atașezi o poză / un fișier: spunem de ce nu s-a închis.
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  if (done) return null;

  return (
    <button
      onClick={handleClose}
      disabled={isPending}
      className="shrink-0 rounded-xl border border-st-done/40 bg-st-done/10 px-3 py-1.5 text-sm font-semibold text-st-done transition-colors hover:bg-st-done/20 disabled:opacity-50"
    >
      {isPending ? m.tasks.closingTicket : m.tasks.closeTicketBtn}
    </button>
  );
}
