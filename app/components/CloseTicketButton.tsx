"use client";

import { useState, useTransition } from "react";
import { setTaskStatus } from "@/app/actions/tasks";
import { useRouter } from "next/navigation";
import { useMessages } from "@/lib/i18n/context";
import { useToast } from "./toast";
import { useProofPrompt } from "./ProofDialog";
import { useResolutionPrompt } from "./ResolutionDialog";
import type { Resolution } from "@/lib/resolution";
import { useT } from "@/lib/i18n/context";

export default function CloseTicketButton({ taskId, title, createdAt }: { taskId: string; title?: string | null; createdAt?: string | number | Date | null }) {
  const t = useT();
  const m = useMessages();
  const [isPending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const router = useRouter();
  const toast = useToast();
  const proof = useProofPrompt();
  const rp = useResolutionPrompt();

  function handleClose(resolution?: Resolution) {
    startTransition(async () => {
      const res = await setTaskStatus(taskId, "DONE", resolution);
      // Fără permisiunea de închidere, tichetul se finalizează doar după ce atașezi o poză / un fișier: spunem de ce nu s-a închis.
      if (res?.error) {
        if (res.needsResolution) rp.ask({ title, createdAt }, (r) => handleClose(r));
        else if (res.needsProof) proof.ask(taskId, () => handleClose(resolution));
        else toast.error(t(res.error));
        return;
      }
      setDone(true);
      router.refresh();
    });
  }

  if (done) return null;

  return (
    <>
    {proof.node}
    {rp.node}
    <button
      onClick={() => handleClose()}
      disabled={isPending}
      className="shrink-0 rounded-xl border border-st-done/40 bg-st-done/10 px-3 py-1.5 text-sm font-semibold text-st-done transition-colors hover:bg-st-done/20 disabled:opacity-50"
    >
      {isPending ? m.tasks.closingTicket : m.tasks.closeTicketBtn}
    </button>
    </>
  );
}
