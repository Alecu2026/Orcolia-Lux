"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuickAdd } from "./quick-add-context";

export default function AutoOpenQuickAdd() {
  const { open } = useQuickAdd();
  const router = useRouter();
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    open();
    router.replace("/appointments");
  }, [open, router]);

  return null;
}
