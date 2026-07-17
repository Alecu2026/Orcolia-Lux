"use client";

import { useEffect, useState } from "react";
import { IconX } from "./icons";
import { useMessages } from "@/lib/i18n/context";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const SK = "oiab_v1";

type View = "ios" | "android-webview" | "android-install";

export default function OpenInApp() {
  const m = useMessages();
  const [view, setView] = useState<View | null>(null);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (isStandalone) return;

    if (sessionStorage.getItem(SK)) return;

    const ua = navigator.userAgent;
    const isIOS =
      /iphone|ipad|ipod/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /android/i.test(ua);

    if (isIOS) {
      setView("ios");
      return;
    }

    if (isAndroid) {
      const isWebView = /\bwv\b/i.test(ua) || /telegram/i.test(ua);
      if (isWebView) {
        setView("android-webview");
        return;
      }
      const handlePrompt = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e as BeforeInstallPromptEvent);
        setView("android-install");
      };
      window.addEventListener("beforeinstallprompt", handlePrompt);
      return () => window.removeEventListener("beforeinstallprompt", handlePrompt);
    }
  }, []);

  function dismiss() {
    sessionStorage.setItem(SK, "1");
    setView(null);
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") dismiss();
  }

  function openInChrome() {
    const { host, pathname, search, hash } = window.location;
    window.location.href =
      `intent://${host}${pathname}${search}${hash}` +
      `#Intent;action=android.intent.action.VIEW;scheme=https;package=com.android.chrome;end`;
  }

  if (!view) return null;

  return (
    <>
      {/* iOS guide modal */}
      {showGuide && (
        <div
          className="fixed inset-0 z-[200] flex items-end justify-center bg-black/60 p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-[var(--color-surface)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold">{m.pwa.addToHome}</h3>
              <button
                onClick={() => setShowGuide(false)}
                className="tap grid size-8 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]"
              >
                <IconX className="size-4" />
              </button>
            </div>
            <ol className="flex flex-col gap-3.5 text-sm">
              <li className="flex items-start gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">
                  1
                </span>
                <span>{m.pwa.iosStep1}</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">
                  2
                </span>
                <span>{m.pwa.iosStep2}</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-white">
                  3
                </span>
                <span>{m.pwa.iosStep3}</span>
              </li>
            </ol>
            <button
              onClick={() => {
                setShowGuide(false);
                dismiss();
              }}
              className="tap mt-5 w-full rounded-xl border border-[var(--color-line)] py-2.5 text-sm text-ink-soft"
            >
              {m.pwa.understood}
            </button>
          </div>
        </div>
      )}

      {/* Banner above bottom nav (mobile only) */}
      <div
        className="fixed left-3 right-3 z-[60] flex items-center gap-3 rounded-2xl bg-[var(--color-surface)] px-4 py-3 shadow-xl ring-1 ring-black/10 dark:ring-white/10 lg:hidden"
        style={{ bottom: "calc(60px + env(safe-area-inset-bottom, 0px) + 8px)" }}
      >
        <span className="select-none text-xl">📱</span>

        <div className="min-w-0 flex-1">
          {view === "ios" && (
            <>
              <p className="text-sm font-semibold leading-tight">{m.pwa.install}</p>
              <p className="text-xs text-ink-soft">{m.pwa.iosSubtitle}</p>
            </>
          )}
          {view === "android-webview" && (
            <>
              <p className="text-sm font-semibold leading-tight">{m.pwa.openInChrome}</p>
              <p className="text-xs text-ink-soft">{m.pwa.chromeSubtitle}</p>
            </>
          )}
          {view === "android-install" && (
            <>
              <p className="text-sm font-semibold leading-tight">{m.pwa.install}</p>
              <p className="text-xs text-ink-soft">{m.pwa.androidSubtitle}</p>
            </>
          )}
        </div>

        {view === "ios" && (
          <button
            onClick={() => setShowGuide(true)}
            className="tap shrink-0 rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white"
          >
            {m.pwa.howBtn}
          </button>
        )}
        {view === "android-webview" && (
          <button
            onClick={openInChrome}
            className="tap shrink-0 rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white"
          >
            {m.pwa.openBtn}
          </button>
        )}
        {view === "android-install" && (
          <button
            onClick={handleInstall}
            className="tap shrink-0 rounded-xl bg-brand px-3 py-1.5 text-xs font-semibold text-white"
          >
            {m.pwa.installBtn}
          </button>
        )}

        <button
          onClick={dismiss}
          className="tap grid size-7 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]"
        >
          <IconX className="size-3.5" />
        </button>
      </div>
    </>
  );
}
