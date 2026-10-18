"use client";

import { useEffect, useRef, useState } from "react";
import { IconX } from "./icons";

const MIN = 0.5;
const MAX = 3;
const STEP = 0.25;

/**
 * Factura reală (aceeași pagină publică pe care o vede clientul / din PDF) într-un pop-up, cu zoom.
 * Randăm pagina într-un iframe, nu o reimplementare separată, ca să fie mereu identică. Zoom-ul scalează
 * iframe-ul (transform) — conținutul se derulează în interiorul lui, deci poți mări și apoi „plimba" factura.
 */
export default function InvoicePreviewDialog({
  token,
  title = "Factură",
  onClose,
}: {
  token: string;
  title?: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(1);
  // undefined = încă nu s-a încărcat; true = zoom CSS direct în documentul facturii; false = nu avem acces → scalăm iframe-ul.
  const [native, setNative] = useState<boolean | undefined>(undefined);
  const clamp = (z: number) => Math.min(MAX, Math.max(MIN, Math.round(z * 100) / 100));

  useEffect(() => {
    zoomRef.current = zoom;
    if (!native) return;
    try {
      const el = frameRef.current?.contentDocument?.documentElement;
      if (el) el.style.setProperty("zoom", String(zoom));
    } catch {}
  }, [zoom, native]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => clamp(z * Math.exp(-e.deltaY * 0.0025)));
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") setZoom((z) => clamp(z + STEP));
      else if (e.key === "-") setZoom((z) => clamp(z - STEP));
      else if (e.key === "0") setZoom(1);
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // Iframe-ul e pe același domeniu, deci îi putem prinde rotița (Ctrl + rotiță = zoom) și tastele chiar când
  // focusul e în interiorul facturii — altfel browserul ar mări toată pagina, nu doar factura.
  function attachIframeListeners(win: Window | null) {
    if (!win) return;
    win.addEventListener(
      "wheel",
      (e) => {
        if (!(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        setZoom((z) => clamp(z * Math.exp(-e.deltaY * 0.0025)));
      },
      { passive: false },
    );

    // Pinch cu două degete: browserul ar mări toată pagina (inclusiv butoanele) — îl oprim și mărim doar factura.
    const root = win.document.documentElement;
    root.style.touchAction = "pan-x pan-y";
    win.document.body.style.touchAction = "pan-x pan-y";
    let startDist = 0;
    let startZoom = 1;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    win.addEventListener("touchstart", (e) => {
      if (e.touches.length === 2) { startDist = dist(e.touches); startZoom = zoomRef.current; }
    }, { passive: true });
    win.addEventListener("touchmove", (e) => {
      if (e.touches.length === 2 && startDist > 0) {
        e.preventDefault();
        setZoom(clamp(startZoom * (dist(e.touches) / startDist)));
      }
    }, { passive: false });
    win.addEventListener("touchend", () => { startDist = 0; });
    win.addEventListener("keydown", (e) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") setZoom((z) => clamp(z + STEP));
      else if (e.key === "-") setZoom((z) => clamp(z - STEP));
      else if (e.key === "0") setZoom(1);
    });
  }

  const btn =
    "tap grid size-8 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-base font-semibold hover:bg-brand-soft disabled:cursor-default disabled:opacity-40";

  return (
    <div
      ref={rootRef}
      style={{ touchAction: "pan-x pan-y" }}
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="flex h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-[var(--color-surface)] shadow-2xl sm:rounded-2xl">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-line)] px-3 py-2">
          <h2 className="min-w-0 truncate text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-1.5">
            <button type="button" className={btn} onClick={() => setZoom((z) => clamp(z - STEP))} disabled={zoom <= MIN} title="Micșorează (-, sau Ctrl + rotiță)" aria-label="Micșorează">
              −
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              title="Mărime normală (0)"
              className="tap h-8 min-w-14 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-xs font-semibold tabular-nums hover:bg-brand-soft"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" className={btn} onClick={() => setZoom((z) => clamp(z + STEP))} disabled={zoom >= MAX} title="Mărește (+, sau Ctrl + rotiță)" aria-label="Mărește">
              +
            </button>
            <a
              href={`/invoice/public/${token}`}
              target="_blank"
              rel="noreferrer"
              className="tap ml-1 hidden h-8 cursor-pointer items-center rounded-lg border border-[var(--color-line)] px-3 text-xs hover:bg-[var(--color-surface-2)] sm:inline-flex"
            >
              Filă nouă ↗
            </a>
            <button type="button" onClick={onClose} className="tap grid size-8 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label="Închide">
              <IconX className="size-4" />
            </button>
          </div>
        </div>
        <div className="relative flex-1 overflow-hidden bg-zinc-100">
          <div
            style={native === false ? { width: `${100 / zoom}%`, height: `${100 / zoom}%`, transform: `scale(${zoom})`, transformOrigin: "0 0" } : { width: "100%", height: "100%" }}
          >
            <iframe
              ref={frameRef}
              src={`/invoice/public/${token}`}
              title={title}
              className="size-full border-0 bg-white"
              onLoad={(e) => {
                try {
                  const win = e.currentTarget.contentWindow;
                  const el = e.currentTarget.contentDocument?.documentElement;
                  if (!win || !el) throw new Error("no access");
                  el.style.setProperty("zoom", String(zoomRef.current));
                  attachIframeListeners(win);
                  setNative(true);
                } catch {
                  setNative(false);
                }
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
