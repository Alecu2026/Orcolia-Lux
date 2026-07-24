"use client";

import { useState } from "react";

export default function PrintButton({ token, origin }: { token: string; origin: string }) {
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/invoice/public/${token}/pdf`);
      if (!res.ok) throw new Error("Eșec generare PDF");
      const blob = await res.blob();
      const match = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/);
      const filename = match?.[1] ?? "factura.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      alert("Nu am putut descărca PDF-ul. Încearcă din nou.");
    } finally {
      setDownloading(false);
    }
  }

  async function copy() {
    const url = `${origin}/invoice/public/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      alert("Link copiat!");
    } catch {
      prompt("Copiază linkul:", url);
    }
  }

  return (
    <div className="flex gap-2 print:hidden">
      <button
        onClick={download}
        disabled={downloading}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60"
      >
        {downloading ? "Se generează…" : "Descarcă PDF"}
      </button>
      <button
        onClick={() => window.print()}
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        title="Deschide dialogul de printare al browserului"
      >
        Printează
      </button>
      <button
        onClick={copy}
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
      >
        Copiază link
      </button>
    </div>
  );
}
