"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";

/** „Descarcă PDF” (generat pe server din pagina de tipărire) + „Printează” (dialogul browserului) pentru decontarea din portal. */
export default function PortalStatementActions() {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function download() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/portal/decontare/pdf");
      if (!res.ok) throw new Error("pdf");
      const blob = await res.blob();
      const name = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "decontare.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErr(t("Nu am putut descărca PDF-ul. Încearcă din nou."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 print:hidden">
      <div className="flex gap-2">
        <button type="button" onClick={download} disabled={busy} className="tap h-9 cursor-pointer rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
          {busy ? t("Se generează…") : `⬇ ${t("Descarcă PDF")}`}
        </button>
        <button type="button" onClick={() => window.print()} className="tap h-9 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-[var(--color-surface-2)]">
          🖨 {t("Printează")}
        </button>
      </div>
      {err && <p className="text-xs text-st-cancelled">{err}</p>}
    </div>
  );
}
