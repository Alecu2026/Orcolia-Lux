"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { formatRemaining } from "@/lib/impersonation";

/**
 * Banda de sus din timpul unei simulări de login: în ce cont ești, cât mai ține (expiră fix după 6 ore) și butonul de ieșire.
 * La expirare reîncarcă pagina; serverul te scoate din contul simulat și te duce înapoi în contul tău.
 */
export default function ImpersonationBanner({
  who,
  by,
  expiresAt,
  serverNow,
  exitAction,
  className = "",
}: {
  /** Numele contului în care ești (utilizatorul sau clientul simulat). */
  who: string;
  /** Cine a pornit simularea. */
  by: string;
  expiresAt: number;
  /** Ora serverului la randare: timpul rămas se calculează pe ceasul serverului, nu al dispozitivului (un ceas dereglat n-are cum să scoată din simulare mai devreme / mai târziu). */
  serverNow: number;
  /** Adresa formularului de ieșire (POST). */
  exitAction: string;
  className?: string;
}) {
  const t = useT();
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const offset = serverNow - Date.now();
    const tick = () => {
      const ms = expiresAt - (Date.now() + offset);
      setLeft(ms);
      if (ms <= 0) {
        // simularea a expirat: reîncarcă o dată (serverul te duce înapoi în contul tău); nu mai des de o dată la 30 s, ca să nu intre în buclă
        try {
          const last = Number(sessionStorage.getItem("imp-reload") ?? 0);
          if (Date.now() - last < 30_000) return;
          sessionStorage.setItem("imp-reload", String(Date.now()));
        } catch {}
        window.location.reload();
      }
    };
    tick();
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, [expiresAt, serverNow]);

  return (
    <div
      role="status"
      data-impersonation=""
      className={`z-40 flex min-h-9 flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-amber-400 px-3 py-1 text-xs font-medium text-black print:hidden ${className}`}
    >
      <span className="min-w-0 truncate">
        🕵 {t("Simulare de login")}: {t("ești conectat ca")} <b>{who}</b>
        <span className="hidden sm:inline"> ({t("pornită de")} {by})</span>
      </span>
      <span className="shrink-0 tabular-nums" title={new Date(expiresAt).toLocaleString()}>
        {left !== null && <>⏱ {t("expiră în")} {formatRemaining(left)}</>}
      </span>
      <form method="post" action={exitAction} className="shrink-0">
        <button type="submit" className="tap rounded-md bg-black px-2.5 py-1 text-xs font-semibold text-white hover:bg-black/80">
          {t("Ieși din simulare")}
        </button>
      </form>
    </div>
  );
}
