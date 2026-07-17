"use client";

import { useRef, useState } from "react";
import { useQuickAdd } from "./quick-add-context";
import { useMessages } from "@/lib/i18n/context";

type Phase = "idle" | "rec" | "proc" | "err";

export default function VoiceButton({ compact = false }: { compact?: boolean }) {
  const { open } = useQuickAdd();
  const m = useMessages();
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    setMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        await process(new Blob(chunksRef.current, { type: rec.mimeType }));
      };
      recRef.current = rec;
      rec.start();
      setPhase("rec");
    } catch {
      setPhase("err");
      setMsg(m.voice.noMicAccess);
    }
  }

  function stop() {
    recRef.current?.stop();
    setPhase("proc");
  }

  async function process(blob: Blob) {
    try {
      const fd = new FormData();
      fd.append("audio", blob, "voice.webm");
      const res = await fetch("/api/voice", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? m.voice.aiError);
      setPhase("idle");
      open({
        clientName: data.parsed?.clientName,
        clientPhone: data.parsed?.phone,
        clientEmail: data.parsed?.email,
        dateKey: data.parsed?.dateKey,
        time: data.parsed?.time,
        durationMinutes: data.parsed?.durationMinutes,
        message: data.parsed?.message,
        reminderEmail: data.parsed?.reminderEmail,
        reminderTelegram: data.parsed?.reminderTelegram,
      });
    } catch (e) {
      setPhase("err");
      setMsg(e instanceof Error ? e.message : m.common.error);
    }
  }

  const active = phase === "rec";
  return (
    <div className="relative">
      <button
        type="button"
        onClick={phase === "rec" ? stop : start}
        disabled={phase === "proc"}
        title={m.voice.addByVoice}
        className={`tap grid place-items-center rounded-xl ${compact ? "size-10" : "size-11"} ${
          active
            ? "animate-pulse bg-st-cancelled text-white"
            : "bg-[var(--color-surface-2)] text-ink hover:bg-brand-soft"
        }`}
      >
        {phase === "proc" ? (
          <span className="text-xs">…</span>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
          </svg>
        )}
      </button>
      {phase === "err" && msg && (
        <span className="absolute right-0 top-12 z-30 w-44 rounded-lg bg-st-cancelled px-2 py-1 text-xs text-white">
          {msg}
        </span>
      )}
    </div>
  );
}
