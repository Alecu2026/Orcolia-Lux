"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Starea „filtrele sunt deschise / ascunse” a unei pagini, ținută minte în browser (per pagină). Implicit ascunse: filtrele ocupă mult loc, iar cele active
 * se văd oricum pe butonul „Filtre (n)”. Valoarea salvată se citește după prima randare (ca să coincidă cu HTML-ul de pe server).
 */
export function useFiltersOpen(key: string): [boolean, () => void] {
  const storageKey = `filters-open:${key}`;
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (window.localStorage.getItem(storageKey) === "1") setOpen(true);
    } catch {}
  }, [storageKey]);
  const toggle = useCallback(() => {
    setOpen((o) => {
      const n = !o;
      try {
        window.localStorage.setItem(storageKey, n ? "1" : "0");
      } catch {}
      return n;
    });
  }, [storageKey]);
  return [open, toggle];
}
