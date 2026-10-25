"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconFileText, IconTicket, IconScale } from "./icons";
import { useT } from "@/lib/i18n/context";

const TABS = [
  { href: "/portal", label: "Facturi", icon: IconFileText },
  { href: "/portal/decontare", label: "Decontare", icon: IconScale },
  { href: "/portal/cereri", label: "Cereri", icon: IconTicket },
];

export default function PortalNav() {
  const tr = useT();
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {TABS.map((t) => {
        const active = t.href === "/portal" ? pathname === "/portal" : pathname.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`tap flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active ? "bg-brand-soft text-brand-strong" : "text-ink-soft hover:bg-[var(--color-surface-2)]"
            }`}
          >
            <Icon className="size-4" />
            <span className="hidden sm:inline">{tr(t.label)}</span>
          </Link>
        );
      })}
    </nav>
  );
}
