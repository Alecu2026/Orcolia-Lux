"use client";

import { useEffect, useState } from "react";
import { useMessages } from "@/lib/i18n/context";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const buffer = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export default function PushToggle() {
  const m = useMessages();
  const [supported, setSupported] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const ok = "serviceWorker" in navigator && "PushManager" in window;
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setSubscribed(Boolean(sub)))
      .catch(() => {});
  }, []);

  async function enable() {
    setBusy(true);
    setMsg("");
    try {
      if (!VAPID) throw new Error(m.push.missingKey);
      const reg = await navigator.serviceWorker.register("/sw.js");
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error(m.push.permissionDenied);
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID),
      });
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub),
      });
      if (!res.ok) throw new Error(m.push.saveFailed);
      setSubscribed(true);
      setMsg(m.push.enabled);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : m.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      setMsg(m.push.disabled);
    } catch {
      setMsg(m.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    await fetch("/api/push/test", { method: "POST" });
    setMsg(m.push.testSent);
  }

  return (
    <div className="card p-5">
      <h2 className="mb-1 text-base font-bold">{m.push.title}</h2>
      <p className="mb-3 text-sm text-ink-soft">
        {supported ? m.push.supported : m.push.notSupported}
      </p>
      {supported && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {!subscribed ? (
            <button onClick={enable} disabled={busy} className="tap h-11 w-full rounded-xl bg-brand px-4 font-semibold text-white hover:bg-brand-strong disabled:opacity-60 sm:w-auto">
              {busy ? "…" : m.push.enable}
            </button>
          ) : (
            <>
              <button onClick={test} className="tap h-11 w-full rounded-xl bg-[var(--color-surface-2)] px-4 font-medium hover:bg-brand-soft sm:w-auto">
                {m.push.sendTest}
              </button>
              <button onClick={disable} disabled={busy} className="tap h-11 w-full rounded-xl border border-[var(--color-line)] px-4 font-medium text-ink-soft sm:w-auto">
                {m.push.disable}
              </button>
            </>
          )}
        </div>
      )}
      {msg && <p className="mt-2 text-xs text-ink-soft">{msg}</p>}
    </div>
  );
}
