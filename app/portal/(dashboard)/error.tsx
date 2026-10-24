"use client";

import { useEffect } from "react";
import { useT } from "@/lib/i18n/context";

// Tipare tipice pentru erori cauzate de o versiune veche a aplicației (rulată dintr-un tab
// deschis sau dintr-un PWA instalat, ținut deschis peste un deploy nou): referința către un
// Server Action sau un chunk JS din build-ul vechi nu mai există pe server. Un refresh dur
// (nu un simplu "retry" — acela ar re-rula tot codul vechi din memorie) rezolvă mereu asta.
function isStaleDeployError(error: Error): boolean {
  const msg = `${error.name} ${error.message}`.toLowerCase();
  return (
    msg.includes("failed to find server action") ||
    msg.includes("unrecognizedactionerror") ||
    msg.includes("was not found on the server") ||
    msg.includes("chunkloaderror") ||
    (msg.includes("loading chunk") && msg.includes("failed")) ||
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("importmodulesscript")
  );
}

export default function PortalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const t = useT();
  const stale = isStaleDeployError(error);

  useEffect(() => {
    console.error("[portal] eroare neprinsă:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <img src="/icons/icon-192.png" alt="" className="size-16 rounded-2xl" />
      {stale ? (
        <>
          <h1 className="text-lg font-bold">{t("A apărut o actualizare a aplicației")}</h1>
          <p className="max-w-sm text-sm text-ink-soft">
            {t("Pagina a rămas deschisă dintr-o versiune mai veche. Reîncarcă pagina ca să continui — datele tale (facturi, cereri) nu sunt afectate.")}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="tap h-12 rounded-xl bg-brand px-6 font-semibold text-white hover:bg-brand-strong"
          >
            {t("Reîncarcă pagina")}
          </button>
        </>
      ) : (
        <>
          <h1 className="text-lg font-bold">{t("Ceva nu a mers bine")}</h1>
          <p className="max-w-sm text-sm text-ink-soft">
            {t("A apărut o eroare neașteptată. Poți încerca din nou sau reîncarcă pagina dacă problema persistă.")}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => unstable_retry()}
              className="tap h-12 rounded-xl border border-[var(--color-line)] px-6 font-semibold hover:bg-[var(--color-surface-2)]"
            >
              {t("Încearcă din nou")}
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="tap h-12 rounded-xl bg-brand px-6 font-semibold text-white hover:bg-brand-strong"
            >
              {t("Reîncarcă pagina")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
