/**
 * Set de iconițe SVG reutilizabile (stroke = currentColor).
 * Dimensiunea se dă din className, ex. <IconCheck className="size-4" />.
 */
type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export function IconCheck({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconX({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconDroplet({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 2.5s6.5 7.2 6.5 12A6.5 6.5 0 0 1 5.5 14.5C5.5 9.7 12 2.5 12 2.5Z" />
    </svg>
  );
}

export function IconFileText({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h8M8 9h2" />
    </svg>
  );
}

export function IconPlus({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconTrash({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
    </svg>
  );
}

export function IconPencil({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function IconMail({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3 7 9 6 9-6" />
    </svg>
  );
}

export function IconSend({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M22 3 11 13M22 3l-7 18-4-8-8-4 19-6Z" />
    </svg>
  );
}

export function IconDots({ className = "size-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <circle cx="5" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="19" cy="12" r="1.6" />
    </svg>
  );
}

export function IconChevronRight({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function IconChevronLeft({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

export function IconChevronUp({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m18 15-6-6-6 6" />
    </svg>
  );
}

export function IconChevronDown({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function IconMic({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v4" />
    </svg>
  );
}

export function IconSearch({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function IconCalendar({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

export function IconCheckCircle({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </svg>
  );
}

export function IconXCircle({ className = "size-4" }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15 9-6 6M9 9l6 6" />
    </svg>
  );
}
