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
    // lățime minimă: data + iconița nativă de calendar trebuie să încapă (altfel iconița se taie)
    <span className="relative inline-flex min-w-[10.75rem]">
      <input type="date" value={value} className={`${className ?? ""} !h-8 w-full min-w-[10.75rem] pr-1.5 !text-xs`} {...rest} />
      {!value && (
        <span aria-hidden className="pointer-events-none absolute inset-y-px left-px right-8 flex items-center gap-1 overflow-hidden rounded-l-lg bg-[var(--color-surface)] px-2 text-xs text-ink-soft">
          <IconCalendar className="size-4 shrink-0" />
          <span className="truncate">{label}</span>
        </span>
      )}
    </span>
  );
}
