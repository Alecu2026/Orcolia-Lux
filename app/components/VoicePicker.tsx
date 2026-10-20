"use client";

import { useEffect, useState } from "react";
import { NOTIFY_VOICES, callSeconds, voiceById } from "@/lib/payer-notify";

/**
 * Alegerea vocii apelului + „Ascultă" (previzualizare cu vocea din browser, în limba aleasă). Vocea de probă vine din
 * dispozitivul tău și sună altfel decât cea din apel; textul și limba sunt însă aceleași.
 */
export default function VoicePicker({
  voice,
  text,
  onChange,
  compact = false,
}: {
  voice: string;
  text: string;
  onChange: (id: string) => void;
  compact?: boolean;
}) {
  const [speaking, setSpeaking] = useState(false);
  const v = voiceById(voice);

  // oprește redarea la închidere
  useEffect(() => () => { try { window.speechSynthesis?.cancel(); } catch {} }, []);

  function toggle() {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    if (!text.trim()) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = v.lang;
    const match = synth.getVoices().find((x) => x.lang.toLowerCase().startsWith(v.lang.slice(0, 2).toLowerCase()));
    if (match) u.voice = match;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  }

  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={v.id}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Vocea apelului"
        className={`${compact ? "h-8" : "h-9"} cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-xs outline-none focus:border-brand`}
      >
        {NOTIFY_VOICES.map((x) => (
          <option key={x.id} value={x.id}>{x.label}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={toggle}
        disabled={!supported || !text.trim()}
        title={supported ? "Ascultă textul (voce de probă din browser)" : "Browserul nu poate reda voce"}
        className={`tap ${compact ? "h-8" : "h-9"} cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft disabled:cursor-default disabled:opacity-40`}
      >
        {speaking ? "■ Oprește" : "▶ Ascultă"}
      </button>
      {text.trim() && <span className="text-[11px] text-ink-soft">≈ {callSeconds(text)} s</span>}
    </div>
  );
}
