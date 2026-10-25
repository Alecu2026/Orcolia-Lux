"use client";

import { useRef, useState, type ReactNode } from "react";
import { upload } from "@vercel/blob/client";
import { saveTaskAttachment } from "@/app/actions/attachments";
import { optimizeImage } from "@/lib/image-optimize";
import { useT } from "@/lib/i18n/context";
import { IconX } from "./icons";

type Ask = { taskId: string; projectName?: string | null; retry: () => void };

function folderOf(projectName: string | null | undefined): string {
  const s = (projectName ?? "")
    .toLowerCase()
    .replace(/ă|â/g, "a").replace(/î/g, "i").replace(/ș|ş/g, "s").replace(/ț|ţ/g, "t")
    .replace(/[^a-z0-9 -]/g, "").trim().replace(/\s+/g, "-");
  return s || "task-uri-generale";
}

function ProofDialog({ ask, onClose }: { ask: Ask; onClose: () => void }) {
  const t = useT();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.files?.[0];
    if (!raw) return;
    if (raw.size > 20 * 1024 * 1024) { setError(t("Fișierul depășește 20 MB.")); return; }
    setError(null);
    setBusy(true);
    try {
      const file = await optimizeImage(raw);
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const blob = await upload(`tasks/${folderOf(ask.projectName)}/${Date.now()}_${safe}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload/task-attachment",
        onUploadProgress: ({ percentage }) => setPct(percentage),
      });
      await saveTaskAttachment({ taskId: ask.taskId, url: blob.url, name: file.name, size: file.size, mimeType: file.type || null });
      onClose();
      ask.retry(); // fișierul e atașat: finalizarea se reia singură
    } catch (err) {
      setError(t((err as Error).message || "Eroare"));
      setBusy(false);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="card w-full max-w-sm rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-2 flex items-start justify-between gap-3">
          <h2 className="text-base font-bold">{t("Pentru finalizare trimite o poză sau un fișier")}</h2>
          <button onClick={onClose} disabled={busy} className="tap grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>
            <IconX className="size-4" />
          </button>
        </div>
        <p className="mb-4 text-sm text-ink-soft">
          {t("Nu ai permisiunea „Închidere / finalizare”, așa că finalizezi doar după ce atașezi o poză sau un fișier informativ. După trimitere, finalizarea se face automat.")}
        </p>
        <input ref={fileRef} type="file" onChange={pick} className="hidden" />
        <button
          type="button"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
          className="tap h-12 w-full cursor-pointer rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60"
        >
          {busy ? t("Se trimite… {n}%", { n: Math.round(pct) }) : t("📎 Alege poza / fișierul")}
        </button>
        {error && <p className="mt-3 text-sm text-st-cancelled">{error}</p>}
      </div>
    </div>
  );
}

/** Când finalizarea cere dovadă (utilizator fără „Închidere / finalizare"): `ask(...)` deschide fereastra, iar după trimitere reia finalizarea. */
export function useProofPrompt(): { ask: (taskId: string, retry: () => void, projectName?: string | null) => void; node: ReactNode } {
  const [cur, setCur] = useState<Ask | null>(null);
  return {
    ask: (taskId, retry, projectName) => setCur({ taskId, retry, projectName }),
    node: cur ? <ProofDialog ask={cur} onClose={() => setCur(null)} /> : null,
  };
}
