"use client";

import { useRouter, usePathname } from "next/navigation";
import { useTransition, useEffect, useRef } from "react";
import { useMessages } from "@/lib/i18n/context";

const STORAGE_KEY = "filters:dashboard";

const fldCls = (val: string) =>
  `h-8 appearance-none sel-arrow rounded-lg border pl-2 pr-7 text-xs outline-none focus:border-brand ${
    val
      ? "border-brand bg-brand/10 font-semibold text-brand"
      : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink"
  }`;

export default function DashboardFilters({
  prio,
  sort,
  ps,
  scope,
  isAdmin,
}: {
  prio: string;
  sort: string;
  ps: string;
  scope: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [, start] = useTransition();
  const isFirstRender = useRef(true);
  const m = useMessages();
  const d = m.dashboard;
  const p = m.priority as Record<string, string>;

  useEffect(() => {
    if (!isFirstRender.current) return;
    isFirstRender.current = false;
    const hasParams = prio || sort || ps || (isAdmin && scope && scope !== "mine");
    if (hasParams) return;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) router.replace(`${pathname}?${saved}`);
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(updates: Record<string, string>) {
    const merged = { prio, sort, ps, scope, page: "1", ...updates };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) {
      if (!v) continue;
      if (k === "page" && v === "1") continue;
      if (k === "ps" && v === "20") continue;
      if (k === "scope" && v === "mine") continue;
      params.set(k, v);
    }
    try {
      const qs = params.toString();
      if (qs) localStorage.setItem(STORAGE_KEY, qs);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
    const qs = params.toString();
    start(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`));
  }

  const hasFilters = !!(prio || sort);
  const effectiveScope = scope || "mine";

  return (
    <div className="mb-2 flex flex-col gap-2">
      {isAdmin && (
        <div className="flex gap-1.5">
          {(["mine", "all"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => patch({ scope: s })}
              className={`tap rounded-full px-3.5 py-1 text-xs font-medium ${
                effectiveScope === s
                  ? "bg-brand text-white"
                  : "border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"
              }`}
            >
              {s === "mine" ? d.mine : m.common.all}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={prio} onChange={(e) => patch({ prio: e.target.value })} className={fldCls(prio)}>
          <option value="">{d.priorityAll}</option>
          <option value="URGENT">{p.URGENT}</option>
          <option value="HIGH">{p.HIGH}</option>
          <option value="MEDIUM">{p.MEDIUM}</option>
          <option value="LOW">{p.LOW}</option>
        </select>
        <select value={sort} onChange={(e) => patch({ sort: e.target.value })} className={fldCls(sort)}>
          <option value="">{d.sortDefault}</option>
          <option value="dueAsc">{d.sortDueAsc}</option>
          <option value="dueDesc">{d.sortDueDesc}</option>
        </select>
        {hasFilters && (
          <button
            onClick={() => patch({ prio: "", sort: "" })}
            className="tap h-8 rounded-lg border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            {d.clearFilters}
          </button>
        )}
        <select
          value={ps || "20"}
          onChange={(e) => patch({ ps: e.target.value })}
          className="ml-auto h-8 appearance-none sel-arrow rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] pl-2 pr-7 text-xs outline-none focus:border-brand"
          title={d.perPage}
        >
          <option value="20">20 / pag.</option>
          <option value="50">50 / pag.</option>
          <option value="100">100 / pag.</option>
          <option value="200">200 / pag.</option>
          <option value="500">500 / pag.</option>
          <option value="1000">1000 / pag.</option>
          <option value="all">{m.common.all}</option>
        </select>
      </div>
    </div>
  );
}
