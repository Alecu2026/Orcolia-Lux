"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { upload } from "@vercel/blob/client";
import {
  getTaskAttachments,
  saveTaskAttachment,
  deleteTaskAttachment,
  type AttachmentRow,
} from "@/app/actions/attachments";
import { IconTrash } from "./icons";
import { useMessages } from "@/lib/i18n/context";

// ── Helpers ──────────────────────────────────────────────

function toFolder(projectName: string | null | undefined): string {
  if (!projectName?.trim()) return "task-uri-generale";
  const s = projectName
    .toLowerCase()
    .replace(/ă|â/g, "a")
    .replace(/î/g, "i")
    .replace(/ș|ş/g, "s")
    .replace(/ț|ţ/g, "t")
    .replace(/[^a-z0-9 -]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  return s || "task-uri-generale";
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mimeType: string | null): boolean {
  return !!mimeType?.startsWith("image/");
}

// ── Component ────────────────────────────────────────────

export default function TaskAttachmentsPanel({
  taskId,
  projectName,
}: {
  taskId: string;
  projectName: string | null;
}) {
  const m = useMessages();
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getTaskAttachments(taskId).then((rows) => {
      if (!cancelled) {
        setAttachments(rows);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [taskId]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    const folder = toFolder(projectName);

    for (const file of Array.from(files)) {
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const pathname = `tasks/${folder}/${Date.now()}_${safe}`;

      setUploading(true);
      setProgress(0);
      try {
        const blob = await upload(pathname, file, {
          access: "public",
          handleUploadUrl: "/api/upload/task-attachment",
          onUploadProgress: ({ percentage }) => setProgress(percentage),
        });

        await new Promise<void>((resolve, reject) => {
          startTransition(async () => {
            try {
              const row = await saveTaskAttachment({
                taskId,
                url: blob.url,
                name: file.name,
                size: file.size,
                mimeType: file.type || null,
              });
              setAttachments((prev) => [...prev, row]);
              resolve();
            } catch (e) {
              reject(e);
            }
          });
        });
      } catch (e) {
        setError((e as Error).message ?? m.common.error);
      } finally {
        setUploading(false);
        setProgress(0);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteTaskAttachment(id);
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError((e as Error).message ?? m.common.deleteFailed);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="border-t border-[var(--color-line)] bg-[var(--color-surface-2)]/40 px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[11px] font-semibold text-ink-soft">📎 {m.tasks.attachments}</p>
        {!uploading && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="tap ml-auto inline-flex h-6 items-center gap-1 rounded-md border border-[var(--color-line)] px-2 text-[10px] font-medium text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            {m.tasks.addAttachment}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>

      {/* Upload progress */}
      {uploading && (
        <div className="mb-2">
          <div className="mb-1 flex items-center justify-between text-[10px] text-ink-soft">
            <span>{m.tasks.uploadingFile}</span>
            <span>{progress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-line)]">
            <div
              className="h-full rounded-full bg-brand transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="mb-2 rounded-lg bg-red-50 px-2 py-1 text-[11px] text-red-600">
          {error}
        </p>
      )}

      {/* List */}
      {loading ? (
        <p className="text-[11px] text-ink-soft">{m.common.loading}</p>
      ) : attachments.length === 0 ? (
        <p className="text-[11px] text-ink-soft">{m.tasks.noAttachments}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="group relative flex max-w-[120px] flex-col items-center gap-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] p-1.5"
            >
              {/* Thumbnail or icon */}
              <a
                href={a.url}
                target="_blank"
                rel="noreferrer"
                className="block"
                title={a.name}
              >
                {isImage(a.mimeType) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.url}
                    alt={a.name}
                    className="h-16 w-16 rounded object-cover"
                  />
                ) : (
                  <div className="flex h-16 w-16 flex-col items-center justify-center rounded bg-red-50 text-red-500">
                    <span className="text-2xl">📄</span>
                    <span className="mt-0.5 text-[9px] font-bold uppercase">PDF</span>
                  </div>
                )}
              </a>

              {/* Name + size */}
              <p
                className="w-full truncate text-center text-[9px] text-ink-soft"
                title={a.name}
              >
                {a.name}
              </p>
              <p className="text-[9px] text-ink-soft">{fmtSize(a.size)}</p>

              {/* Delete button */}
              <button
                type="button"
                disabled={deletingId === a.id}
                onClick={() => handleDelete(a.id)}
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
