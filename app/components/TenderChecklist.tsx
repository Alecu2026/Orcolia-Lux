"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setTenderCheckAction, tenderChecksAction, type TenderChecks } from "@/app/actions/tender";
import { SPEC_GROUPS, SPEC_PARTS, STATUS_LABEL_RO, type SpecPart, type SpecStatus } from "@/lib/tender-spec";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";

const STATUS_CLS: Record<SpecStatus, string> = {
  done: "bg-st-done/12 text-st-done",
  partial: "bg-st-progress/12 text-st-progress",
  external: "bg-st-confirmed/12 text-st-confirmed",
  na: "bg-st-new/12 text-st-new",
  todo: "bg-st-cancelled/12 text-st-cancelled",
};
const STATUS_ORDER: SpecStatus[] = ["done", "partial", "external", "na", "todo"];
const PART_KEY = "tender-part";
const REFRESH_MS = 30_000;

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function Bar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2" aria-label={`${done} / ${total}`}>
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
        <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-ink-soft">{done} / {total} · {pct}%</span>
    </div>
  );
}

/** Caietul de sarcini: punctele contractului (engleză + română) de bifat împreună, cu „i” = unde se găsește în CRM și cum e implementat. */
export default function TenderChecklist({ initial }: { initial: TenderChecks }) {
  const t = useT();
  const tag = dateTag(useLocale());
  const [checks, setChecks] = useState<TenderChecks>(initial);
  const [part, setPart] = useState<SpecPart>("contract");
  const [q, setQ] = useState("");
  const [show, setShow] = useState<"all" | "done" | "todo">("all");
  const [statusF, setStatusF] = useState<"" | SpecStatus>("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);
  const busy = useRef(new Set<string>());

  useEffect(() => {
    try {
      const p = localStorage.getItem(PART_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (p === "contract" || p === "additional" || p === "ours") setPart(p);
    } catch {}
  }, []);
  const choosePart = (p: SpecPart) => {
    setPart(p);
    try {
      localStorage.setItem(PART_KEY, p);
    } catch {}
  };

  // bifele colegilor apar fără reîncărcarea paginii
  const refresh = useCallback(async () => {
    if (document.visibilityState !== "visible" || busy.current.size) return;
    const c = await tenderChecksAction().catch(() => null);
    if (c) setChecks(c);
  }, []);
  useEffect(() => {
    const id = setInterval(() => void refresh(), REFRESH_MS);
    const onVis = () => void refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [refresh]);

  const toggle = async (id: string, done: boolean) => {
    setErr(null);
    busy.current.add(id);
    const before = checks[id];
    setChecks((c) => {
      const n = { ...c };
      if (done) n[id] = { by: "…", at: new Date().toISOString() };
      else delete n[id];
      return n;
    });
    const r = await setTenderCheckAction(id, done).catch(() => ({ ok: false as const, error: "Nu am putut salva bifa." }));
    busy.current.delete(id);
    if (!r.ok) {
      setErr(t(r.error));
      setChecks((c) => {
        const n = { ...c };
        if (before) n[id] = before;
        else delete n[id];
        return n;
      });
      return;
    }
    setChecks((c) => {
      const n = { ...c };
      if (r.entry) n[id] = r.entry;
      else delete n[id];
      return n;
    });
  };

  const toggleSet = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  const nq = norm(q.trim());
  const groups = useMemo(
    () =>
      SPEC_GROUPS.filter((g) => g.part === part).map((g) => ({
        g,
        items: g.items
          .map((it, i) => ({ ...it, id: `${g.id}-${i + 1}` }))
          .filter((it) => {
            if (statusF && it.status !== statusF) return false;
            if (show === "done" && !checks[it.id]) return false;
            if (show === "todo" && checks[it.id]) return false;
            if (nq && !norm(`${it.en} ${it.ro} ${it.where}`).includes(nq)) return false;
            return true;
          }),
      })),
    [part, nq, show, statusF, checks],
  );

  const totals = useMemo(() => {
    const per = new Map<SpecPart, { done: number; total: number }>();
    for (const g of SPEC_GROUPS) {
      const cur = per.get(g.part) ?? { done: 0, total: 0 };
      g.items.forEach((_, i) => {
        cur.total++;
        if (checks[`${g.id}-${i + 1}`]) cur.done++;
      });
      per.set(g.part, cur);
    }
    return per;
  }, [checks]);
  const all = [...totals.values()].reduce((a, v) => ({ done: a.done + v.done, total: a.total + v.total }), { done: 0, total: 0 });
  const shown = groups.reduce((n, x) => n + x.items.length, 0);
  const active = (q ? 1 : 0) + (show !== "all" ? 1 : 0) + (statusF ? 1 : 0);

  const field = "h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2.5 text-sm";

  return (
    <div className="space-y-4" data-tender="">
      <div className="card flex flex-wrap items-center justify-between gap-3 p-3">
        <div>
          <p className="text-xs font-semibold text-ink-soft">{t("În total")}</p>
          <Bar done={all.done} total={all.total} />
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {SPEC_PARTS.map((p) => {
            const v = totals.get(p.id) ?? { done: 0, total: 0 };
            const on = part === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={on}
                data-tender-part={p.id}
                onClick={() => choosePart(p.id)}
                className={`tap h-9 cursor-pointer rounded-xl border px-3 text-sm font-medium ${on ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
              >
                {p.titleRo} <span className="ml-1 text-[11px] tabular-nums opacity-80">{v.done}/{v.total}</span>
              </button>
            );
          })}
        </div>
      </div>

      {SPEC_PARTS.filter((p) => p.id === part).map((p) => (
        <p key={p.id} className="text-sm text-ink-soft">
          <b className="text-ink">{p.titleEn}</b> — {p.noteRo}
        </p>
      ))}

      <div className="flex flex-wrap items-center gap-1.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Caută în puncte…")} aria-label={t("Caută în puncte…")} className={`${field} min-w-44 flex-1`} />
        <select value={show} onChange={(e) => setShow(e.target.value as typeof show)} className={field} aria-label={t("Bifare")}>
          <option value="all">{t("Toate")}</option>
          <option value="done">{t("Bifate")}</option>
          <option value="todo">{t("Nebifate")}</option>
        </select>
        <select value={statusF} onChange={(e) => setStatusF(e.target.value as typeof statusF)} className={field} aria-label={t("Acoperire în CRM")}>
          <option value="">{t("Acoperire în CRM: toate")}</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{t(STATUS_LABEL_RO[s])}</option>
          ))}
        </select>
        {active > 0 && (
          <button type="button" className="tap h-9 cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-semibold text-brand hover:bg-brand-soft" onClick={() => { setQ(""); setShow("all"); setStatusF(""); }}>
            {t("Resetează filtrele")} ({active})
          </button>
        )}
        <span className="text-[11px] text-ink-soft">{t("{n} puncte afișate", { n: shown })}</span>
      </div>
      {err && <p className="rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">{err}</p>}

      {groups.map(({ g, items }) => {
        if (items.length === 0 && active > 0) return null;
        const gdone = g.items.filter((_, i) => checks[`${g.id}-${i + 1}`]).length;
        const isFolded = folded.has(g.id);
        return (
          <section key={g.id} className="card overflow-hidden" data-tender-group={g.id}>
            <button type="button" onClick={() => setFolded((s) => toggleSet(s, g.id))} aria-expanded={!isFolded} className="flex w-full cursor-pointer flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] bg-[var(--color-surface-2)]/60 px-3 py-2.5 text-left">
              <span className="min-w-0">
                <span className="mr-2 rounded bg-brand/12 px-1.5 py-0.5 text-[11px] font-bold text-brand">{g.code}</span>
                <b className="text-sm">{g.titleRo}</b>
                <span className="block text-[12px] text-ink-soft">{g.titleEn}</span>
              </span>
              <Bar done={gdone} total={g.items.length} />
            </button>
            {!isFolded && (
              <div>
                {(g.introEn || g.introRo) && (
                  <div className="border-b border-[var(--color-line)] px-3 py-2 text-[12px] text-ink-soft">
                    {g.introEn && <p>{g.introEn}</p>}
                    {g.introRo && <p className="mt-0.5 italic">{g.introRo}</p>}
                  </div>
                )}
                <ul>
                  {items.map((it) => {
                    const c = checks[it.id];
                    const isOpen = open.has(it.id);
                    return (
                      <li key={it.id} data-tender-item={it.id} className="border-b border-[var(--color-line)] last:border-b-0">
                        <div className="flex items-start gap-3 px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={!!c}
                            onChange={(e) => void toggle(it.id, e.target.checked)}
                            aria-label={it.en}
                            className="mt-0.5 size-5 shrink-0 cursor-pointer accent-[var(--color-brand)]"
                          />
                          <div className="min-w-0 flex-1">
                            <p className={`text-sm font-medium ${c ? "text-ink-soft" : ""}`}>{it.en}</p>
                            <p className="mt-0.5 text-sm text-ink-soft">{it.ro}</p>
                            {c && (
                              <p className="mt-1 text-[11px] text-st-done">
                                ✓ {t("Bifat de {name}", { name: c.by })} · {new Date(c.at).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" })}
                              </p>
                            )}
                          </div>
                          <span className={`hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold sm:inline ${STATUS_CLS[it.status]}`}>{t(STATUS_LABEL_RO[it.status])}</span>
                          <button
                            type="button"
                            onClick={() => setOpen((s) => toggleSet(s, it.id))}
                            aria-expanded={isOpen}
                            aria-label={t("Unde găsești și cum e implementat")}
                            title={t("Unde găsești și cum e implementat")}
                            data-tender-info={it.id}
                            className={`grid size-7 shrink-0 cursor-pointer place-items-center rounded-full border text-sm font-bold ${isOpen ? "border-brand bg-brand text-white" : "border-[var(--color-line)] text-brand hover:bg-brand-soft"}`}
                          >
                            i
                          </button>
                        </div>
                        {isOpen && (
                          <div className="mx-3 mb-3 rounded-xl border border-brand/30 bg-brand-soft/40 p-3 text-sm" data-tender-panel={it.id}>
                            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
                              {t("Unde se găsește / cum e implementat")}
                              <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal ${STATUS_CLS[it.status]}`}>{t(STATUS_LABEL_RO[it.status])}</span>
                            </p>
                            <p>{it.where}</p>
                            {it.links && it.links.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {it.links.map((l) => (
                                  <Link key={l.href + l.label} href={l.href} className="tap inline-flex h-8 items-center rounded-lg border border-brand/40 bg-[var(--color-surface)] px-2.5 text-xs font-semibold text-brand hover:bg-brand-soft">
                                    {t("Deschide")}: {l.label} →
                                  </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                  {items.length === 0 && <li className="px-3 py-4 text-center text-xs text-ink-soft">{t("Niciun punct pentru aceste filtre.")}</li>}
                </ul>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
