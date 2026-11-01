"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cancelTotpSetup, confirmTotpSetup, disableTotp, regenerateRecoveryCodes, signOutOtherSessions, startTotpSetup, type SetupInfo } from "@/app/actions/security";
import { describeAgent } from "@/lib/audit-meta";
import { useT } from "@/lib/i18n/context";
import { useToast } from "./toast";

export type SessionRow = { id: string; userAgent: string | null; ip: string | null; lastUsedAt: string; current: boolean };

const input = "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";
const btn = "tap h-11 rounded-xl bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60";
const btnGhost = "tap h-11 rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium hover:bg-[var(--color-surface-2)] disabled:opacity-60";

/** Setări → Securitate: autentificarea în doi pași (TOTP) cu coduri de recuperare, și sesiunile active ale contului. */
export default function SecurityPanel({ enabled, recoveryLeft, sessions, locale }: { enabled: boolean; recoveryLeft: number; sessions: SessionRow[]; locale: string }) {
  return (
    <>
      <TotpCard enabled={enabled} recoveryLeft={recoveryLeft} />
      <SessionsCard sessions={sessions} locale={locale} />
    </>
  );
}

function TotpCard({ enabled, recoveryLeft }: { enabled: boolean; recoveryLeft: number }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [setup, setSetup] = useState<SetupInfo | null>(null);
  const [mode, setMode] = useState<"idle" | "disable" | "regen">("idle");
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const reset = () => { setPassword(""); setCode(""); setError(""); };

  function begin() {
    setError("");
    start(async () => {
      const r = await startTotpSetup();
      if (r.ok) setSetup({ qr: r.qr, secret: r.secret });
      else setError(r.error);
    });
  }
  function cancel() {
    setSetup(null); setMode("idle"); reset();
    void cancelTotpSetup();
  }
  function confirm() {
    setError("");
    start(async () => {
      const r = await confirmTotpSetup(password, code);
      if (r.ok) { setSetup(null); setRecovery(r.recovery); reset(); }
      else setError(r.error);
    });
  }
  function off() {
    setError("");
    start(async () => {
      const r = await disableTotp(password, code);
      if (r.ok) { setMode("idle"); reset(); router.refresh(); }
      else setError(r.error);
    });
  }
  function regen() {
    setError("");
    start(async () => {
      const r = await regenerateRecoveryCodes(password, code);
      if (r.ok) { setMode("idle"); setRecovery(r.recovery); reset(); }
      else setError(r.error);
    });
  }

  return (
    <section className="card space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{t("Autentificare în doi pași (TOTP)")}</h2>
          <p className="text-sm text-ink-soft">{t("La intrare, pe lângă parolă, ți se cere un cod de 6 cifre din aplicația de pe telefon (Google Authenticator, Microsoft Authenticator, Authy …). Parola furată nu mai ajunge ca să intre cineva în cont.")}</p>
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${enabled ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>{enabled ? t("Activ") : t("Oprit")}</span>
      </div>

      {recovery && <RecoveryCodes codes={recovery} onDone={() => { setRecovery(null); router.refresh(); }} />}

      {!recovery && !enabled && !setup && (
        <button type="button" className={btn} onClick={begin} disabled={pending}>{t("Activează autentificarea în doi pași")}</button>
      )}

      {!recovery && !enabled && setup && (
        <div className="space-y-3">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
            <li>{t("Instalează o aplicație de autentificare pe telefon (Google Authenticator, Microsoft Authenticator, Authy sau similară).")}</li>
            <li>{t("Scanează codul QR (sau scrie manual cheia de mai jos).")}</li>
            <li>{t("Scrie parola contului și codul de 6 cifre arătat de aplicație.")}</li>
          </ol>
          <div className="flex flex-wrap items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt={t("Cod QR pentru aplicația de autentificare")} width={176} height={176} className="rounded-lg border border-[var(--color-line)] bg-white p-1" />
            <div className="min-w-0 text-sm">
              <p className="text-xs text-ink-soft">{t("Cheie pentru introducere manuală")}</p>
              <p className="select-all break-all font-mono text-base font-semibold tracking-wider">{setup.secret}</p>
            </div>
          </div>
          <CredFields password={password} setPassword={setPassword} code={code} setCode={setCode} />
          {error && <p className="text-sm text-st-cancelled">{t(error)}</p>}
          <div className="flex gap-2">
            <button type="button" className={btn} onClick={confirm} disabled={pending || !password || code.replace(/\s/g, "").length < 6}>{t("Confirmă și activează")}</button>
            <button type="button" className={btnGhost} onClick={cancel} disabled={pending}>{t("Renunță")}</button>
          </div>
        </div>
      )}

      {!recovery && enabled && mode === "idle" && (
        <div className="space-y-3">
          <p className="text-sm">
            {t("Coduri de recuperare rămase")}: <b className={recoveryLeft <= 2 ? "text-st-cancelled" : ""}>{recoveryLeft}</b>
            <span className="text-ink-soft"> — {t("se folosesc dacă pierzi telefonul; fiecare merge o singură dată.")}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnGhost} onClick={() => { reset(); setMode("regen"); }}>{t("Generează coduri noi de recuperare")}</button>
            <button type="button" className={`${btnGhost} text-st-cancelled`} onClick={() => { reset(); setMode("disable"); }}>{t("Oprește autentificarea în doi pași")}</button>
          </div>
        </div>
      )}

      {!recovery && enabled && mode !== "idle" && (
        <div className="space-y-3">
          <p className="text-sm text-ink-soft">
            {mode === "disable" ? t("Pentru a opri protecția, confirmă cu parola și cu un cod din aplicație.") : t("Codurile vechi de recuperare nu vor mai fi valabile. Confirmă cu parola și cu un cod din aplicație.")}
          </p>
          <CredFields password={password} setPassword={setPassword} code={code} setCode={setCode} />
          {error && <p className="text-sm text-st-cancelled">{t(error)}</p>}
          <div className="flex gap-2">
            <button type="button" className={mode === "disable" ? `${btn} !bg-st-cancelled` : btn} onClick={mode === "disable" ? off : regen} disabled={pending || !password || code.replace(/\s/g, "").length < 6}>
              {mode === "disable" ? t("Oprește") : t("Generează")}
            </button>
            <button type="button" className={btnGhost} onClick={() => { setMode("idle"); reset(); }} disabled={pending}>{t("Renunță")}</button>
          </div>
        </div>
      )}

      {!recovery && !setup && mode === "idle" && error && <p className="text-sm text-st-cancelled">{t(error)}</p>}
    </section>
  );
}

