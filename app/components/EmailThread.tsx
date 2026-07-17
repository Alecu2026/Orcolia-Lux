"use client";

import { useState, useTransition } from "react";
import { sendEmailReplyAction } from "@/app/actions/email-tickets";
import { useMessages } from "@/lib/i18n/context";

type ThreadMessage = {
  id: string;
  direction: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  body: string;
  sentAt: string;
};

export default function EmailThread({
  taskId,
  messages,
  fromEmail,
  fromName,
  canReply,
}: {
  taskId: string;
  messages: ThreadMessage[];
  fromEmail: string;
  fromName: string | null;
  canReply: boolean;
}) {
  const m = useMessages();
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [localMessages, setLocalMessages] = useState<ThreadMessage[]>(messages);
  const [isPending, startTransition] = useTransition();

  function handleSend() {
    if (!reply.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await sendEmailReplyAction(taskId, reply);
      if (res.ok) {
        setLocalMessages((prev) => [
          ...prev,
          {
            id: `local-${Date.now()}`,
            direction: "OUTBOUND",
            fromEmail: "",
            fromName: m.email.selfName,
            toEmail: fromEmail,
            body: reply,
            sentAt: new Date().toISOString(),
          },
        ]);
        setReply("");
        setSent(true);
        setTimeout(() => setSent(false), 3000);
      } else {
        setError(res.error ?? m.email.sendError);
      }
    });
  }

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" });

  function decodeRfc2047(str: string): string {
    if (!str || !str.includes("=?")) return str;
    return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, _charset, enc, data) => {
      try {
        if (enc.toUpperCase() === "B") {
          return decodeURIComponent(
            Array.from(atob(data), (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0")).join("")
          );
        }
        return data.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (_: string, h: string) => String.fromCharCode(parseInt(h, 16)));
      } catch {
        return str;
      }
    });
  }

  return (
    <div className="card mb-3 p-4">
      <h2 className="mb-1 text-sm font-bold">📧 {m.email.heading}</h2>
      <p className="mb-4 text-sm text-ink-soft">
        {fromName ? (
          <>
            <span className="font-semibold text-ink">{decodeRfc2047(fromName)}</span>
            {" "}
          </>
        ) : null}
        <span className="font-mono text-xs">{fromEmail}</span>
      </p>

      {localMessages.length === 0 ? (
        <p className="text-xs text-ink-soft">{m.email.noMessages}</p>
      ) : (
        <div className="flex flex-col gap-4 mb-4">
          {localMessages.map((msg) => {
            const isIn = msg.direction === "INBOUND";
            const senderName = isIn
              ? decodeRfc2047(msg.fromName || msg.fromEmail)
              : decodeRfc2047(msg.fromName || m.email.teamName);
            return (
              <div key={msg.id} className={`flex flex-col gap-1 ${isIn ? "items-start" : "items-end"}`}>
                <div className={`flex items-baseline gap-2 px-1 ${isIn ? "" : "flex-row-reverse"}`}>
                  <span className={`text-sm font-bold ${isIn ? "text-ink" : "text-brand"}`}>
                    {senderName}
                  </span>
                  <span className="text-[11px] text-ink-soft">{fmtDate(msg.sentAt)}</span>
                </div>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm ${
                    isIn
                      ? "bg-[var(--color-surface-2)] text-[var(--color-ink)]"
                      : "bg-brand/10 text-[var(--color-ink)] border border-brand/20"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words leading-relaxed">{msg.body}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {canReply && (
        <div className="border-t border-[var(--color-line)] pt-3 mt-1">
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={m.email.replyPlaceholder}
            rows={3}
            className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
          />
          {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
          {sent && <p className="mt-1 text-xs text-green-600">{m.email.sent}</p>}
          <div className="mt-2 flex justify-end">
            <button
              onClick={handleSend}
              disabled={isPending || !reply.trim()}
              className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50"
            >
              {isPending ? m.email.sending : m.email.send}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
