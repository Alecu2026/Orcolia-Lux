"use client";

import { useState } from "react";
import { addTaskCommentAction } from "@/app/actions/tasks";
import { useToast } from "./toast";
import { useMessages } from "@/lib/i18n/context";

type CommentRow = {
  id: string;
  body: string;
  source: "WEB" | "TELEGRAM" | "VOICE";
  createdAt: string | Date;
  user: { name: string } | null;
};

const SOURCE: Record<string, string> = { TELEGRAM: " · via Telegram", VOICE: " · din voce" };

function fmt(d: string | Date) {
  return new Date(d).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" });
}

// Parse legacy email comments stored as "📧 **Name:** body"
function parseEmailComment(body: string): { emailSender: string; text: string } | null {
  const m = body.match(/^📧 \*\*(.+?):\*\*\s*([\s\S]*)$/);
  if (!m) return null;
  return { emailSender: m[1], text: m[2].trim() };
}

export default function TaskCommentSection({
  taskId,
  initialComments,
}: {
  taskId: string;
  initialComments: CommentRow[];
}) {
  const toast = useToast();
  const m = useMessages();
  const [comments, setComments] = useState(initialComments);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    try {
      const res = await addTaskCommentAction(taskId, body);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      setDraft("");
      // Optimistic: add a placeholder; server revalidation will update the page
      setComments((c) => [
        ...c,
        {
          id: `tmp-${Date.now()}`,
          body,
          source: "WEB",
          createdAt: new Date(),
          user: { name: m.tasks.selfName },
        },
      ]);
      toast.success(m.tasks.commentAdded);
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-bold">{m.tasks.commentSection} {comments.length > 0 && `(${comments.length})`}</h2>

      {comments.length === 0 && (
        <p className="mb-3 text-sm text-ink-soft">{m.tasks.commentEmpty}</p>
      )}

      <div className="mb-4 flex flex-col gap-4">
        {comments.map((c) => {
          const email = parseEmailComment(c.body);
          return (
            <div key={c.id}>
              <div className="mb-0.5 flex flex-wrap items-baseline gap-2">
                {email ? (
                  <>
                    <span className="text-sm font-semibold">📧 {email.emailSender}</span>
                    <span className="text-[11px] text-ink-soft">{fmt(c.createdAt)}</span>
                  </>
                ) : (
                  <>
                    <span className="text-sm font-semibold">{c.user?.name ?? "—"}</span>
                    <span className="text-[11px] text-ink-soft">
                      {fmt(c.createdAt)}{SOURCE[c.source] ?? ""}
                    </span>
                  </>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm">{email ? email.text : c.body}</p>
            </div>
          );
        })}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={m.tasks.commentPlaceholder}
          rows={3}
          className="w-full resize-none rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={posting || !draft.trim()}
          className="tap h-10 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-50"
        >
          {posting ? m.tasks.commentSubmitting : m.tasks.commentSubmit}
        </button>
      </form>
    </div>
  );
}
