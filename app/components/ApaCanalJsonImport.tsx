"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";
import { IconDroplet, IconX } from "./icons";
import { useMessages, useT } from "@/lib/i18n/context";

type Stats = {
  documenteTotale: number;
  sariteFaraAbonent: number;
  clientiNoiDeCreat: number;
  clientiExistentiActualizati: number;
  dinCareCuContActivatPastrat: number;
  coliziuniContPersonal: number;
  facturiDeCreat: number;
  facturiSaritePreexistente: number;
  liniiFacturaDeCreat: number;
  totalNecuvenit: number;
  totalDePlata: number;
};

type Applied = {
  clientsCreated: number;
  clientsUpdated: number;
  invoicesCreated: number;
  itemsCreated: number;
};

type Phase = "idle" | "uploading" | "analyzing" | "preview" | "committing" | "done" | "error";

export default function ApaCanalJsonImport({ className }: { className?: string }) {
  const m = useMessages();
  const t = useT();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPhase("idle");
    setPct(0);
    setBlobUrl(null);
    setStats(null);
    setApplied(null);
    setError(null);
  }

  function money(n: number) {
    return `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MDL`;
  }

  async function handleFile(file: File) {
    setError(null);
    setPhase("uploading");
    setPct(0);
    try {
      const blob = await upload(`apa-canal-import/${Date.now()}_${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload/apa-canal-import",
        onUploadProgress: ({ percentage }) => setPct(percentage),
      });
      setBlobUrl(blob.url);
      setPhase("analyzing");

      const res = await fetch("/api/import/apa-canal-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl: blob.url, commit: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? m.common.error);
      setStats(data.stats as Stats);
      setPhase("preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : m.common.error);
      setPhase("error");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleConfirm() {
    if (!blobUrl) return;
    setPhase("committing");
    setError(null);
    try {
      const res = await fetch("/api/import/apa-canal-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobUrl, commit: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? m.common.error);
      setApplied(data.applied as Applied);
      setPhase("done");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : m.common.error);
      setPhase("error");
    }
  }

  function closeModal() {
    setOpen(false);
    reset();
  }

  const defaultClass =
    "tap inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className ?? defaultClass}>
        <IconDroplet className="size-4" />
        <span>{m.apaCanalImport.button}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          onMouseDown={(e) => e.target === e.currentTarget && phase !== "uploading" && phase !== "analyzing" && phase !== "committing" && closeModal()}
        >
          <div className="card max-h-[92dvh] w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl p-6 shadow-2xl sm:rounded-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold">{m.apaCanalImport.title}</h2>
              <button
                onClick={closeModal}
                className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]"
                aria-label={m.common.close}
              >
                <IconX className="size-4" />
              </button>
            </div>

            {phase === "idle" && (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-ink-soft">{m.apaCanalImport.description}</p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".txt,.json,application/json,text/plain"
                  className="sr-only"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="tap flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong"
                >
                  {m.apaCanalImport.selectFile}
                </button>
              </div>
            )}

            {phase === "uploading" && (
              <div className="flex flex-col items-center gap-3 py-8">
                <svg className="size-8 animate-spin text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                <p className="text-sm text-ink-soft">
                  {m.apaCanalImport.uploading.replace("{pct}", String(pct))}
                </p>
              </div>
            )}

            {phase === "analyzing" && (
              <div className="flex flex-col items-center gap-3 py-8">
                <svg className="size-8 animate-spin text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                <p className="text-sm text-ink-soft">{m.apaCanalImport.analyzing}</p>
              </div>
            )}

            {phase === "preview" && stats && (
              <div className="flex flex-col gap-4">
                <p className="text-sm font-semibold text-brand">{m.apaCanalImport.dryRunTitle}</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <Stat label={m.apaCanalImport.documentsTotal} value={stats.documenteTotale} />
                  <Stat label={m.apaCanalImport.newClients} value={stats.clientiNoiDeCreat} />
                  <Stat label={m.apaCanalImport.updatedClients} value={stats.clientiExistentiActualizati} />
                  <Stat label={m.apaCanalImport.preservedActivated} value={stats.dinCareCuContActivatPastrat} />
                  <Stat label={m.apaCanalImport.collisions} value={stats.coliziuniContPersonal} />
                  <Stat label={m.apaCanalImport.newInvoices} value={stats.facturiDeCreat} />
                  <Stat label={m.apaCanalImport.skippedInvoices} value={stats.facturiSaritePreexistente} />
                  <Stat label={m.apaCanalImport.invoiceLines} value={stats.liniiFacturaDeCreat} />
                </dl>
                <div className="rounded-xl bg-[var(--color-surface-2)] p-3 text-sm">
                  <div className="flex justify-between"><span className="text-ink-soft">{m.apaCanalImport.totalCharged}</span><span className="font-semibold">{money(stats.totalNecuvenit)}</span></div>
                  <div className="flex justify-between"><span className="text-ink-soft">{m.apaCanalImport.totalDue}</span><span className="font-semibold">{money(stats.totalDePlata)}</span></div>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={closeModal} className="tap h-11 flex-1 rounded-xl border border-[var(--color-line)] text-sm font-medium hover:bg-[var(--color-surface-2)]">
                    {m.apaCanalImport.cancelButton}
                  </button>
                  <button type="button" onClick={handleConfirm} className="tap h-11 flex-1 rounded-xl bg-brand text-sm font-semibold text-white hover:bg-brand-strong">
                    {m.apaCanalImport.confirmButton}
                  </button>
                </div>
              </div>
            )}

            {phase === "committing" && (
              <div className="flex flex-col items-center gap-3 py-8">
                <svg className="size-8 animate-spin text-brand" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
                  <path d="M12 2a10 10 0 0 1 10 10" />
                </svg>
                <p className="text-sm text-ink-soft">{m.apaCanalImport.committing}</p>
              </div>
            )}

            {phase === "done" && applied && (
              <div className="flex flex-col gap-4">
                <p className="text-sm font-semibold text-green-600">{m.apaCanalImport.doneTitle}</p>
                <p className="text-sm text-ink-soft">
                  {m.apaCanalImport.doneMessage
                    .replace("{clientsCreated}", String(applied.clientsCreated))
                    .replace("{clientsUpdated}", String(applied.clientsUpdated))
                    .replace("{invoicesCreated}", String(applied.invoicesCreated))
                    .replace("{itemsCreated}", String(applied.itemsCreated))}
                </p>
                <button type="button" onClick={closeModal} className="tap h-11 w-full rounded-xl bg-[var(--color-surface-2)] text-sm font-medium hover:bg-[var(--color-line)]">
                  {m.apaCanalImport.closeButton}
                </button>
              </div>
            )}

            {phase === "error" && (
              <div className="flex flex-col gap-4">
                <p className="text-sm font-semibold text-red-600">{m.apaCanalImport.errorTitle}</p>
                <p className="text-sm text-ink-soft">{t(error ?? "")}</p>
                <button type="button" onClick={closeModal} className="tap h-11 w-full rounded-xl bg-[var(--color-surface-2)] text-sm font-medium hover:bg-[var(--color-line)]">
                  {m.apaCanalImport.closeButton}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[var(--color-line)] px-2.5 py-1.5">
      <dt className="text-[11px] text-ink-soft">{label}</dt>
      <dd className="text-sm font-semibold">{value.toLocaleString("ro-RO")}</dd>
    </div>
  );
}
