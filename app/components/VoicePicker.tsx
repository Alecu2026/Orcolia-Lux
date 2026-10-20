"use client";

import { useEffect, useState } from "react";
import { NOTIFY_VOICES, callSeconds, voiceById } from "@/lib/payer-notify";

const FEMALE = /female|woman|ioana|irina|svetlana|milena|alina|elena|anna|katya|ekaterina|zira|hazel|samantha/i;
const MALE = /\bmale\b|andrei|pavel|dmitri|dmitry|emil|mihai|maxim|ivan|david|mark|yuri/i;

/** Cea mai potrivită voce din browser pentru limba și genul alese; null dacă dispozitivul nu are nicio voce în acea limbă. */
function pickVoice(voices: SpeechSynthesisVoice[], lang: string, gender: "f" | "m"): SpeechSynthesisVoice | null {
  const base = lang.slice(0, 2).toLowerCase();
  const inLang = voices.filter((x) => x.lang.toLowerCase().replace("_", "-").startsWith(base));
  if (inLang.length === 0) return null;
  const want = gender === "f" ? FEMALE : MALE;
  return (
    inLang.find((x) => x.lang.toLowerCase().replace("_", "-") === lang.toLowerCase() && want.test(x.name)) ??
    inLang.find((x) => want.test(x.name)) ??
    inLang.find((x) => x.lang.toLowerCase().replace("_", "-") === lang.toLowerCase()) ??
    inLang[0]
  );
}

/**
 * Alegerea vocii + „Ascultă" (citirea mesajului cu o voce din browser, în limba aleasă). Vocea vine din dispozitivul tău;
 * dacă acesta nu are voce în limba aleasă, nu redăm nimic (altfel textul ar fi citit în engleză) și arătăm cum se instalează.
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
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const v = voiceById(voice);

  // Vocile se încarcă asincron în browser (prima citire poate fi goală).
  useEffect(() => {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    const load = () => setVoices(synth.getVoices());
    load();
    synth.addEventListener("voiceschanged", load);
    return () => {
      synth.removeEventListener("voiceschanged", load);
      synth.cancel();
    };
  }, []);

  const picked = pickVoice(voices, v.lang, v.gender);

  function toggle() {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth) return;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    if (!text.trim()) return;
    if (!picked) {
      setHint(
        `Acest dispozitiv nu are nicio voce ${v.lang === "ro-RO" ? "românească" : "rusă"} instalată, deci nu pot reda proba. ` +
          "Ca s-o auzi aici: Windows → Setări → Oră și limbă → Vorbire → Adăugați voci.",
      );
      return;
    }
    setHint(null);
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = picked.lang;
    u.voice = picked;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    setSpeaking(true);
    synth.speak(u);
  }

  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={v.id}
          onChange={(e) => { setHint(null); onChange(e.target.value); }}
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
      <p className="text-[11px] text-ink-soft">
        {picked ? `Probă cu vocea dispozitivului: ${picked.name}.` : voices.length ? `Dispozitivul nu are nicio voce ${v.lang}.` : ""}
      </p>
      {hint && <p className="rounded-lg bg-st-progress/10 px-2 py-1 text-[11px] text-st-progress">{hint}</p>}
    </div>
  );
}
