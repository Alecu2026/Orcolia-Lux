"use client";

import { useEffect } from "react";
import { useT } from "@/lib/i18n/context";

// Vezi app/portal/(dashboard)/error.tsx pentru explicația detaliată — aceeași detecție, dar
// aici pentru orice eroare care scapă de toate boundary-urile imbricate (inclusiv layout-ul
// rădăcină), unde nu ne mai putem baza deloc pe CSS-ul aplicației — stiluri inline, ca în
// public/offline.html.
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

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const t = useT();
  const stale = isStaleDeployError(error);

  useEffect(() => {
    console.error("[global-error] eroare neprinsă:", error);
    // Pagină veche după un deploy: reîncărcăm automat o singură dată (fără buclă) ca să ia versiunea nouă.
    if (stale) {
      try {
        if (sessionStorage.getItem("stale-reload") !== "1") {
          sessionStorage.setItem("stale-reload", "1");
          window.location.reload();
          return;
        }
      } catch {}
    }
  }, [error, stale]);

  return (
    <html lang="ro">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: "1.5rem",
            padding: "2.5rem 2rem",
            textAlign: "center",
            maxWidth: 360,
            width: "100%",
            boxShadow: "0 4px 24px rgba(0,0,0,.08)",
          }}
        >
          <img
            src="/icons/icon-192.png"
            alt=""
            width={72}
            height={72}
            style={{ margin: "0 auto 1.25rem", borderRadius: "1rem", display: "block" }}
          />
          {stale ? (
            <>
              <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: ".5rem" }}>
                {t("A apărut o actualizare a aplicației")}
              </h1>
              <p style={{ fontSize: ".9rem", color: "#64748b", lineHeight: 1.6, marginBottom: "1.5rem" }}>
                {t("Pagina a rămas deschisă dintr-o versiune mai veche. Reîncarcă pagina ca să continui.")}
              </p>
            </>
          ) : (
            <>
              <h1 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: ".5rem" }}>
                {t("Ceva nu a mers bine")}
              </h1>
              <p style={{ fontSize: ".9rem", color: "#64748b", lineHeight: 1.6, marginBottom: "1.5rem" }}>
                {t("A apărut o eroare neașteptată. Reîncarcă pagina — dacă problema persistă, contactează-ne.")}
              </p>
            </>
          )}
          <button
            type="button"
            onClick={() => (stale ? window.location.reload() : unstable_retry())}
            style={{
              background: "#0d9488",
              color: "#fff",
              border: "none",
              borderRadius: ".875rem",
              padding: ".75rem 1.75rem",
              fontSize: ".95rem",
              fontWeight: 600,
              cursor: "pointer",
              width: "100%",
            }}
          >
            {stale ? "Reîncarcă pagina" : "Încearcă din nou"}
          </button>
        </div>
      </body>
    </html>
  );
}
