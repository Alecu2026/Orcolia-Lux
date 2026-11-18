import { ICONS } from "@/lib/manual/icon-data";

/**
 * Iconițele paginii „Manual de utilizare” (SVG, doar contur, culoarea textului): înlocuiesc emoji-urile. Datele stau în lib/manual/icon-data.ts (aceleași se desenează și în PDF).
 * Fiecare secțiune a manualului are o iconiță după numele din `ManualSection.icon`.
 */
export function MIcon({ name, className = "size-4" }: { name: string; className?: string }) {
  const els = ICONS[name] ?? ICONS.book;
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {els.map((el, i) =>
        "p" in el ? <path key={i} d={el.p} /> : "c" in el ? <circle key={i} cx={el.c[0]} cy={el.c[1]} r={el.c[2]} /> : <rect key={i} x={el.r[0]} y={el.r[1]} width={el.r[2]} height={el.r[3]} rx={el.r[4]} ry={el.r[4]} />,
      )}
    </svg>
  );
}
