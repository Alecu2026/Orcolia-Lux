"use client";

import type { InputHTMLAttributes } from "react";
import { IconCalendar } from "./icons";

/**
 * Câmp de dată pentru filtre. Pe telefon un <input type="date"> gol se vede ca un pătrat gol (fără „zz/ll/aaaa”, fără nicio indicație), deci aici, cât timp nu e aleasă
 * nicio dată, se afișează deasupra o etichetă cu iconiță de calendar („📅 De la”). Imediat ce se alege o dată, eticheta dispare și se vede data. Atingerea câmpului
 * deschide selectorul de dată al telefonului (eticheta nu blochează atingerea: `pointer-events-none`).
 */
export default function DateFilterInput({
  label,
  className,
  value,
  ...rest
}: { label: string; value: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value">) {
  return (
    <span className="relative inline-flex">
      <input type="date" value={value} className={className} {...rest} />
      {!value && (
        <span aria-hidden className="pointer-events-none absolute inset-y-px left-px right-7 flex items-center gap-1 overflow-hidden rounded-l-lg bg-[var(--color-surface)] px-2 text-[12px] text-ink-soft">
          <IconCalendar className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
      )}
    </span>
  );
}
