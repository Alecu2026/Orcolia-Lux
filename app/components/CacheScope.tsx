"use client";

import { useLayoutEffect } from "react";

/** Spune cache-urilor din browser (vezi lib/cache-scope.ts) al cui cont sunt. Se pune în layout înaintea restului paginii, ca să fie setat înainte ca ele să citească din IndexedDB. */
export default function CacheScope({ uid }: { uid: string }) {
  useLayoutEffect(() => {
    (window as unknown as { __crmScope?: string }).__crmScope = uid;
  }, [uid]);
  return null;
}
