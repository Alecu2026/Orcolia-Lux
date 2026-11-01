"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/context";

export default function PrintButton({ token, origin }: { token: string; origin: string }) {
  const t = useT();
  const [downloading, setDownloading] = useState(false);

  async function download() {
    setDownloading(true);
    try {
      const res = await fetch(`/api/invoice/public/${token}/pdf`);
      if (res.status === 503 || res.status === 429) {
        // serverul e ocupat cu multe PDF-uri (sau prea multe cereri de la aceeași adresă): nu e o defecțiune, se reîncearcă peste câteva secunde
        alert(t("Serverul generează acum multe PDF-uri. Încearcă din nou peste câteva secunde."));
        return;
      }
      if (!res.ok) throw new Error(t("Eșec generare PDF"));
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
      // generatorul de pe server nu răspunde (ex. Chromium lipsă): factura se poate salva ca PDF din dialogul de tipărire al browserului
      alert(t("PDF-ul nu s-a putut genera pe server. Se deschide tipărirea: alege „Salvează ca PDF”."));
      window.print();
    } finally {
      setDownloading(false);
    }
  }

  async function copy() {
    const url = `${origin}/invoice/public/${token}`;
    try {
      await navigator.clipboard.writeText(url);
      alert(t("Link copiat!"));
    } catch {
      prompt(t("Copiază linkul:"), url);
    }
  }

  return (
    <div className="flex flex-wrap justify-end gap-2 print:hidden">
      <button
        onClick={download}
        disabled={downloading}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60"
      >
        {downloading ? t("Se generează…") : t("Descarcă PDF")}
      </button>
      <button
        onClick={() => window.print()}
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
        title={t("Deschide dialogul de printare al browserului")}
      >
        {t("Printează")}
      </button>
      <button
        onClick={copy}
        className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100"
      >
        {t("Copiază link")}
      </button>
    </div>
  );
}
