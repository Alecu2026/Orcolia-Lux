"use client";

import { useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  markAllNotificationsRead,
  markNotificationRead,
  clearReadNotifications,
} from "@/app/actions/notifications";
import { useToast } from "./toast";
import { IconCheck, IconTrash } from "./icons";
import { useMessages } from "@/lib/i18n/context";

type Row = {
  id: string;
  title: string;
  body: string | null;
  url: string | null;
  read: boolean;
  createdAt: string | Date;
};

function buildPageButtons(page: number, total: number): (number | "…")[] {
  if (total <= 1) return [];
  const out: (number | "…")[] = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - page) <= 2) out.push(i);
    else if (out[out.length - 1] !== "…") out.push("…");
  }
  return out;
}

export default function NotificationsList({
  items,
  page,
  totalPages,
  ps,
  total,
}: {
  items: Row[];
  page: number;
  totalPages: number;
  ps: number;
  total: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const m = useMessages();
  const [, startNav] = useTransition();
  const [rows, setRows] = useState(items);
  const hasUnread = rows.some((r) => !r.read);

  function nav(updates: Record<string, string | number>) {
    const params = new URLSearchParams();
    const merged = { page: String(page), ps: String(ps), ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, String(v)])) };
    if (merged.page && merged.page !== "1") params.set("page", merged.page);
    if (merged.ps && merged.ps !== "20") params.set("ps", merged.ps);
    const qs = params.toString();
    startNav(() => router.push(`${pathname}${qs ? `?${qs}` : ""}`));
  }

  function markAll() {
    setRows((r) => r.map((x) => ({ ...x, read: true })));
    markAllNotificationsRead().then(() => router.refresh());
  }

  function clearRead() {
    setRows((r) => r.filter((x) => !x.read));
    clearReadNotifications()
      .then(() => {
        toast.success(m.notifications.clearReadDone);
        router.refresh();
      })
      .catch(() => toast.error(m.common.error));
  }

  function open(r: Row) {
    if (!r.read) {
      setRows((cur) => cur.map((x) => (x.id === r.id ? { ...x, read: true } : x)));
      markNotificationRead(r.id);
    }
    if (r.url) router.push(r.url);
  }

  const pageButtons = buildPageButtons(page, totalPages);
  const start = (page - 1) * ps + 1;
  const end = Math.min(page * ps, total);

  return (
    <>
      {/* Header */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-bold">{m.notifications.title}</h1>
          {total > 0 && (
            <span className="rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-xs text-ink-soft">
              {total}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Per-page selector */}
          <select
            value={ps}
            onChange={(e) => nav({ ps: e.target.value, page: "1" })}
            title={m.notifications.perPage}
            className="h-8 appearance-none rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] pl-2 pr-7 text-xs outline-none focus:border-brand sel-arrow"
          >
            {[10, 20, 50, 100].map((n) => (
              <option key={n} value={n}>{n} / pag.</option>
            ))}
          </select>
          <button
            onClick={markAll}
            disabled={!hasUnread}
            className="tap inline-flex items-center gap-1 rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-40"
          >
            <IconCheck className="size-3.5" /> {m.notifications.markAllRead}
          </button>
          <button
            onClick={clearRead}
            className="tap inline-flex items-center gap-1 rounded-lg border border-[var(--color-line)] px-3 py-1.5 text-xs font-medium text-ink-soft hover:bg-[var(--color-surface-2)]"
          >
            <IconTrash className="size-3.5" /> {m.notifications.clearRead}
          </button>
        </div>
      </div>

      {/* Count info */}
      {total > ps && (
        <p className="mb-2 text-xs text-ink-soft">
          {start}–{end} {m.notifications.paginationFmt.replace("{total}", String(total))}
        </p>
      )}

      {/* List */}
      {rows.length === 0 ? (
        <div className="card grid place-items-center p-10 text-center text-sm text-ink-soft">
          {m.notifications.noNotifications}
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => open(r)}
              className={`card flex items-start gap-3 p-3 text-left ${r.read ? "opacity-60" : ""}`}
            >
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${r.read ? "bg-[var(--color-line)]" : "bg-brand"}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.title}</p>
                {r.body && <p className="truncate text-xs text-ink-soft">{r.body}</p>}
                <p className="mt-0.5 text-[11px] text-ink-soft">
                  {new Date(r.createdAt).toLocaleString("ro-RO")}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pageButtons.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-1">
          {page > 1 && (
            <button
              onClick={() => nav({ page: page - 1 })}
              className="tap grid h-8 place-items-center rounded-lg border border-[var(--color-line)] px-3 text-sm hover:bg-[var(--color-surface-2)]"
            >
              ‹
            </button>
          )}
          {pageButtons.map((b, i) =>
            b === "…" ? (
              <span key={`e${i}`} className="px-1 text-xs text-ink-soft">…</span>
            ) : (
              <button
                key={b}
                onClick={() => nav({ page: b })}
                className={`tap grid size-8 place-items-center rounded-lg text-sm ${
                  b === page
                    ? "bg-brand font-semibold text-white"
                    : "border border-[var(--color-line)] text-ink hover:bg-[var(--color-surface-2)]"
                }`}
              >
                {b}
              </button>
            )
          )}
          {page < totalPages && (
            <button
              onClick={() => nav({ page: page + 1 })}
              className="tap grid h-8 place-items-center rounded-lg border border-[var(--color-line)] px-3 text-sm hover:bg-[var(--color-surface-2)]"
            >
              ›
            </button>
          )}
        </div>
      )}
    </>
  );
}
