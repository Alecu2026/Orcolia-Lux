"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { publishManualAction, removeManualShotAction, unpublishManualAction, uploadManualShotAction } from "@/app/actions/manual";
import { readPackage } from "@/lib/manual/package";
import type { ShotInfo, ShotMap } from "@/lib/services/manual-shots";
import type { Block, ManualSection, Shot } from "@/lib/manual/types";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";
import { MIcon } from "./ManualIcons";
import { useToast } from "./toast";

/**
 * Manualul de utilizare: cuprins (carduri cu iconițe sus + acordeon în stânga, cu secțiunea activă evidențiată), căutare și, pentru fiecare pagină, explicația pas cu pas cu locuri pentru
 * screenshot-uri. Un loc fără poză arată de unde faci poza; după încărcare textul dispare și rămâne doar poza. Pozele le pune / schimbă / șterge doar editorul (`canEdit`):
 * din buton, prin trage-și-lasă sau lipind (Ctrl+V) un screenshot copiat cu Win+Shift+S. Fără emoji: peste tot sunt iconițe SVG.
 */

const MAX_BYTES = 12 * 1024 * 1024;

const norm = (s: string) => s.toLowerCase();
function blockText(b: Block): string {
  switch (b.t) {
    case "p":
    case "tip":
    case "warn":
      return b.text;
    case "steps":
    case "list":
      return `${b.title ?? ""} ${b.items.join(" ")}`;
    case "shot":
      return `${b.shot.where} ${b.shot.caption}`;
  }
}

/** Câte locuri pentru poze are o secțiune / o pagină și câte au deja poză. */
const shotKeysOf = (blocks: Block[]) => blocks.flatMap((b) => (b.t === "shot" ? [b.shot.key] : []));

