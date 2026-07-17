"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMessages } from "@/lib/i18n/context";

export default function ClientSearch({ initial }: { initial: string }) {
  const router = useRouter();
  const m = useMessages();
  const [q, setQ] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      router.replace(`/clients${params.toString() ? `?${params}` : ""}`);
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <input
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder={m.clients.searchByNameOrPhone}
      className="mb-4 h-12 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-4 text-[15px] outline-none focus:border-brand focus:ring-2 focus:ring-brand/30"
    />
  );
}