function CredFields({ password, setPassword, code, setCode }: { password: string; setPassword: (v: string) => void; code: string; setCode: (v: string) => void }) {
  const t = useT();
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t("Parola contului")} aria-label={t("Parola contului")} className={input} />
      <input inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" aria-label={t("Cod de autentificare")} className={`${input} text-center tracking-[0.3em]`} />
    </div>
  );
}

/** Codurile de recuperare se arată o singură dată; cine le închide fără să le salveze trebuie să genereze altele. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const text = codes.join("\n");
  function download() {
    const url = URL.createObjectURL(new Blob([`${t("Coduri de recuperare")}\n\n${text}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "coduri-recuperare.txt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  return (
    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
      <p className="text-sm font-semibold">{t("Salvează aceste coduri de recuperare acum")}</p>
      <p className="text-sm text-ink-soft">{t("Se arată o singură dată. Dacă pierzi telefonul, fiecare cod te lasă să intri o dată în loc de codul din aplicație. Păstrează-le într-un loc sigur (nu în același telefon).")}</p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-base font-semibold tracking-wider" data-recovery="">
        {codes.map((c) => <li key={c} className="select-all">{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnGhost} onClick={() => { void navigator.clipboard?.writeText(text).then(() => toast.success(t("Copiat.")), () => {}); }}>{t("Copiază")}</button>
        <button type="button" className={btnGhost} onClick={download}>{t("Descarcă .txt")}</button>
        <button type="button" className={btn} onClick={onDone}>{t("Le-am salvat")}</button>
      </div>
    </div>
  );
}

function SessionsCard({ sessions, locale }: { sessions: SessionRow[]; locale: string }) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const fmt = new Intl.DateTimeFormat(locale === "ru" ? "ru-RU" : locale === "en" ? "en-GB" : "ro-RO", { dateStyle: "medium", timeStyle: "short" });
  const others = sessions.filter((s) => !s.current).length;
  return (
    <section className="card space-y-3 p-5">
      <div>
        <h2 className="text-base font-bold">{t("Sesiuni active")}</h2>
        <p className="text-sm text-ink-soft">{t("Dispozitivele pe care contul tău este conectat acum. Dacă vezi ceva ce nu recunoști, deconectează celelalte sesiuni și schimbă parola.")}</p>
      </div>
      <ul className="divide-y divide-[var(--color-line)] text-sm">
        {sessions.map((s) => {
          const a = describeAgent(s.userAgent);
          return (
            <li key={s.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{a ? `${a.browser} · ${a.os}` : t("Dispozitiv necunoscut")}{s.current && <span className="ml-2 rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-bold uppercase text-brand-strong">{t("Aceasta")}</span>}</p>
                <p className="truncate text-xs text-ink-soft">{s.ip ? `IP ${s.ip} · ` : ""}{fmt.format(new Date(s.lastUsedAt))}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {others > 0 && (
        <button
          type="button"
          className={btnGhost}
          disabled={pending}
          onClick={() => start(async () => {
            const r = await signOutOtherSessions();
            if (r.ok) { toast.success(t("Celelalte sesiuni au fost închise.")); router.refresh(); }
            else toast.error(t(r.error));
          })}
        >
          {t("Deconectează toate celelalte sesiuni")}
        </button>
      )}
    </section>
  );
}