export default function ManualView({
  sections,
  initialShots,
  canEdit,
  editorLabel,
  published,
  publishedAt,
  publishedBy,
}: {
  sections: ManualSection[];
  initialShots: ShotMap;
  /** contul editor: pune poze, exportă / importă pozele, apasă „Finalizat” */
  canEdit: boolean;
  editorLabel: string;
  /** manualul e publicat (îl văd și ceilalți) sau încă ciornă */
  published: boolean;
  publishedAt: string | null;
  publishedBy: string | null;
}) {
  const t = useT();
  const [shots, setShots] = useState<ShotMap>(initialShots);
  const [q, setQ] = useState("");
  const [zoom, setZoom] = useState<{ url: string; caption: string } | null>(null);
  const [activePage, setActivePage] = useState<string>(sections[0]?.pages[0]?.id ?? "");
  const [openSec, setOpenSec] = useState<Set<string>>(new Set(sections[0] ? [sections[0].id] : []));
  // secțiunile din conținut sunt pliabile: implicit toate închise (cardurile, cuprinsul și linkurile cu # le deschid); cât timp cauți, cele potrivite se arată desfăcute
  const [openMain, setOpenMain] = useState<Set<string>>(new Set());
  const searching = q.trim() !== "";
  const isOpen = (id: string) => searching || openMain.has(id);
  const toggleMain = (id: string) =>
    setOpenMain((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const total = useMemo(() => sections.reduce((n, s) => n + s.pages.reduce((m, pg) => m + shotKeysOf(pg.blocks).length, 0), 0), [sections]);
  const done = Object.keys(shots).length;

  const shown = useMemo(() => {
    const needle = norm(q.trim());
    if (!needle) return sections;
    return sections
      .map((s) => ({ ...s, pages: s.pages.filter((pg) => norm(`${pg.title} ${pg.blocks.map(blockText).join(" ")}`).includes(needle)) }))
      .filter((s) => s.pages.length > 0 || norm(s.title).includes(needle));
  }, [sections, q]);

  const toast = useToast();
  const tag = dateTag(useLocale());
  const [pub, setPub] = useState({ published, at: publishedAt, by: publishedBy });
  const [pubBusy, setPubBusy] = useState(false);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const importInput = useRef<HTMLInputElement>(null);

  /** „Finalizat”: manualul devine vizibil și pentru ceilalți; „Retrage”: redevine ciornă. */
  async function setPublished(next: boolean) {
    const missing = Math.max(0, total - Object.keys(shots).length);
    const msg = next
      ? missing > 0
        ? t("Mai lipsesc {n} poze. Locurile goale NU se arată celorlalți utilizatori. Publici manualul acum?", { n: missing })
        : t("Publici manualul? Îl vor vedea și ceilalți utilizatori cu dreptul „Manual de utilizare”, după drepturile lor.")
      : t("Retragi manualul din publicare? Redevine ciornă, vizibilă doar ție.");
    if (!window.confirm(msg)) return;
    setPubBusy(true);
    try {
      const res = next ? await publishManualAction() : await unpublishManualAction();
      if (res.ok) {
        setPub({ published: res.state.published, at: res.state.publishedAt, by: res.state.by });
        toast.success(next ? t("Manualul a fost publicat.") : t("Manualul a fost retras din publicare."));
      } else {
        toast.error(t(res.error));
      }
    } catch {
      toast.error(t("Nu am putut schimba starea manualului. Încearcă din nou."));
    } finally {
      setPubBusy(false);
    }
  }

  /** Importul unui pachet exportat de pe alt server: pozele se încarcă pe rând (fiecare se optimizează și se salvează în baza de date) și ajung singure la locul lor, după cheie. */
  async function importPackage(file: File | null | undefined) {
    if (!file) return;
    try {
      const pkg = readPackage(new Uint8Array(await file.arrayBuffer()));
      if (!pkg.ok) return toast.error(t(pkg.error));
      if (pkg.shots.length === 0) return toast.error(t("Pachetul nu conține poze."));
      if (!window.confirm(t("Imporți {n} poze? Pozele de la aceleași locuri din manual vor fi înlocuite.", { n: pkg.shots.length }))) return;
      let ok = 0;
      let skipped = pkg.skipped.length;
      let failed = 0;
      setImporting({ done: 0, total: pkg.shots.length });
      for (let i = 0; i < pkg.shots.length; i++) {
        const s = pkg.shots[i];
        try {
          const fd = new FormData();
          fd.set("key", s.key);
          fd.set("file", new File([s.data as BlobPart], s.name || `${s.key}.webp`, { type: s.mime }));
          const res = await uploadManualShotAction(fd);
          if (res.ok) {
            setShot(s.key, res.shot);
            ok++;
          } else if (/necunoscut/i.test(res.error)) skipped++;
          else failed++;
        } catch {
          failed++;
        }
        setImporting({ done: i + 1, total: pkg.shots.length });
      }
      const parts = [t("{n} poze importate", { n: ok })];
      if (skipped > 0) parts.push(t("{n} sărite (loc inexistent în acest manual)", { n: skipped }));
      if (failed > 0) parts.push(t("{n} eșuate", { n: failed }));
      (failed > 0 ? toast.error : toast.success)(parts.join(", ") + ".");
    } catch {
      toast.error(t("Nu am putut citi fișierul. Alege un pachet exportat din manual (.zip)."));
    } finally {
      setImporting(null);
      if (importInput.current) importInput.current.value = "";
    }
  }

  const setShot = useCallback((key: string, info: ShotInfo | null) => {
    setShots((cur) => {
      const n = { ...cur };
      if (info) n[key] = info;
      else delete n[key];
      return n;
    });
  }, []);

  // pagina din dreptul ecranului devine „activă” în cuprins (se evidențiază, iar secțiunea ei se deschide)
  const pageToSection = useMemo(() => new Map(sections.flatMap((s) => s.pages.map((pg) => [pg.id, s.id] as const))), [sections]);
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>("article[id^='p-']"));
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (!hit) return;
        const id = hit.target.id.slice(2);
        setActivePage(id);
        const sec = pageToSection.get(id);
        if (sec) setOpenSec((cur) => (cur.has(sec) ? cur : new Set(cur).add(sec)));
      },
      { rootMargin: "-15% 0px -70% 0px" },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [shown, pageToSection, openMain]);

  /** Deschide secțiunea și sare la element (după ce secțiunea s-a desfăcut). */
  const goTo = useCallback((targetId: string, secId: string) => {
    setOpenMain((cur) => (cur.has(secId) ? cur : new Set(cur).add(secId)));
    setOpenSec((cur) => (cur.has(secId) ? cur : new Set(cur).add(secId)));
    window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      try {
        window.history.replaceState(null, "", `#${targetId}`);
      } catch {}
    }, 60);
  }, []);

  // o adresă cu #s-… / #p-… (de exemplu trimisă unui coleg) deschide secțiunea respectivă
  useEffect(() => {
    const h = window.location.hash.slice(1);
    if (!h) return;
    const sec = h.startsWith("p-") ? pageToSection.get(h.slice(2)) : h.startsWith("s-") ? h.slice(2) : undefined;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adresa (#…) se poate citi abia în browser, după randare: secțiunea se deschide la montare
    if (sec && sections.some((s) => s.id === sec)) goTo(h, sec);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Ordinea tuturor locurilor pentru poze, ca „Următoarea poză lipsă” să meargă pe rând, chiar și prin secțiuni închise. */
  const slotOrder = useMemo(() => sections.flatMap((s) => s.pages.flatMap((pg) => pg.blocks.flatMap((b) => (b.t === "shot" ? [{ key: b.shot.key, sec: s.id }] : [])))), [sections]);
  const lastJump = useRef<string | null>(null);
  /** Sare la următorul loc fără poză, după cel la care ai ajuns ultima dată (la sfârșit, de la început); desface secțiunea în care se află. */
  function nextMissing() {
    const missing = slotOrder.filter((o) => !shots[o.key]);
    if (missing.length === 0) return;
    const after = lastJump.current ? slotOrder.findIndex((o) => o.key === lastJump.current) : -1;
    const next = missing.find((o) => slotOrder.indexOf(o) > after) ?? missing[0];
    lastJump.current = next.key;
    setOpenMain((cur) => (cur.has(next.sec) ? cur : new Set(cur).add(next.sec)));
    setOpenSec((cur) => (cur.has(next.sec) ? cur : new Set(cur).add(next.sec)));
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-shot-key="${next.key}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
    }, 80);
  }

  const toggleSec = (id: string) =>
    setOpenSec((cur) => {
      const n = new Set(cur);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  /** Cuprinsul din stânga: acordeon cu iconiță, număr și progresul pozelor pe fiecare secțiune și pagină. */
  const toc = (
    <ol className="space-y-1">
      {sections.map((s, si) => {
        const keys = s.pages.flatMap((pg) => shotKeysOf(pg.blocks));
        const got = keys.filter((k) => shots[k]).length;
        const open = openSec.has(s.id);
        const isActiveSec = pageToSection.get(activePage) === s.id;
        return (
          <li key={s.id}>
            <div className={`flex items-center gap-1 rounded-xl ${isActiveSec ? "bg-brand/10" : "hover:bg-[var(--color-surface-2)]"}`}>
              <a href={`#s-${s.id}`} onClick={(e) => { e.preventDefault(); goTo(`s-${s.id}`, s.id); }} className="flex min-w-0 flex-1 items-center gap-2.5 px-2 py-1.5">
                <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${isActiveSec ? "bg-brand text-white" : "bg-brand/10 text-brand"}`}>
                  <MIcon name={s.icon} className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-semibold leading-tight">{si + 1}. {s.title}</span>
                  {canEdit && keys.length > 0 && <span className="block text-[11px] leading-tight text-ink-soft">{got} / {keys.length} {t("poze")}</span>}
                </span>
              </a>
              <button type="button" onClick={() => toggleSec(s.id)} aria-expanded={open} aria-label={s.title} className="tap grid size-8 shrink-0 place-items-center rounded-lg text-ink-soft hover:text-brand">
                <MIcon name="chevron" className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
              </button>
            </div>
            {open && (
              <ul className="mb-1 ml-[22px] mt-0.5 space-y-0.5 border-l-2 border-[var(--color-line)] pl-3">
                {s.pages.map((pg, pi) => {
                  const pk = shotKeysOf(pg.blocks);
                  const pgot = pk.filter((k) => shots[k]).length;
                  const complete = pk.length > 0 && pgot === pk.length;
                  const active = activePage === pg.id;
                  return (
                    <li key={pg.id}>
                      <a
                        href={`#p-${pg.id}`}
                        onClick={(e) => { e.preventDefault(); goTo(`p-${pg.id}`, s.id); }}
                        aria-current={active ? "location" : undefined}
                        className={`flex items-center gap-2 rounded-lg px-2 py-1 text-[12.5px] leading-snug ${active ? "bg-brand/10 font-semibold text-brand" : "text-ink-soft hover:text-brand"}`}
                      >
                        <span className="w-7 shrink-0 tabular-nums text-[11px] opacity-70">{si + 1}.{pi + 1}</span>
                        <span className="min-w-0 flex-1">{pg.title}</span>
                        {canEdit ? (complete ? <MIcon name="check" className="size-3.5 shrink-0 text-st-done" /> : pk.length > 0 ? <span className="shrink-0 text-[10px] tabular-nums opacity-70">{pgot}/{pk.length}</span> : null) : null}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );

  const btn = "tap inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium text-ink-soft hover:bg-[var(--color-surface-2)]";

  return (
    <div className="grid gap-4 lg:grid-cols-[290px_minmax(0,1fr)]">
      <aside className="print:hidden">
        <details className="card p-3 lg:hidden">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold"><MIcon name="book" className="size-4 text-brand" />{t("Cuprins")}</summary>
          <div className="mt-2">{toc}</div>
        </details>
        <nav className="card hidden max-h-[calc(100dvh_-_var(--imp-h,0px)_-_6.5rem)] overflow-auto p-3 lg:sticky lg:top-[calc(var(--imp-h,0px)_+_5rem)] lg:block" aria-label={t("Cuprins")}>
          <p className="mb-2 flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft"><MIcon name="book" className="size-4 text-brand" />{t("Cuprins")}</p>
          {toc}
        </nav>
      </aside>

      <div className="min-w-0">
        <div className="card mb-4 flex flex-wrap items-center gap-2 p-3 print:hidden">
          <div className="relative min-w-48 flex-1">
            <MIcon name="search" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Caută în manual…")}
              aria-label={t("Căutare")}
              className="h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] pl-9 pr-3 text-sm outline-none focus:border-brand"
            />
          </div>
          {canEdit && (
            <>
              <span className="text-xs text-ink-soft">{t("Poze puse: {done} din {total}", { done, total })}</span>
              <div className="h-2 w-28 overflow-hidden rounded-full bg-[var(--color-surface-2)]" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total}>
                <div className="h-full rounded-full bg-brand" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
              </div>
            </>
          )}
          {canEdit && done < total && (
            <button type="button" onClick={nextMissing} className="tap inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">
              <MIcon name="arrowDown" className="size-3.5" />{t("Următoarea poză lipsă")}
            </button>
          )}
          <button type="button" onClick={() => setOpenMain(new Set(sections.map((s) => s.id)))} className={btn}>
            <MIcon name="chevron" className="size-4" />{t("Extinde tot")}
          </button>
          <button type="button" onClick={() => setOpenMain(new Set())} className={btn}>
            <MIcon name="chevron" className="size-4 rotate-180" />{t("Restrânge tot")}
          </button>
          {canEdit && (
            <>
              <a href="/api/manual/export" download className={btn} data-manual-export="" title={t("Descarcă toate pozele într-un singur fișier ZIP, ca să le imporți pe alt server (de exemplu în producție)")}>
                <MIcon name="download" className="size-4" />{t("Export poze")}
              </a>
              <button type="button" disabled={!!importing} onClick={() => importInput.current?.click()} className={btn} data-manual-import="" title={t("Încarcă un pachet ZIP exportat de pe alt server: toate pozele ajung singure la locul lor")}>
                <MIcon name="upload" className="size-4" />{importing ? `${t("Se importă")} ${importing.done} / ${importing.total}` : t("Import poze")}
              </button>
              <input ref={importInput} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => void importPackage(e.target.files?.[0])} />
            </>
          )}
          <a href="/api/manual/pdf" download className={btn} data-manual-pdf="">
            <MIcon name="file" className="size-4" />{t("Descarcă PDF")}
          </a>
          {canEdit && done < total && (
            <a href="/api/manual/pdf?placeholders=0" download className={btn} title={t("PDF doar cu ce are deja poză: locurile goale nu apar")}>
              <MIcon name="download" className="size-4" />{t("PDF fără cadrele goale")}
            </a>
          )}
        </div>

        {canEdit && (
          <div
            data-manual-role="editor"
            data-manual-state={pub.published ? "published" : "draft"}
            className={`mb-4 flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm print:hidden ${pub.published ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200" : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"}`}
          >
            <MIcon name={pub.published ? "check" : "alert"} className="mt-0.5 size-4 shrink-0" />
            <p>
              {pub.published
                ? t("Manualul este PUBLICAT: îl văd și ceilalți utilizatori cu dreptul „Manual de utilizare”. Mai poți pune sau înlocui poze (apasă pe un cadru galben); schimbările se văd imediat.")
                : t("Manualul este încă o CIORNĂ: îl vezi doar tu. Pune pozele (apasă pe un cadru galben), apoi apasă „Finalizat”, jos, ca să apară și pentru ceilalți.")}
            </p>
          </div>
        )}

        {/* Prezentare pe secțiuni: cardurile cuprinsului, pentru o privire de ansamblu */}
        {!q.trim() && (
          <div className="mb-6 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5 print:hidden" aria-label={t("Cuprins")}>
            {sections.map((s, si) => {
              const keys = s.pages.flatMap((pg) => shotKeysOf(pg.blocks));
              const got = keys.filter((k) => shots[k]).length;
              return (
                <a key={s.id} href={`#s-${s.id}`} onClick={(e) => { e.preventDefault(); goTo(`s-${s.id}`, s.id); }} className="card group flex flex-col gap-2 p-3 transition-colors hover:border-brand">
                  <span className="flex items-center justify-between">
                    <span className="grid size-10 place-items-center rounded-xl bg-brand/10 text-brand transition-colors group-hover:bg-brand group-hover:text-white"><MIcon name={s.icon} className="size-5" /></span>
                    <span className="text-xs font-bold tabular-nums text-ink-soft">{String(si + 1).padStart(2, "0")}</span>
                  </span>
                  <span className="text-[13px] font-semibold leading-snug">{s.title}</span>
                  <span className="mt-auto text-[11px] text-ink-soft">{s.pages.length} {t("pagini")}{canEdit && keys.length > 0 ? ` · ${got}/${keys.length} ${t("poze")}` : ""}</span>
                </a>
              );
            })}
          </div>
        )}

        {shown.length === 0 && <p className="card p-6 text-center text-sm text-ink-soft">{t("Nicio pagină nu se potrivește cu căutarea.")}</p>}

        {shown.map((s) => {
          const si = sections.findIndex((x) => x.id === s.id);
          return (
            <section key={s.id} id={`s-${s.id}`} className="mb-4 scroll-mt-[calc(var(--imp-h,0px)_+_5.5rem)]">
              {(() => {
                const sk = s.pages.flatMap((pg) => shotKeysOf(pg.blocks));
                const sgot = sk.filter((k) => shots[k]).length;
                return (
                  <button
                    type="button"
                    onClick={() => toggleMain(s.id)}
                    aria-expanded={isOpen(s.id)}
                    aria-controls={`sec-body-${s.id}`}
                    className={`card flex w-full items-center gap-3 p-3 text-left transition-colors hover:border-brand ${isOpen(s.id) ? "border-brand/60" : ""}`}
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-white"><MIcon name={s.icon} className="size-6" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{t("Secțiunea")} {si + 1} · {s.pages.length} {t("pagini")}{canEdit && sk.length > 0 ? ` · ${sgot}/${sk.length} ${t("poze")}` : ""}</span>
                      <span className="block text-xl font-bold leading-tight">{s.title}</span>
                    </span>
                    <MIcon name="chevron" className={`size-5 shrink-0 text-ink-soft transition-transform ${isOpen(s.id) ? "rotate-180" : ""}`} />
                  </button>
                );
              })()}
              <div id={`sec-body-${s.id}`} hidden={!isOpen(s.id)} className="mt-3">
              {s.intro && <p className="mb-4 text-[15px] leading-relaxed text-ink-soft">{s.intro}</p>}
              {s.pages.map((pg) => {
                const pi = sections[si].pages.findIndex((x) => x.id === pg.id);
                return (
                  <article key={pg.id} id={`p-${pg.id}`} className="card mb-4 scroll-mt-[calc(var(--imp-h,0px)_+_5.5rem)] p-4 sm:p-5">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-lg font-bold"><span className="mr-2 text-sm font-semibold tabular-nums text-brand">{si + 1}.{pi + 1}</span>{pg.title}</h3>
                        {pg.who && <p className="text-xs text-ink-soft">{pg.who}</p>}
                      </div>
                      {pg.path && (
                        <Link href={pg.path} className="tap inline-flex h-8 items-center gap-1.5 rounded-lg border border-brand/50 px-3 text-xs font-medium text-brand hover:bg-brand/10 print:hidden">
                          {t("Deschide pagina")}<MIcon name="arrowRight" className="size-3.5" />
                        </Link>
                      )}
                    </div>
                    <div className="space-y-3">
                      {pg.blocks.map((b, i) => (
                        <BlockView key={i} block={b} shots={shots} canEdit={canEdit} editorLabel={editorLabel} onShot={setShot} onZoom={setZoom} />
                      ))}
                    </div>
                  </article>
                );
              })}
              </div>
            </section>
          );
        })}
        {canEdit && (
          <section data-manual-finalize="" className="card mb-6 mt-6 p-4 sm:p-5 print:hidden">
            <div className="flex flex-wrap items-start gap-3">
              <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${pub.published ? "bg-st-done/15 text-st-done" : "bg-brand text-white"}`}>
                <MIcon name={pub.published ? "check" : "upload"} className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-bold">{pub.published ? t("Manualul este publicat") : t("Finalizare manual")}</h3>
                <p className="mt-0.5 text-sm text-ink-soft">
                  {pub.published
                    ? t("Publicat de {name}, {when}. Îl văd utilizatorii cu dreptul „Manual de utilizare”, doar paginile la care au acces.", { name: pub.by ?? "—", when: pub.at ? new Date(pub.at).toLocaleString(tag) : "—" })
                    : t("Acum manualul este o ciornă: îl vezi doar tu. Când ai pus pozele, apasă „Finalizat” și apare și pentru ceilalți utilizatori, după drepturile lor.")}
                </p>
                {!pub.published && done < total && (
                  <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">{t("Mai lipsesc {n} poze din {total}. Locurile goale nu se arată celorlalți.", { n: total - done, total })}</p>
                )}
              </div>
              <button
                type="button"
                disabled={pubBusy}
                onClick={() => void setPublished(!pub.published)}
                className={`tap inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold disabled:opacity-50 ${pub.published ? "border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]" : "bg-brand text-white hover:bg-brand-strong"}`}
              >
                <MIcon name={pub.published ? "replace" : "check"} className="size-4" />
                {pubBusy ? t("Se salvează…") : pub.published ? t("Retrage din publicare") : t("Finalizat")}
              </button>
            </div>
          </section>
        )}
      </div>

      {zoom && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 print:hidden" onClick={() => setZoom(null)} role="dialog" aria-label={zoom.caption}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom.url} alt={zoom.caption} className="max-h-full max-w-full rounded-lg bg-white object-contain" />
          <button type="button" onClick={() => setZoom(null)} className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/90 text-black" aria-label={t("Închide")}>
            <MIcon name="close" className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}

function BlockView({ block, shots, canEdit, editorLabel, onShot, onZoom }: { block: Block; shots: ShotMap; canEdit: boolean; editorLabel: string; onShot: (key: string, info: ShotInfo | null) => void; onZoom: (z: { url: string; caption: string }) => void }) {
  const t = useT();
  switch (block.t) {
    case "p":
      return <p className="text-[15px] leading-relaxed">{block.text}</p>;
    case "steps":
      return (
        <div>
          {block.title && <p className="mb-1.5 text-sm font-semibold">{block.title}</p>}
          <ol className="space-y-2">
            {block.items.map((it, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">{i + 1}</span>
                <span>{it}</span>
              </li>
            ))}
          </ol>
        </div>
      );
    case "list":
      return (
        <div>
          {block.title && <p className="mb-1.5 text-sm font-semibold">{block.title}</p>}
          <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed marker:text-brand">
            {block.items.map((it, i) => <li key={i}>{it}</li>)}
          </ul>
        </div>
      );
    case "tip":
      return (
        <div className="flex gap-2.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2.5 text-[14px] leading-relaxed text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
          <MIcon name="bulb" className="mt-0.5 size-5 shrink-0" />
          <p><b>{t("Sfat")}:</b> {block.text}</p>
        </div>
      );
    case "warn":
      return (
        <div className="flex gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-[14px] leading-relaxed text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          <MIcon name="alert" className="mt-0.5 size-5 shrink-0" />
          <p><b>{t("Atenție")}:</b> {block.text}</p>
        </div>
      );
    case "shot":
      return <ShotSlot shot={block.shot} info={shots[block.shot.key] ?? null} canEdit={canEdit} editorLabel={editorLabel} onShot={onShot} onZoom={onZoom} />;
  }
}

function ShotSlot({ shot, info, canEdit, editorLabel, onShot, onZoom }: { shot: Shot; info: ShotInfo | null; canEdit: boolean; editorLabel: string; onShot: (key: string, info: ShotInfo | null) => void; onZoom: (z: { url: string; caption: string }) => void }) {
  const t = useT();
  const tag = dateTag(useLocale());
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function upload(file: File | null | undefined) {
    if (!canEdit || !file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.error(t("Poza trebuie să fie PNG, JPEG sau WebP."));
    if (file.size > MAX_BYTES) return toast.error(t("Poza depășește 12 MB."));
    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("key", shot.key);
      fd.set("file", file);
      const res = await uploadManualShotAction(fd);
      if (res.ok) {
        onShot(shot.key, res.shot);
        toast.success(t("Poza a fost salvată."));
      } else {
        toast.error(t(res.error));
      }
    } catch {
      toast.error(t("Nu am putut salva poza. Încearcă din nou."));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove() {
    if (!window.confirm(t("Ștergi poza? Locul ei va arăta din nou instrucțiunea."))) return;
    setBusy(true);
    try {
      const res = await removeManualShotAction(shot.key);
      if (res.ok) {
        onShot(shot.key, null);
        toast.success(t("Poza a fost ștearsă."));
      } else {
        toast.error(t(res.error));
      }
    } catch {
      toast.error(t("Nu am putut șterge poza. Încearcă din nou."));
    } finally {
      setBusy(false);
    }
  }

  const fileInput = canEdit ? <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onClick={(e) => e.stopPropagation()} onChange={(e) => void upload(e.target.files?.[0])} /> : null;

  // ── există poză: se vede doar ea (textul cu instrucțiunea a dispărut) ──
  if (info) {
    return (
      <figure className="group my-1">
        {fileInput}
        <button type="button" onClick={() => onZoom({ url: info.url, caption: shot.caption })} className="block w-full cursor-zoom-in" aria-label={t("Mărește poza")}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={info.url} alt={shot.caption} loading="lazy" className="w-full rounded-xl border border-[var(--color-line)] bg-white" />
        </button>
        <figcaption className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
          <span>{shot.caption}</span>
          {canEdit && (
            <span className="ml-auto flex items-center gap-2 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 print:hidden">
              <span>{t("pusă de {name}, {when}", { name: info.by, when: new Date(info.at).toLocaleDateString(tag) })}</span>
              <button type="button" disabled={busy} onClick={() => input.current?.click()} className="tap inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--color-line)] px-2 hover:bg-[var(--color-surface-2)] disabled:opacity-50">
                <MIcon name="replace" className="size-3.5" />{busy ? t("Se încarcă…") : t("Înlocuiește poza")}
              </button>
              <button type="button" disabled={busy} onClick={() => void remove()} className="tap inline-flex h-7 items-center gap-1 rounded-lg border border-st-cancelled/50 px-2 text-st-cancelled hover:bg-st-cancelled/10 disabled:opacity-50">
                <MIcon name="trash" className="size-3.5" />{t("Șterge poza")}
              </button>
            </span>
          )}
        </figcaption>
      </figure>
    );
  }

  // ── nu există poză: arată de unde se face; editorul poate încărca / lipi / trage poza (cititorii nu văd cadre goale) ──
  if (!canEdit) return null;
  return (
    <div
      tabIndex={canEdit ? 0 : -1}
      data-shot-missing="1"
      data-shot-key={shot.key}
      role={canEdit ? "button" : undefined}
      aria-label={canEdit ? t("Alege o poză de pe dispozitiv") : undefined}
      // click (sau Enter / Spațiu) pe cadru → se deschide alegerea unei poze de pe dispozitiv
      onClick={() => {
        if (canEdit && !busy) input.current?.click();
      }}
      onKeyDown={(e) => {
        if (canEdit && !busy && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onPaste={(e) => {
        if (!canEdit) return;
        const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
        if (f) {
          e.preventDefault();
          void upload(f);
        }
      }}
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setOver(false);
        void upload(e.dataTransfer.files?.[0]);
      }}
      className={`rounded-xl border-2 border-dashed p-4 outline-none transition-colors focus:border-brand ${canEdit ? "cursor-pointer hover:border-brand" : ""} ${over ? "border-brand bg-brand/10" : "border-amber-400/70 bg-amber-50/60 dark:bg-amber-950/20"}`}
    >
      {fileInput}
      <p className="mb-1 flex items-center gap-2 text-sm font-bold"><MIcon name="camera" className="size-5 text-amber-600 dark:text-amber-400" />{t("Aici pui poza")}</p>
      <p className="text-[14px] leading-relaxed"><b>{t("De unde faci poza:")}</b> {shot.where}</p>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-soft"><b>{t("Ce trebuie să se vadă în poză:")}</b> {shot.caption}</p>
      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
          <button type="button" disabled={busy} onClick={(e) => { e.stopPropagation(); input.current?.click(); }} className="tap inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong disabled:opacity-50">
            <MIcon name="upload" className="size-4" />{busy ? t("Se încarcă…") : t("Încarcă poza")}
          </button>
          <span className="text-xs text-ink-soft">{t("Apasă oriunde în cadru ca să alegi o poză de pe dispozitiv, sau lipește-o cu Ctrl+V, sau trage-o aici. Poza se optimizează singură.")}</span>
        </div>
      )}
    </div>
  );
}
