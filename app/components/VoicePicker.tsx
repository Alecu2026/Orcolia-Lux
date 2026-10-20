"use client";

import { useEffect, useRef, useState } from "react";
import { NOTIFY_VOICES, callSeconds, voiceById } from "@/lib/payer-notify";

type Phase = "idle" | "download" | "synth" | "playing";

/**
 * Alegerea vocii + „Ascultă" (citirea mesajului). Vocea rulează chiar în pagină (Piper, open-source, prin @diffusionstudio/vits-web):
 * fără cont și fără voci instalate în Windows. Prima dată se descarcă modelul vocii (~60 MB, din Hugging Face) și rămâne
 * salvat în browser; apoi pornește imediat. Dacă descărcarea eșuează (offline), încercăm o voce a dispozitivului.
 * Apelul prin PBX e cu operator — vocea nu intră în convorbire.
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
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);
  const runRef = useRef(0);
  const v = voiceById(voice);

  function stop() {
    runRef.current++; // anulează o sinteză în curs
    try { audioRef.current?.pause(); } catch {}
    try { window.speechSynthesis?.cancel(); } catch {}
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
    setPhase("idle");
  }
  // oprește redarea la închidere
  useEffect(() => stop, []);

  async function speakWithDevice(): Promise<boolean> {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return false;
    const match = synth.getVoices().find((x) => x.lang.toLowerCase().replace("_", "-").startsWith(v.lang.slice(0, 2).toLowerCase()));
    if (!match) return false;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = match.lang;
    u.voice = match;
    u.onend = () => setPhase("idle");
    u.onerror = () => setPhase("idle");
    setPhase("playing");
    synth.speak(u);
    return true;
  }

  async function play() {
    if (phase !== "idle") { stop(); return; }
    if (!text.trim()) return;
    setError(null);
    const run = ++runRef.current;
    try {
      const tts = await import("@diffusionstudio/vits-web");
      const id = v.id as Parameters<typeof tts.predict>[0]["voiceId"];
      if (!(await tts.stored()).includes(id)) {
        setPhase("download");
        setPct(0);
        await tts.download(id, (p) => { if (p.total > 1_000_000) setPct(Math.round((p.loaded * 100) / p.total)); });
        if (run !== runRef.current) return;
      }
      setPhase("synth");
      const wav = await tts.predict({ text, voiceId: id });
      if (run !== runRef.current) return;
      const url = URL.createObjectURL(wav);
      urlRef.current = url;
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => stop();
      audio.onerror = () => { setError("Nu am putut reda sunetul."); stop(); };
      setPhase("playing");
      await audio.play();
    } catch (e) {
      if (run !== runRef.current) return;
      console.error("[voice] piper:", e);
      setPhase("idle");
      // fără internet / blocat: încercăm vocea dispozitivului, dacă are una în limba aleasă
      if (!(await speakWithDevice())) {
        setError("Nu am putut încărca vocea (verifică conexiunea la internet — modelul se descarcă o dată din Hugging Face).");
      }
    }
  }

  const supported = typeof window !== "undefined";
  const busy = phase !== "idle";
  const label = phase === "download" ? `Se descarcă vocea… ${pct}%` : phase === "synth" ? "Se pregătește…" : phase === "playing" ? "■ Oprește" : "▶ Ascultă";
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={v.id}
          onChange={(e) => { stop(); setError(null); onChange(e.target.value); }}
          aria-label="Vocea"
          className={`${compact ? "h-8" : "h-9"} cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-xs outline-none focus:border-brand`}
        >
          {NOTIFY_VOICES.map((x) => (
            <option key={x.id} value={x.id}>{x.label}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void play()}
          disabled={!supported || !text.trim() || phase === "download" || phase === "synth"}
          title="Ascultă mesajul cu vocea aleasă"
          className={`tap ${compact ? "h-8" : "h-9"} cursor-pointer rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft disabled:cursor-default disabled:opacity-60`}
        >
          {label}
        </button>
        {text.trim() && <span className="text-[11px] text-ink-soft">≈ {callSeconds(text)} s</span>}
        {busy && phase === "download" && (
          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-[var(--color-surface-2)]"><span className="block h-full bg-brand transition-all" style={{ width: `${pct}%` }} /></span>
        )}
      </div>
      {error && <p className="rounded-lg bg-st-progress/10 px-2 py-1 text-[11px] text-st-progress">{error}</p>}
    </div>
  );
}
