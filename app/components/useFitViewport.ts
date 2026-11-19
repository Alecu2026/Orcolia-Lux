"use client";

import { useLayoutEffect, useState } from "react";

/**
 * „Încape într-un ecran”: întoarce înălțimea maximă (px) pentru zona cu rânduri (tabel / listă), ca pagina să nu mai derulează, iar titlul și filtrele de sus să rămână la vedere.
 * Se măsoară pe ecranul dispozitivului: de la sfârșitul conținutului paginii (inclusiv ce e sub listă: paginare, spațiul de jos) până la marginea de jos a ecranului, și diferența se adaugă / scade
 * din înălțimea de acum a zonei. Se recalculează la redimensionarea ferestrei (rotirea telefonului), când se schimbă conținutul paginii și când se schimbă `deps`.
 *
 * Doar pentru lista principală a paginii (începe în jumătatea de sus a ecranului) și nu în ferestre (dialog): un tabel secundar, mai jos pe pagină, rămâne ca înainte (`null`).
 * `getBox` întoarce elementul care derulează (poate lipsi — atunci `null`). Zona nu coboară sub `MIN` px, chiar dacă pagina tot depășește ecranul (ecrane foarte mici).
 */
const MIN = 220;

export function useFitViewport(getBox: () => HTMLElement | null, deps: readonly unknown[]): number | null {
  const [fitMax, setFitMax] = useState<number | null>(null);
  useLayoutEffect(() => {
    const box = getBox();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cutia a dispărut / e într-o fereastră: revenim la înălțimea implicită
    if (!box) { setFitMax(null); return; }
    if (box.closest('[role="dialog"], [aria-modal="true"]')) { setFitMax(null); return; }
    let raf = 0;
    const fit = () => {
      raf = 0;
      const top = box.getBoundingClientRect().top + window.scrollY;
      if (top > window.innerHeight * 0.5) { setFitMax((c) => (c === null ? c : null)); return; }
      const h = box.getBoundingClientRect().height;
      // spațiul liber până la marginea de jos: de la sfârșitul conținutului paginii, nu de la înălțimea documentului (care e cel puțin cât ecranul)
      const main = box.closest("main");
      let free: number;
      if (main) {
        let bottom = 0;
        for (const c of Array.from(main.children)) {
          const pos = getComputedStyle(c).position;
          if (pos === "fixed" || pos === "absolute") continue;
          bottom = Math.max(bottom, c.getBoundingClientRect().bottom);
        }
        free = window.innerHeight - (bottom + (parseFloat(getComputedStyle(main).paddingBottom) || 0));
      } else {
        free = window.innerHeight - document.documentElement.scrollHeight;
      }
      const next = Math.max(MIN, Math.floor(h + free));
      setFitMax((c) => (c !== null && Math.abs(c - next) < 2 ? c : next));
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(fit); };
    fit();
    window.addEventListener("resize", schedule);
    const obs = new ResizeObserver(schedule);
    obs.observe(document.body);
    return () => { window.removeEventListener("resize", schedule); obs.disconnect(); if (raf) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return fitMax;
}
