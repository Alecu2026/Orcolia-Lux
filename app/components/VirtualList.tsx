"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Listă virtualizată cu înălțimi variabile (ex. carduri care se desfac la atingere): în DOM există doar elementele din zona vizibilă
 * (+ o rezervă), oricât de lungă ar fi lista — 19.000 de carduri costă cât 20. Înălțimile reale se măsoară (ResizeObserver) și înlocuiesc
 * estimarea pe măsură ce elementele apar pe ecran.
 */
export default function VirtualList({
  count,
  itemKey,
  render,
  estimate = 46,
  gap = 6,
  overscanPx = 500,
  className = "",
  height = "min(78dvh, 900px)",
}: {
  count: number;
  itemKey: (i: number) => string;
  render: (i: number) => ReactNode;
  estimate?: number;
  gap?: number;
  overscanPx?: number;
  className?: string;
  height?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const countRef = useRef(count);
  const ro = useRef<ResizeObserver | null>(null);
  const raf = useRef(0);
  // Înălțimile măsurate, pe lungimea curentă a listei; când lista se schimbă (alt filtru) măsurătorile vechi nu mai sunt valabile.
  const [meas, setMeas] = useState<{ count: number; h: Float32Array }>({ count, h: new Float32Array(count) });
  const [view, setView] = useState({ top: 0, h: 700 });
  const heights = meas.count === count ? meas.h : null;

  useEffect(() => {
    countRef.current = count;
    if (box.current) box.current.scrollTop = 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setView((v) => (v.top === 0 ? v : { ...v, top: 0 }));
  }, [count]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const upd = () => setView((v) => (v.h === el.clientHeight ? v : { ...v, h: el.clientHeight }));
    upd();
    const obs = new ResizeObserver(upd);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    ro.current = new ResizeObserver((entries) => {
      const updates: [number, number][] = [];
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const i = Number(el.dataset.vi);
        const h = Math.round(el.offsetHeight);
        if (Number.isFinite(i) && h > 0) updates.push([i, h]);
      }
      if (!updates.length) return;
      setMeas((prev) => {
        const n = countRef.current;
        const base = prev.count === n ? prev.h : new Float32Array(n);
        let next: Float32Array | null = null;
        for (const [i, h] of updates) {
          if (i < n && base[i] !== h) {
            next ??= new Float32Array(base);
            next[i] = h;
          }
        }
        return next ? { count: n, h: next } : prev.count === n ? prev : { count: n, h: base };
      });
    });
    const obs = ro.current;
    return () => obs.disconnect();
  }, []);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => {
      raf.current = 0;
      setView((v) => (v.top === top ? v : { ...v, top }));
    });
  }, []);

  // Poziția fiecărui element = suma înălțimilor de dinaintea lui (măsurate sau estimate). O trecere prin listă e ieftină (~0,1 ms la 19.000).
  const offsets = useMemo(() => {
    const o = new Float32Array(count + 1);
    for (let i = 0; i < count; i++) o[i + 1] = o[i] + ((heights && heights[i]) || estimate) + gap;
    return o;
  }, [count, estimate, gap, heights]);

  const from = lowerBound(offsets, Math.max(0, view.top - overscanPx));
  let to = from;
  const bottom = view.top + view.h + overscanPx;
  while (to < count && offsets[to] < bottom) to++;

  const items: ReactNode[] = [];
  for (let i = from; i < to; i++) {
    items.push(
      <div
        key={itemKey(i)}
        data-vi={i}
        ref={(el) => {
          if (el) ro.current?.observe(el);
        }}
      >
        {render(i)}
      </div>,
    );
  }

  return (
    <div ref={box} onScroll={onScroll} className={`overflow-y-auto overscroll-contain ${className}`} style={{ height: `min(${height}, ${Math.max(120, offsets[count])}px)` }}>
      <div style={{ paddingTop: offsets[from], paddingBottom: Math.max(0, offsets[count] - offsets[to]), display: "flex", flexDirection: "column", gap }}>{items}</div>
    </div>
  );
}

/** Elementul care conține poziția y (primul index i cu offsets[i + 1] > y). */
function lowerBound(offsets: Float32Array, y: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= y) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
