"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { setLocale } from "@/app/actions/locale";
import { useLocale } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n";

const OPTIONS: { locale: Locale; flag: string; label: string }[] = [
  { locale: "ro", flag: "🇷🇴", label: "Română" },
  { locale: "en", flag: "🇬🇧", label: "English" },
  { locale: "ru", flag: "🇷🇺", label: "Русский" },
];

export default function LanguageSwitcher() {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const current = OPTIONS.find((o) => o.locale === locale) ?? OPTIONS[0];

  // Închide la click în afara componentei
  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  function choose(l: Locale) {
    setOpen(false);
    if (l === locale) return;
    startTransition(() => setLocale(l));
  }

  return (
    <div ref={ref} className="relative">
      {/* Buton principal */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="tap grid size-9 place-items-center rounded-xl bg-[var(--color-surface-2)] text-lg hover:bg-brand-soft disabled:opacity-50 transition-colors"
      >
        {current.flag}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-50 min-w-[140px] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-lg overflow-hidden">
          {OPTIONS.map((opt) => (
            <button
              key={opt.locale}
              type="button"
              onClick={() => choose(opt.locale)}
              className={[
                "tap flex w-full items-center gap-2.5 px-4 py-2.5 text-sm transition-colors",
                opt.locale === locale
                  ? "bg-brand/10 text-brand font-semibold"
                  : "text-ink hover:bg-[var(--color-surface-2)]",
              ].join(" ")}
            >
              <span className="text-base">{opt.flag}</span>
              <span>{opt.label}</span>
              {opt.locale === locale && (
                <svg className="ml-auto" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
