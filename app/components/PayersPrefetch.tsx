"use client";

import { useEffect } from "react";
import { prefetchPayerDataset } from "./usePayerDataset";

/**
 * Cine are acces la Plătitori primește lista în IndexedDB în fundal, după ce pagina curentă s-a liniștit: când deschide /platitori,
 * „Toate" e instant chiar și prima dată. Nu rulează pe date mobile economisite / conexiuni lente și nu pe /platitori (acolo o aduce pagina).
 */
export default function PayersPrefetch() {
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || (conn?.effectiveType && /^(slow-2g|2g)$/.test(conn.effectiveType))) return;
    if (location.pathname.startsWith("/platitori") || location.pathname.startsWith("/notificari-platitori")) return;
    const id = window.setTimeout(() => {
      if (document.visibilityState === "visible") void prefetchPayerDataset();
    }, 3000);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
