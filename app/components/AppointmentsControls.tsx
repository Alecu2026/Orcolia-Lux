"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition } from "react";
import { useUrlFilters } from "@/app/hooks/useUrlFilters";
import { useMessages } from "@/lib/i18n/context";

type Opt = { id: string; name: string };

const fldCls = (val: string) =>
  `h-9 appearance-none sel-arrow rounded-lg border pl-2 pr-7 text-xs outline-none focus:border-brand ${
    val
      ? "border-brand bg-brand/10 font-semibold text-brand"
      : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;

export default function AppointmentsControls({
  categories = [],
}: {
  categories?: Opt[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  const { clearFilters } = useUrlFilters("filters:appointments");
  const m = useMessages();

  const VIEWS = [
    { key: "azi", label: m.appts.viewToday },
    { key: "maine", label: m.appts.viewTomorrow },
    { key: "saptamana", label: m.appts.viewWeek },
    { key: "lista", label: m.appts.viewList },
  ] as const;

  const STATUSES = [
    { value: "NEW", label: m.appts.statusNew },
    { value: "CONFIRMED", label: m.appts.statusConfirmed },
    { value: "IN_PROGRESS", label: m.status.IN_PROGRESS },
    { value: "DONE", label: m.status.DONE },
    { value: "CANCELLED", label: m.status.CANCELLED },
    { value: "NO_SHOW", label: m.appts.statusNoShow },
  ];

  const view = sp.get("view") ?? "azi";
  const q = sp.get("q") ?? "";
  const status = sp.get("status") ?? "";
  const category = sp.get("category") ?? "";

  function patch(updates: Record<string, string>) {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(updates)) {
      if (v) params.set(k, v); else params.delete(k);
    }
    start(() => router.push(`${pathname}?${params.toString()}`));
  }

  const hasFilters = !!(q || status || category);

  return (
    <div className="mb-4 flex flex-col gap-3">
      {/* View tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => patch({ view: v.key })}
            className={`tap shrink-0 rounded-full px-4 py-1.5 text-sm font-medium ${
              view === v.key ? "bg-brand text-white" : "card text-ink-soft"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => patch({ q: e.target.value })}
          placeholder={m.appts.searchPlaceholder}
          className="h-9 min-w-36 flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-brand"
        />
        <select value={status} onChange={(e) => patch({ status: e.target.value })} className={fldCls(status)}>
          <option value="">{m.appts.filterStatusAll}</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {categories.length > 0 && (
          <select value={category} onChange={(e) => patch({ category: e.target.value })} className={fldCls(category)}>
            <option value="">{m.appts.filterCategoryAll}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        )}
        {hasFilters && (
          <button
            onClick={() => { patch({ q: "", status: "", category: "" }); clearFilters(); }}
            className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            {m.common.clearFilters}
          </button>
        )}
      </div>
    </div>
  );
}
