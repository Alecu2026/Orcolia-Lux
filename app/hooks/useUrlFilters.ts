"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";

// Params that should NOT be saved/restored (transient navigation state)
const SKIP = new Set(["page", "open", "create", "project", "date"]);

export function useUrlFilters(storageKey: string) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const isFirstSave = useRef(true);

  // Build a string of saveable filter params (excluding transient ones)
  const saveableEntries = [...sp.entries()].filter(([k]) => !SKIP.has(k));
  const saveStr = new URLSearchParams(saveableEntries).toString();
  const hasFilters = saveableEntries.length > 0;

  // On mount with no filters: restore from localStorage
  useEffect(() => {
    if (!hasFilters) {
      try {
        const saved = localStorage.getItem(storageKey);
        if (saved) router.replace(`${pathname}?${saved}`);
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Save to localStorage when filters change (skip first render if empty)
  useEffect(() => {
    if (isFirstSave.current) {
      isFirstSave.current = false;
      if (!saveStr) return; // Don't overwrite saved state with empty on first render
    }
    try {
      if (saveStr) localStorage.setItem(storageKey, saveStr);
      else localStorage.removeItem(storageKey);
    } catch {}
  }, [saveStr, storageKey]);

  function clearFilters() {
    try { localStorage.removeItem(storageKey); } catch {}
    router.push(pathname);
  }

  return { clearFilters, hasFilters };
}
