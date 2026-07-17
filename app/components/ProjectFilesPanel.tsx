"use client";

import { useEffect, useState } from "react";
import {
  getProjectAttachments,
  deleteTaskAttachment,
  type ProjectAttachmentRow,
} from "@/app/actions/attachments";
import { IconTrash } from "./icons";
import { useMessages } from "@/lib/i18n/context";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mimeType: string | null): boolean {
  return !!mimeType?.startsWith("image/");
}

export default function ProjectFilesPanel({ projectId }: { projectId: string }) {
  const m = useMessages();
  const [files, setFiles] = useState<ProjectAttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getProjectAttachments(projectId)
      .then((rows) => { if (!cancelled) { setFiles(rows); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  async function handleDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await deleteTaskAttachment(id);
      setFiles((prev) => prev.filter((f) => f.id !== id));
    } catch (e) {
      setError((e as Error).message ?? m.common.deleteFailed);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)]/40 px-4 py-3">
      <p className="mb-2.5 text-[11px] font-semibold text-ink-soft">
        📎 {m.projects.files} ({loading ? "…" : files.length})
      </p>

      {error && (
        <p className="mb-2 rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-600">{error}</p>
      )}

      {loading ? (
        <p className="text-[11px] text-ink-soft">{m.common.loading}</p>
      ) : files.length === 0 ? (
        <p className="text-[11px] text-ink-soft">{m.projects.noFiles}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {files.map((f) => (
            <div
              key={f.id}
              className="group relative flex max-w-[130px] flex-col items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5"
            >
              <a href={f.url} target="_blank" rel="noreferrer" title={f.name} className="block">
                {isImage(f.mimeType) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.url} alt={f.name} className="h-16 w-16 rounded object-cover" />
                ) : (
                  <div className="flex h-16 w-16 flex-col items-center justify-center rounded bg-red-50 text-red-500">
                    <span className="text-2xl">📄</span>
                    <span className="mt-0.5 text-[9px] font-bold uppercase">PDF</span>
                  </div>
                )}
              </a>

              <p className="w-full truncate text-center text-[9px] text-ink-soft" title={f.name}>
                {f.name}
              </p>
              <p className="text-[9px] text-ink-soft">{fmtSize(f.size)}</p>

              {/* Task sursa */}
              <p className="w-full truncate text-center text-[8px] text-ink-soft/60" title={f.taskTitle}>
                {f.taskSeq != null ? `#${f.taskSeq}` : ""} {f.taskTitle}
              </p>

              <button
                type="button"
                disabled={deletingId === f.id}
                onClick={() => handleDelete(f.id)}
                className="absolute right-0.5 top-0.5 hidden size-5 items-center justify-center rounded bg-white/80 text-red-500 hover:bg-red-50 group-hover:flex disabled:opacity-50"
                title={m.common.delete}
              >
                <IconTrash className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
