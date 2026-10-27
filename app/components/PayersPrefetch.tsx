"use client";

import { useEffect } from "react";
import { prefetchPayerDataset } from "./usePayerDataset";
import { prefetchInvoiceDataset } from "./useInvoiceDataset";
import { prefetchMeterDataset } from "./useMeterDataset";

/**
 * Cine are acces la Plătitori / Facturi primește listele în IndexedDB în fundal, după ce pagina curentă s-a liniștit: când deschide pagina,
 * „Toate" e instant chiar și prima dată. Nu rulează pe date mobile economisite / conexiuni lente și nu pe pagina respectivă (acolo o aduce pagina).
 */
export default function PayersPrefetch({ payers = true, invoices = false }: { payers?: boolean; invoices?: boolean }) {
  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (conn?.saveData || (conn?.effectiveType && /^(slow-2g|2g)$/.test(conn.effectiveType))) return;
    const id = window.setTimeout(() => {
      if (document.visibilityState !== "visible") return;
      const p = location.pathname;
      if (payers && !p.startsWith("/platitori") && !p.startsWith("/notificari-platitori")) void prefetchPayerDataset();
      if (invoices && !p.startsWith("/invoices")) setTimeout(() => void prefetchInvoiceDataset(), 1500);
      if (payers && !p.startsWith("/contoare")) setTimeout(() => void prefetchMeterDataset(), 3000);
    }, 3000);
    return () => window.clearTimeout(id);
  }, [payers, invoices]);
  return null;
}
