"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMessages } from "@/lib/i18n/context";
import { useT } from "@/lib/i18n/context";

export default function CreateMenu({ perms }: { perms?: Record<string, boolean> }) {
  const t = useT();
  const router = useRouter();
  const m = useMessages();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Fără permisiunea de creare (și fără acces la pagina respectivă) elementul nu apare; `perms` lipsă = mod demo (totul permis).
  const ok = (k: string) => perms?.[k] !== false;
  const ITEMS = [
    ok("tasks.create") && ok("tasks.view") && { label: m.tasks.createTaskTitle, href: "/tasks?create=task" },
    ok("tasks.create") && ok("tickets.view") && { label: m.tasks.createTicketTitle, href: "/tickets?create=ticket" },
    ok("appointments.manage") && ok("appointments.view") && { label: m.appts.newTitle, href: "/appointments?create=1" },
    ok("projects.create") && ok("projects.view") && { label: m.projects.newTitle, href: "/projects?create=1" },
    ok("clients.create") && ok("clients.view") && { label: m.clients.newTitle, href: "/clients?create=1" },
  ].filter((x): x is { label: string; href: string } => !!x);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  if (ITEMS.length === 0) return null;

  return (
    <div ref={ref} className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-5 z-40 lg:bottom-6">
      {open && (
        <div className="absolute bottom-16 right-0 w-44 overflow-hidden rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] shadow-xl">
          {ITEMS.map((it) => (
            <button
              key={it.href}
              onClick={() => go(it.href)}
              className="block w-full px-4 py-3 text-left text-sm font-medium hover:bg-[var(--color-surface-2)]"
            >
              {t(it.label)}
            </button>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        className="tap grid size-14 place-items-center rounded-full bg-brand text-white shadow-xl shadow-brand/30"
        aria-label={m.common.create}
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={`transition-transform ${open ? "rotate-45" : ""}`}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>
  );
}
