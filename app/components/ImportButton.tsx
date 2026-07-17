"use client";

import { useRef, useState } from "react";
import { useMessages } from "@/lib/i18n/context";

type FailedRow = { row: number; error: string };
type ImportResult = { imported: number; total: number; failed: FailedRow[]; entity?: string };

type Props = { entity: string; className?: string };

export default function ImportButton({ entity, className }: Props) {
  const m = useMessages();
  const excelRef = useRef<HTMLInputElement>(null);
  const aiRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState<"excel" | "ai" | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const defaultClass =
    "tap inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--color-line)] px-3 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]";

  async function handleFile(file: File, mode: "excel" | "ai") {
    setLoading(mode);
    setResult(null);
    setFatalError(null);
    setOpen(false);
    try {
      const buf = await file.arrayBuffer();
      const endpoint = mode === "ai" ? `/api/import-ai` : `/api/import?entity=${entity}`;
      const res = await fetch(endpoint, {
        method: "POST",
        body: buf,
        headers: { "Content-Type": "application/octet-stream" },
      });
      const data = await res.json();
      if (!res.ok) {
        setFatalError(data.error ?? m.common.error);
      } else {
        setResult(data as ImportResult);
      }
    } catch {
      setFatalError(m.import.networkError);
    } finally {
      setLoading(null);
      if (excelRef.current) excelRef.current.value = "";
      if (aiRef.current) aiRef.current.value = "";
    }
  }

  const isLoading = loading !== null;

  return (
    <>
      {/* Hidden file inputs */}
      <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, "excel"); }} />
      <input ref={aiRef} type="file" accept=".xlsx,.xls,.csv" className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f, "ai"); }} />

      {/* Dropdown button */}
      <div className="relative">
        <button
          type="button"
          onClick={() => !isLoading && setOpen((v) => !v)}
          disabled={isLoading}
          className={className ?? defaultClass}
          title={m.common.import}
        >
          {isLoading ? (
            <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <circle cx="12" cy="12" r="10" strokeOpacity={0.25} />
              <path d="M12 2a10 10 0 0 1 10 10" />
            </svg>
          ) : (
            <svg className="size-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M9.25 3.75a.75.75 0 0 1 1.5 0v7.19l2.47-2.47a.75.75 0 1 1 1.06 1.06l-3.75 3.75a.75.75 0 0 1-1.06 0L5.72 9.53a.75.75 0 0 1 1.06-1.06l2.47 2.47V3.75Z" />
              <path d="M3.5 13.25a.75.75 0 0 1 .75.75v1.5c0 .138.112.25.25.25h11a.25.25 0 0 0 .25-.25V14a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 15.5 17h-11A1.75 1.75 0 0 1 2.75 15.25V14a.75.75 0 0 1 .75-.75Z" />
            </svg>
          )}
          <span>
            {loading === "excel" ? m.import.loading : loading === "ai" ? m.import.aiLoading : m.common.import}
          </span>
          {!isLoading && (
            <svg className="size-3.5 ml-0.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          )}
        </button>

        {open && (
          <>
            {/* Overlay to close */}
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg">
              <button
                type="button"
                className="tap flex w-full items-start gap-3 rounded-t-xl px-3 py-2.5 text-left hover:bg-[var(--color-surface-2)]"
                onClick={() => { setOpen(false); excelRef.current?.click(); }}
              >
                <svg className="mt-0.5 size-4 shrink-0 text-ink-soft" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M3 4a1 1 0 0 1 1-1h5.586a1 1 0 0 1 .707.293l4.414 4.414A1 1 0 0 1 15 8.414V16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4Z" />
                </svg>
                <div>
                  <p className="text-sm font-medium">Import Excel</p>
                  <p className="text-xs text-ink-soft">{m.import.excelDesc}</p>
                </div>
              </button>
              <div className="border-t border-[var(--color-line)]" />
              <button
                type="button"
                className="tap flex w-full items-start gap-3 rounded-b-xl px-3 py-2.5 text-left hover:bg-[var(--color-surface-2)]"
                onClick={() => { setOpen(false); aiRef.current?.click(); }}
              >
                <svg className="mt-0.5 size-4 shrink-0 text-brand" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 1a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 1ZM5.05 3.636a.75.75 0 0 1 1.06 1.06l-1.06 1.061a.75.75 0 0 1-1.061-1.06l1.06-1.061ZM14.95 3.636l1.06 1.061a.75.75 0 1 1-1.06 1.06l-1.061-1.06a.75.75 0 0 1 1.06-1.061ZM10 6a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-6 4a.75.75 0 0 0-.75-.75h-1.5a.75.75 0 0 0 0 1.5h1.5A.75.75 0 0 0 4 10Zm13.25-.75a.75.75 0 0 1 0 1.5h-1.5a.75.75 0 0 1 0-1.5h1.5ZM5.05 14.303l-1.06 1.06a.75.75 0 1 0 1.06 1.061l1.061-1.06a.75.75 0 0 0-1.06-1.061ZM14.95 15.364l1.06-1.06a.75.75 0 1 0-1.06-1.061l-1.061 1.06a.75.75 0 0 0 1.06 1.061ZM10 17a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0v-1.5A.75.75 0 0 1 10 17Z" />
                </svg>
                <div>
                  <p className="text-sm font-medium">{m.import.aiImport}</p>
                  <p className="text-xs text-ink-soft">{m.import.aiDesc}</p>
                </div>
              </button>
            </div>
          </>
        )}
      </div>

      {/* Results modal */}
      {(result || fatalError) && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setResult(null); setFatalError(null); } }}
        >
          <div className="card w-full max-w-md rounded-2xl p-6 shadow-xl">
            {fatalError ? (
              <>
                <h2 className="mb-2 text-base font-semibold text-red-600">{m.import.errorTitle}</h2>
                <p className="text-sm text-ink-soft">{fatalError}</p>
              </>
            ) : result ? (
              <>
                <div className="mb-1 flex items-center gap-2">
                  <h2 className="text-base font-semibold">
                    {result.imported === result.total
                      ? m.import.complete.replace("{n}", String(result.imported))
                      : m.import.partial.replace("{n}", String(result.imported)).replace("{total}", String(result.total))}
                  </h2>
                  {result.entity && (
                    <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-ink-soft capitalize">
                      {result.entity}
                    </span>
                  )}
                </div>
                {result.failed.length > 0 && (
                  <>
                    <p className="mb-2 mt-3 text-xs font-medium uppercase tracking-wide text-ink-soft">
                      {m.import.errorsLabel.replace("{n}", String(result.failed.length))}
                    </p>
                    <ul className="max-h-72 overflow-y-auto rounded-xl border border-[var(--color-line)] divide-y divide-[var(--color-line)]">
                      {result.failed.map((f) => (
                        <li key={f.row} className="px-3 py-2 text-sm">
                          <span className="font-medium">{m.import.rowLabel.replace("{n}", String(f.row))}</span>{" "}
                          <span className="text-ink-soft">{f.error}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) : null}
            <button
              type="button"
              className="tap mt-4 w-full rounded-xl bg-[var(--color-surface-2)] py-2 text-sm font-medium hover:bg-[var(--color-line)]"
              onClick={() => { setResult(null); setFatalError(null); }}
            >
              {m.common.close}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
