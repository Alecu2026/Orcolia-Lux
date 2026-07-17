"use client";

import { useEffect } from "react";
import { useMessages } from "@/lib/i18n/context";

export default function PWARegister({ unread = 0 }: { unread?: number }) {
  const m = useMessages();

  useEffect(() => {
    // Sync badge count with app icon (Badging API)
    if ("setAppBadge" in navigator) {
      (unread > 0
        ? (navigator as Navigator & { setAppBadge(n: number): Promise<void> }).setAppBadge(unread)
        : (navigator as Navigator & { clearAppBadge(): Promise<void> }).clearAppBadge()
      ).catch(() => {});
    }
    // Also tell SW so it can update badge from push events
    navigator.serviceWorker?.controller?.postMessage({ type: "SET_BADGE", count: unread });
  }, [unread]);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const newVersionLabel = m.pwa.newVersion;
    const updateLabel = m.pwa.update;

    navigator.serviceWorker.register("/sw.js").then((reg) => {
      // When a new SW is waiting, ask it to activate immediately
      reg.addEventListener("updatefound", () => {
        const next = reg.installing;
        if (!next) return;
        next.addEventListener("statechange", () => {
          if (next.state === "installed" && navigator.serviceWorker.controller) {
            showUpdateBanner(newVersionLabel, updateLabel);
          }
        });
      });
    }).catch(() => {});

    // If the SW controller changes (new SW took over), reload to get fresh assets
    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

function showUpdateBanner(newVersionLabel: string, updateLabel: string) {
  if (document.getElementById("pwa-update-banner")) return;

  const banner = document.createElement("div");
  banner.id = "pwa-update-banner";
  banner.style.cssText = [
    "position:fixed", "bottom:env(safe-area-inset-bottom,0)", "left:0", "right:0",
    "z-index:9999", "display:flex", "align-items:center", "justify-content:space-between",
    "gap:12px", "padding:12px 16px",
    "background:#0d9488", "color:#fff",
    "font-size:14px", "font-weight:500",
    "box-shadow:0 -2px 12px rgba(0,0,0,.2)",
  ].join(";");

  const text = document.createElement("span");
  text.textContent = newVersionLabel;

  const btn = document.createElement("button");
  btn.textContent = updateLabel;
  btn.style.cssText = [
    "background:#fff", "color:#0d9488", "border:none",
    "border-radius:8px", "padding:6px 14px",
    "font-size:13px", "font-weight:700", "cursor:pointer", "white-space:nowrap",
  ].join(";");
  btn.onclick = () => {
    navigator.serviceWorker.controller?.postMessage("SKIP_WAITING");
  };

  banner.appendChild(text);
  banner.appendChild(btn);
  document.body.appendChild(banner);
}
