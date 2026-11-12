/**
 * Evenimentul de instalare PWA (`beforeinstallprompt`) apare o singură dată, adesea ÎNAINTE ca pagina Setări să fie deschisă: îl prindem din layout (PWARegister), îl ținem aici
 * și butonul din Setări îl folosește când vrea. Cod doar pentru browser.
 */
export interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

type Holder = { __pwaInstall?: InstallPromptEvent | null };
const EVT = "pwa-install-change";

export function getInstallPrompt(): InstallPromptEvent | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as Holder).__pwaInstall ?? null;
}

/** Se apelează o singură dată (din layout): începe să asculte instalarea. */
export function captureInstallPrompt(): () => void {
  const h = window as unknown as Holder;
  const onPrompt = (e: Event) => {
    e.preventDefault();
    h.__pwaInstall = e as InstallPromptEvent;
    window.dispatchEvent(new Event(EVT));
  };
  const onInstalled = () => {
    h.__pwaInstall = null;
    window.dispatchEvent(new Event(EVT));
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

export function onInstallChange(cb: () => void): () => void {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}
