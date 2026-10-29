"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveBottomNavAction } from "@/app/actions/bottom-nav";
import { BOTTOM_NAV_MAX, type NavMeta } from "@/lib/nav-meta";
import { useMessages, useT } from "@/lib/i18n/context";

/**
 * „Butoane rapide pe telefon”: alegi (maximum 5) și ordonezi paginile din bara de jos a telefonului. Se salvează pe contul tău. Fără nicio alegere se folosesc
 * primele 5 din meniu. Se aplică imediat, pe orice dispozitiv pe care te autentifici.
 */
export default function BottomNavSettings({ available, selected }: { available: Pick<NavMeta, "href" | "labelKey">[]; selected: string[] }) {
  const t = useT();
  const m = useMessages();
  const router = useRouter();
  const label = (href: string) => {
    const it = available.find((a) => a.href === href);
    return it ? m.nav[it.labelKey] : href;
  };
  const [list, setList] = useState<string[]>(selected.filter((h) => available.some((a) => a.href === h)));
  const [saved, setSaved] = useState(selected.join("|"));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = list.join("|") !== saved;
  const full = list.length >= BOTTOM_NAV_MAX;

  const toggle = (href: string) => {
    setMsg(null);
    setList((cur) => (cur.includes(href) ? cur.filter((h) => h !== href) : cur.length >= BOTTOM_NAV_MAX ? cur : [...cur, href]));
  };
  const move = (i: number, d: -1 | 1) => setList((cur) => {
    const j = i + d;
    if (j < 0 || j >= cur.length) return cur;
    const n = [...cur];
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });

  async function save(next: string[]) {
    setBusy(true);
    setMsg(null);
    const res = await saveBottomNavAction(next).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) return setMsg({ ok: false, text: res && !res.ok ? t(res.error) : t("A apărut o eroare. Încearcă din nou.") });
    setList(res.selected);
    setSaved(res.selected.join("|"));
    setMsg({ ok: true, text: t("Butoanele rapide au fost salvate.") });
    router.refresh();
  }

  return (
    <div className="card p-5">
      <h2 className="text-base font-bold">{t("Butoane rapide pe telefon")}</h2>
      <p className="mb-3 text-sm text-ink-soft">{t("Alege paginile care apar în bara de jos a telefonului (maximum {n}) și ordinea lor.", { n: BOTTOM_NAV_MAX })}</p>

      <p className="mb-1 text-xs font-semibold uppercase text-ink-soft">{t("Bara de jos")} ({list.length}/{BOTTOM_NAV_MAX})</p>
      {list.length === 0 ? (
        <p className="mb-3 rounded-xl border border-dashed border-[var(--color-line)] p-3 text-sm text-ink-soft">{t("Nimic ales: se folosesc primele {n} din meniu.", { n: BOTTOM_NAV_MAX })}</p>
      ) : (
        <div className="mb-3 flex flex-col gap-1">
          {list.map((h, i) => (
            <div key={h} className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] px-3 py-1.5 text-sm">
              <span className="w-5 text-xs text-ink-soft">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{label(h)}</span>
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t("Mai sus")} className="grid size-7 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-xs hover:bg-brand-soft disabled:opacity-30">▲</button>
              <button type="button" disabled={i === list.length - 1} onClick={() => move(i, 1)} aria-label={t("Mai jos")} className="grid size-7 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-xs hover:bg-brand-soft disabled:opacity-30">▼</button>
              <button type="button" onClick={() => toggle(h)} aria-label={t("Scoate")} className="grid size-7 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-xs text-st-cancelled hover:bg-st-cancelled/10">✕</button>
            </div>
          ))}
        </div>
      )}

      <p className="mb-1 text-xs font-semibold uppercase text-ink-soft">{t("Pagini disponibile")}</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {available.map((a) => {
          const on = list.includes(a.href);
          return (
            <button
              key={a.href}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => toggle(a.href)}
              className={`tap h-8 cursor-pointer rounded-full border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40 ${on ? "border-brand bg-brand text-white" : "border-[var(--color-line)] hover:bg-brand-soft"}`}
            >
              {on ? "✓ " : ""}{m.nav[a.labelKey]}
            </button>
          );
        })}
      </div>
      {full && <p className="mb-2 text-xs text-ink-soft">{t("Ai ales {n} butoane (maximum). Scoate unul ca să adaugi altul.", { n: BOTTOM_NAV_MAX })}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !dirty} onClick={() => save(list)} className="tap h-10 cursor-pointer rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50">
          {busy ? t("Se salvează…") : t("Salvează")}
        </button>
        <button type="button" disabled={busy || (list.length === 0 && saved === "")} onClick={() => save([])} className="tap h-10 cursor-pointer rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-50">
          {t("Revino la implicit")}
        </button>
        {msg && <span className={`text-xs ${msg.ok ? "text-ink-soft" : "text-st-cancelled"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
