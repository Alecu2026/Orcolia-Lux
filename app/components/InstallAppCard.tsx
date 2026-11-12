"use client";

import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n/context";
import { getInstallPrompt, onInstallChange, type InstallPromptEvent } from "@/lib/pwa-install";

/**
 * Setări → „Instalează aplicația”: butonul de descărcare / instalare a CRM-ului ca aplicație (PWA) pe calculator sau telefon.
 * Dacă browserul oferă instalarea directă (Chrome, Edge, Android), apare butonul; altfel se arată pașii pentru browserul curent.
 */
export default function InstallAppCard() {
  const t = useT();
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [env, setEnv] = useState<"ios" | "firefox" | "chromium" | "other">("other");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: window-controls-overlay)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    const ua = navigator.userAgent;
    const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    /* eslint-disable react-hooks/set-state-in-effect -- citirea mediului din browser (nu se poate deriva la randare) */
    setInstalled(standalone);
    setEnv(ios ? "ios" : /firefox/i.test(ua) ? "firefox" : /chrome|chromium|edg\//i.test(ua) ? "chromium" : "other");
    setPrompt(getInstallPrompt());
    /* eslint-enable react-hooks/set-state-in-effect */
    return onInstallChange(() => {
      setPrompt(getInstallPrompt());
      if (!getInstallPrompt()) setInstalled(window.matchMedia("(display-mode: standalone)").matches);
    });
  }, []);

  async function install() {
    if (!prompt) return;
    setBusy(true);
    setMsg("");
    try {
      await prompt.prompt();
      const { outcome } = await prompt.userChoice;
      setMsg(outcome === "accepted" ? t("Se instalează… o găsești în meniul Start și pe desktop.") : t("Instalarea a fost anulată."));
    } catch {
      setMsg(t("Nu am putut porni instalarea. Folosește meniul browserului."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <h2 className="mb-1 text-base font-bold">{t("Instalează aplicația")}</h2>
      <p className="mb-3 text-sm text-ink-soft">
        {t("Descarcă CRM-ul ca aplicație: fereastră proprie, pictogramă în Start / pe desktop, se actualizează singură.")}
      </p>

      {installed ? (
        <p className="text-sm font-medium text-st-done">✓ {t("Aplicația este instalată pe acest dispozitiv.")}</p>
      ) : prompt ? (
        <button type="button" onClick={() => void install()} disabled={busy} className="tap h-11 w-full rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-strong disabled:opacity-60 sm:w-auto">
          {busy ? "…" : `⬇ ${t("Descarcă / instalează aplicația")}`}
        </button>
      ) : env === "ios" ? (
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>{t("Deschide site-ul în Safari.")}</li>
          <li>{t("Apasă butonul Partajare (pătratul cu săgeată în sus).")}</li>
          <li>{t("Alege „Adaugă pe ecranul principal”.")}</li>
        </ol>
      ) : env === "firefox" ? (
        <p className="text-sm text-ink-soft">{t("Firefox nu poate instala aplicații pe calculator. Deschide site-ul în Chrome sau Edge.")}</p>
      ) : (
        <div className="space-y-2 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            <li>{t("Deschide meniul browserului (⋮ în Chrome, ⋯ în Edge).")}</li>
            <li>{t("Alege „Instalează aplicația” (Chrome: Salvează și partajează → Instalează pagina ca aplicație; Edge: Aplicații → Instalează acest site ca aplicație).")}</li>
          </ol>
          <p className="text-xs text-ink-soft">{t("Dacă aplicația e deja instalată, deschide-o din meniul Start; butonul de instalare nu mai apare în browser.")}</p>
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-ink-soft">{msg}</p>}
    </div>
  );
}
