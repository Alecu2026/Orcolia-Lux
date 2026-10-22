"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  sendPayerNotificationsChunkAction,
  sendTestNotificationAction,
  type RecipientResult,
} from "@/app/actions/payer-notifications";
import {
  DEFAULT_VOICE,
  NOTIFY_CHUNK_SIZE,
  NOTIFY_MAX_CALL_BODY,
  NOTIFY_MAX_EMAIL_BODY,
  NOTIFY_MAX_SMS_BODY,
  NOTIFY_MAX_SUBJECT,
  NOTIFY_PRESETS,
  NOTIFY_TOKENS,
  renderTemplate,
  type PayerTemplate,
  type PayerTemplateDraft,
  smsInfo,
  stripLatinDiacritics,
  type NotifyVars,
} from "@/lib/payer-notify";
import Link from "next/link";
import { useToast } from "./toast";
import { IconX } from "./icons";
import VoicePicker from "./VoicePicker";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";

export type Recipient = { id: string; flags: number };

type Phase = "compose" | "confirm" | "sending" | "done";
type Channel = { sent: number; failed: number; skipped: number };
type Failure = { id: string; name: string; channel: "Email" | "SMS" | "Apel"; detail: string };
type Field = "subject" | "email" | "sms" | "call";
type Draft = { subject: string; email: string; sms: string; ascii: boolean; call?: string; voice?: string };

const DRAFT_KEY = "payer-notify-draft";
const TEST_PHONE_KEY = "payer-notify-test-phone";

const inputCls =
  "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

function readTestPhone(): string {
  try {
    return localStorage.getItem(TEST_PHONE_KEY) ?? "";
  } catch {
    return "";
  }
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function PayerNotifyDialog({
  recipients,
  previewName,
  previewVars,
  emailEnabled,
  smsEnabled,
  callEnabled,
  userEmail,
  templates,
  onSaveTemplate,
  onClose,
  onSent,
  onSelectFailed,
}: {
  recipients: Recipient[];
  previewName: string;
  previewVars: NotifyVars;
  emailEnabled: boolean;
  smsEnabled: boolean;
  callEnabled: boolean;
  userEmail: string;
  templates: PayerTemplate[];
  /** Salvează textul curent ca șablon nou (optimist, în pagină). */
  onSaveTemplate: (draft: PayerTemplateDraft) => void;
  onClose: () => void;
  /** Apelat după fiecare lot trimis — pagina actualizează „Ultima notificare" imediat (optimist). */
  onSent: (results: RecipientResult[]) => void;
  /** „Selectează doar cei eșuați" — pentru o retrimitere țintită. */
  onSelectFailed: (ids: string[]) => void;
}) {
  const toast = useToast();
  const tr = useT();
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag);
  const emailCount = useMemo(() => recipients.filter((r) => r.flags & 1).length, [recipients]);
  const smsCount = useMemo(() => recipients.filter((r) => r.flags & 2).length, [recipients]);
  const canEmail = emailEnabled && emailCount > 0;
  const canSms = smsEnabled && smsCount > 0;
  // Apelul are nevoie de un telefon valid, la fel ca SMS-ul.
  const canCall = callEnabled && smsCount > 0;

  const [phase, setPhase] = useState<Phase>("compose");
  const [useEmail, setUseEmail] = useState(canEmail);
  const [useSms, setUseSms] = useState(canSms && !canEmail);
  const [useCall, setUseCall] = useState(false);
  // Fereastra se montează doar după un click (nu la SSR), deci putem citi ciorna direct la inițializare.
  const [saved] = useState(readDraft);
  const [subject, setSubject] = useState(saved?.subject ?? "");
  const [emailBody, setEmailBody] = useState(saved?.email ?? "");
  const [smsBody, setSmsBody] = useState(saved?.sms ?? "");
  const [ascii, setAscii] = useState(saved?.ascii !== false);
  const [callBody, setCallBody] = useState(saved?.call ?? "");
  const [voice, setVoice] = useState(saved?.voice || DEFAULT_VOICE);

  const [testPhone, setTestPhone] = useState(readTestPhone);
  const [testing, setTesting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [savingTpl, setSavingTpl] = useState(false);
  const [tplName, setTplName] = useState("");

  const [processed, setProcessed] = useState(0);
  const [emailStats, setEmailStats] = useState<Channel>({ sent: 0, failed: 0, skipped: 0 });
  const [smsStats, setSmsStats] = useState<Channel>({ sent: 0, failed: 0, skipped: 0 });
  const [callStats, setCallStats] = useState<Channel>({ sent: 0, failed: 0, skipped: 0 });
  const [failures, setFailures] = useState<Failure[]>([]);
  const [runError, setRunError] = useState<string | null>(null);
  const [resumeAt, setResumeAt] = useState<number | null>(null);
  const [stopped, setStopped] = useState(false);

  const stopRef = useRef(false);
  const campaignRef = useRef("");
  const lastField = useRef<Field>("email");
  const subjectRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLTextAreaElement>(null);
  const smsRef = useRef<HTMLTextAreaElement>(null);
  const callRef = useRef<HTMLTextAreaElement>(null);

  // Ciorna (subiect/mesaje) și numărul de test se păstrează între sesiuni — operatorul retrimite des același text.
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ subject, email: emailBody, sms: smsBody, ascii, call: callBody, voice }));
    } catch {}
  }, [subject, emailBody, smsBody, ascii, callBody, voice]);

  const sending = phase === "sending";
  useEffect(() => {
    if (!sending) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sending]);

  const renderedSms = useMemo(() => {
    const r = renderTemplate(smsBody, previewVars);
    return ascii ? stripLatinDiacritics(r) : r;
  }, [smsBody, previewVars, ascii]);
  const sms = smsInfo(renderedSms);
  // Textul apelului cu datele plătitorului de exemplu — acesta se ascultă la „Ascultă".
  const renderedCall = useMemo(() => renderTemplate(callBody, previewVars), [callBody, previewVars]);

  function applyPreset(p: { subject: string; email: string; sms: string; call: string; voice?: string }) {
    setSubject(p.subject);
    setEmailBody(p.email);
    setSmsBody(p.sms);
    setCallBody(p.call);
    if (p.voice) setVoice(p.voice);
    // șablonul are mesaj de apel → pornește canalul (dacă e disponibil), ca operatorul să-l vadă imediat
    if (p.call.trim() && canCall) setUseCall(true);
  }

  function saveAsTemplate() {
    const name = tplName.trim();
    if (!name) return;
    if (!emailBody.trim() && !smsBody.trim() && !callBody.trim()) { setFormError(tr("Scrie întâi un mesaj pe care să-l salvezi.")); return; }
    onSaveTemplate({ name, subject, email: emailBody, sms: smsBody, call: callBody, voice });
    setSavingTpl(false);
    setTplName("");
    setFormError(null);
    toast.success(tr("Șablon salvat."));
  }

  function insertToken(token: string) {
    const text = `{${token}}`;
    const field = lastField.current;
    const el = field === "subject" ? subjectRef.current : field === "sms" ? smsRef.current : field === "call" ? callRef.current : emailRef.current;
    const set = field === "subject" ? setSubject : field === "sms" ? setSmsBody : field === "call" ? setCallBody : setEmailBody;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    set(el.value.slice(0, start) + text + el.value.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + text.length, start + text.length);
    });
  }

  function validate(): string | null {
    if (!useEmail && !useSms && !useCall) return tr("Alege cel puțin un canal (email, SMS sau apel).");
    if (useCall && !callBody.trim()) return tr("Scrie mesajul apelului.");
    if (useEmail) {
      if (!subject.trim()) return tr("Scrie subiectul emailului.");
      if (!emailBody.trim()) return tr("Scrie mesajul emailului.");
    }
    if (useSms && !smsBody.trim()) return tr("Scrie mesajul SMS.");
    return null;
  }

  const payload = () => ({
    email: { enabled: useEmail, subject, body: emailBody },
    sms: { enabled: useSms, body: smsBody, ascii },
    call: { enabled: useCall, body: callBody, voice },
  });

  async function sendTest() {
    const err = validate();
    if (err) { setFormError(err); return; }
    setFormError(null);
    setTesting(true);
    try {
      localStorage.setItem(TEST_PHONE_KEY, testPhone);
    } catch {}
    try {
      const res = await sendTestNotificationAction({ ...payload(), testPhone });
      if (res.ok) toast.success(res.message);
      else toast.error(res.error);
    } catch {
      toast.error(tr("Nu am putut trimite testul. Încearcă din nou."));
    } finally {
      setTesting(false);
    }
  }

  function goConfirm() {
    const err = validate();
    setFormError(err);
    if (!err) setPhase("confirm");
  }

  function tally(results: RecipientResult[]) {
    const add = (prev: Channel, key: "email" | "sms" | "call") => {
      const next = { ...prev };
      for (const r of results) next[r[key].status]++;
      return next;
    };
    setEmailStats((p) => add(p, "email"));
    setSmsStats((p) => add(p, "sms"));
    setCallStats((p) => add(p, "call"));
    const bad: Failure[] = [];
    for (const r of results) {
      if (r.email.status === "failed") bad.push({ id: r.id, name: r.name, channel: "Email", detail: r.email.detail ?? "" });
      if (r.sms.status === "failed") bad.push({ id: r.id, name: r.name, channel: "SMS", detail: r.sms.detail ?? "" });
      if (r.call.status === "failed") bad.push({ id: r.id, name: r.name, channel: "Apel", detail: r.call.detail ?? "" });
    }
    if (bad.length) setFailures((p) => [...p, ...bad].slice(0, 500));
  }

  async function run(startAt: number) {
    if (!campaignRef.current) {
      campaignRef.current = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    }
    stopRef.current = false;
    setStopped(false);
    setRunError(null);
    setResumeAt(null);
    setPhase("sending");

    const ids = recipients.map((r) => r.id);
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += NOTIFY_CHUNK_SIZE) chunks.push(ids.slice(i, i + NOTIFY_CHUNK_SIZE));

    for (let i = startAt; i < chunks.length; i++) {
      if (stopRef.current) {
        setStopped(true);
        setResumeAt(i);
        setPhase("done");
        return;
      }
      try {
        const res = await sendPayerNotificationsChunkAction({
          campaignId: campaignRef.current,
          index: i,
          totalPlanned: ids.length,
          ids: chunks[i],
          ...payload(),
        });
        if (!res.ok) {
          setRunError(res.error);
          setResumeAt(i);
          setPhase("done");
          return;
        }
        tally(res.results);
        onSent(res.results);
        setProcessed(Math.min(ids.length, (i + 1) * NOTIFY_CHUNK_SIZE));
      } catch {
        // Fără reîncercare automată: lotul poate fi deja plecat. „Reia" retrimite același lot cu aceeași
        // campanie, iar serverul omite destinatarii deja marcați ca trimiși în ea.
        setRunError(tr("Conexiune întreruptă în timpul trimiterii. Verifică conexiunea și apasă „Reia”."));
        setResumeAt(i);
        setPhase("done");
        return;
      }
    }
    setPhase("done");
  }

  const total = recipients.length;
  const pct = total ? Math.round((processed / total) * 100) : 0;
  const failedIds = [...new Set(failures.map((f) => f.id))];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onMouseDown={(e) => e.target === e.currentTarget && !sending && onClose()}
    >
      <div className="card max-h-[94dvh] w-full max-w-3xl overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">{tr("Trimite notificare")}</h2>
            <p className="text-xs text-ink-soft">
              {nf(total)} {total === 1 ? tr("destinatar") : tr("destinatari")} · {tr("{n} cu email valid", { n: nf(emailCount) })} · {tr("{n} cu telefon valid", { n: nf(smsCount) })}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className="tap grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40"
            aria-label={tr("Închide")}
          >
            <IconX className="size-4" />
          </button>
        </div>

        {phase === "compose" && (
          <div className="flex flex-col gap-4">
            {/* Canale */}
            <div className="flex flex-wrap gap-2">
              <ChannelToggle
                label="Email"
                icon="✉"
                checked={useEmail}
                disabled={!canEmail}
                hint={!emailEnabled ? tr("SMTP neconfigurat") : emailCount === 0 ? tr("nimeni nu are email") : `${nf(emailCount)} ${tr("destinatari")}`}
                onChange={setUseEmail}
              />
              <ChannelToggle
                label="SMS"
                icon="💬"
                checked={useSms}
                disabled={!canSms}
                hint={!smsEnabled ? tr("SMS neconfigurat") : smsCount === 0 ? tr("nimeni nu are telefon") : `${nf(smsCount)} ${tr("destinatari")}`}
                onChange={setUseSms}
              />
              <ChannelToggle
                label={tr("Apel")}
                icon="📞"
                checked={useCall}
                disabled={!canCall}
                hint={!callEnabled ? tr("Apel neconfigurat") : smsCount === 0 ? tr("nimeni nu are telefon") : `${nf(smsCount)} ${tr("destinatari")}`}
                onChange={setUseCall}
              />
            </div>

            {/* Șabloane */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-ink-soft">{tr("Șablon:")}</span>
              {templates.map((t) => (
                <button key={t.id} type="button" onClick={() => applyPreset(t)} className="tap h-7 rounded-full border border-brand/40 bg-brand/5 px-3 text-xs text-brand hover:bg-brand-soft">
                  {t.name}
                </button>
              ))}
              {NOTIFY_PRESETS.map((p) => (
                <button key={p.key} type="button" onClick={() => applyPreset(p)} className="tap h-7 rounded-full border border-[var(--color-line)] px-3 text-xs hover:border-brand hover:bg-brand-soft">
                  {tr(p.label)}
                </button>
              ))}
              {savingTpl ? (
                <span className="flex items-center gap-1">
                  <input
                    value={tplName}
                    onChange={(e) => setTplName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); saveAsTemplate(); } if (e.key === "Escape") setSavingTpl(false); }}
                    placeholder={tr("Nume șablon")}
                    maxLength={60}
                    autoFocus
                    className="h-7 w-32 rounded-lg border border-brand bg-[var(--color-surface)] px-2 text-xs outline-none"
                  />
                  <button type="button" onClick={saveAsTemplate} disabled={!tplName.trim()} className="tap h-7 rounded-lg bg-brand px-2.5 text-xs font-semibold text-white disabled:opacity-40">OK</button>
                </span>
              ) : (
                <button type="button" onClick={() => setSavingTpl(true)} className="tap ml-auto h-7 rounded-full px-2 text-xs text-ink-soft underline hover:text-brand">
                  + {tr("Salvează ca șablon")}
                </button>
              )}
            </div>

            {/* Variabile */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-ink-soft">{tr("Inserează:")}</span>
              {NOTIFY_TOKENS.map((t) => (
                <button key={t.key} type="button" onClick={() => insertToken(t.key)} title={tr(t.label)} className="tap h-7 rounded-md bg-[var(--color-surface-2)] px-2 font-mono text-[11px] hover:bg-brand-soft">
                  {`{${t.key}}`}
                </button>
              ))}
            </div>

            {useEmail && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-ink-soft">{tr("Email — subiect")}</label>
                <input
                  ref={subjectRef}
                  value={subject}
                  maxLength={NOTIFY_MAX_SUBJECT}
                  onFocus={() => (lastField.current = "subject")}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder={tr("Subiectul emailului")}
                  className={`${inputCls} h-11`}
                />
                <label className="text-xs font-semibold text-ink-soft">{tr("Email — mesaj")}</label>
                <textarea
                  ref={emailRef}
                  value={emailBody}
                  maxLength={NOTIFY_MAX_EMAIL_BODY}
                  onFocus={() => (lastField.current = "email")}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={6}
                  placeholder={tr("Scrie mesajul… folosește {nume}, {suma} etc.", { nume: "{nume}", suma: "{suma}" })}
                  className={`${inputCls} py-2.5`}
                />
              </div>
            )}

            {useSms && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-ink-soft">{tr("SMS — mesaj")}</label>
                <textarea
                  ref={smsRef}
                  value={smsBody}
                  maxLength={NOTIFY_MAX_SMS_BODY}
                  onFocus={() => (lastField.current = "sms")}
                  onChange={(e) => setSmsBody(e.target.value)}
                  rows={3}
                  placeholder={tr("Mesaj scurt… folosește {nume}, {suma} etc.", { nume: "{nume}", suma: "{suma}" })}
                  className={`${inputCls} py-2.5`}
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-soft">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={ascii} onChange={(e) => setAscii(e.target.checked)} className="size-4 accent-brand" />
                    {tr("Fără diacritice (încap mai multe caractere într-un SMS)")}
                  </label>
                  <span className={sms.segments > 1 ? "font-semibold text-st-progress" : ""}>
                    {sms.length} {tr("caractere")} · {sms.segments} {sms.segments === 1 ? "SMS" : tr("SMS-uri")}{sms.unicode ? ` (${tr("Unicode: 70/SMS")})` : ""}
                  </span>
                </div>
              </div>
            )}

            {useCall && (
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-ink-soft">{tr("Apel — mesajul pe care îl spune robotul")}</label>
                <textarea
                  ref={callRef}
                  value={callBody}
                  maxLength={NOTIFY_MAX_CALL_BODY}
                  onFocus={() => (lastField.current = "call")}
                  onChange={(e) => setCallBody(e.target.value)}
                  rows={4}
                  placeholder={tr("Ce spune vocea… ex. Bună ziua, {nume}. Aveți de achitat {suma}…", { nume: "{nume}", suma: "{suma}" })}
                  className={`${inputCls} py-2.5`}
                />
                <VoicePicker voice={voice} text={renderedCall} onChange={setVoice} />

              </div>
            )}

            {/* Previzualizare */}
            {(useEmail || useSms) && (
              <div className="rounded-xl border border-dashed border-[var(--color-line)] p-3">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{tr("Previzualizare")} · {previewName}</p>
                {useEmail && (
                  <div className="mb-2 rounded-lg bg-[var(--color-surface-2)] p-3 text-sm">
                    <p className="font-semibold">{renderTemplate(subject, previewVars) || <span className="text-ink-soft">{tr("(fără subiect)")}</span>}</p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px]">{renderTemplate(emailBody, previewVars) || <span className="text-ink-soft">{tr("(mesaj gol)")}</span>}</p>
                  </div>
                )}
                {useSms && (
                  <div className="ml-auto w-fit max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-[13px] text-white">
                    {renderedSms || tr("(mesaj gol)")}
                  </div>
                )}
              </div>
            )}

            {/* Test */}
            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-[var(--color-surface-2)] p-3 text-xs">
              <span className="font-semibold">{tr("Test înainte de trimitere:")}</span>
              {useEmail && <span className="text-ink-soft">{tr("email la")} {userEmail}</span>}
              {(useSms || useCall) && (
                <input
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  inputMode="tel"
                  placeholder={tr("Telefon test (069…)")}
                  className="h-8 w-40 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-xs outline-none focus:border-brand"
                />
              )}
              <button
                type="button"
                onClick={sendTest}
                disabled={testing || (!useEmail && !useSms && !useCall)}
                className="tap ml-auto h-8 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 font-medium hover:bg-brand-soft disabled:opacity-50"
              >
                {testing ? tr("Se trimite…") : tr("Trimite test")}
              </button>
            </div>

            {formError && <p className="text-sm text-st-cancelled">{formError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="tap h-11 rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]">
                {tr("Anulează")}
              </button>
              <button type="button" onClick={goConfirm} className="tap h-11 rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong">
                {tr("Continuă")}
              </button>
            </div>
          </div>
        )}

        {phase === "confirm" && (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-st-progress/30 bg-st-progress/10 p-4 text-sm">
              <p className="font-semibold">{tr("Confirmă trimiterea")}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {useEmail && (
                  <li>
                    <b>{nf(emailCount)}</b> {tr("emailuri")}
                    {total - emailCount > 0 && <span className="text-ink-soft"> ({tr("{n} fără email valid vor fi omiși", { n: nf(total - emailCount) })})</span>}
                  </li>
                )}
                {useSms && (
                  <li>
                    <b>{nf(smsCount)}</b> {tr("SMS-uri")} × {sms.segments || 1} {sms.segments > 1 ? tr("segmente") : tr("segment")}
                    {total - smsCount > 0 && <span className="text-ink-soft"> ({tr("{n} fără telefon valid vor fi omiși", { n: nf(total - smsCount) })})</span>}
                  </li>
                )}
                {useCall && (
                  <li>
                    {tr("{n} apeluri trimise acum la gateway-ul de apeluri (robotul sună plătitorul și spune mesajul). Gateway-ul confirmă doar primirea cererii, nu și că apelul a avut loc.", { n: nf(smsCount) })}
                    {total - smsCount > 0 && <span className="text-ink-soft"> ({tr("{n} fără telefon valid vor fi omiși", { n: nf(total - smsCount) })})</span>}
                  </li>
                )}
              </ul>
              <p className="mt-2 text-xs text-ink-soft">{tr("Mesajele trimise nu pot fi retrase. SMS-urile se taxează de furnizor.")}</p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setPhase("compose")} className="tap h-11 rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]">
                {tr("Înapoi")}
              </button>
              <button type="button" onClick={() => run(0)} className="tap h-11 rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong">
                {tr("Da, trimite acum")}
              </button>
            </div>
          </div>
        )}

        {(phase === "sending" || phase === "done") && (
          <div className="flex flex-col gap-4">
            <div>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="font-semibold">
                  {sending ? tr("Se trimite…") : runError ? tr("Trimitere întreruptă") : stopped ? tr("Oprit") : tr("Gata")}
                </span>
                <span className="tabular-nums text-ink-soft">{nf(processed)} / {nf(total)} ({pct}%)</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div className="h-full rounded-full bg-brand transition-all duration-300" style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {useEmail && <StatCard title="✉ Email" s={emailStats} />}
              {useSms && <StatCard title="💬 SMS" s={smsStats} />}
              {useCall && <StatCard title={`📞 ${tr("Apel")}`} s={callStats} sentLabel={tr("Trimise la gateway")} />}
            </div>

            {useCall && !sending && (callStats.sent > 0 || callStats.failed > 0) && (
              <div className="rounded-xl border border-[var(--color-line)] p-3 text-sm">
                <p className="font-semibold">📞 {tr("{n} apeluri trimise la gateway", { n: nf(callStats.sent) })}{callStats.failed > 0 ? ` · ${tr("{n} respinse", { n: nf(callStats.failed) })}` : ""}</p>
                <p className="mt-1 text-xs text-ink-soft">
                  {tr("Gateway-ul confirmă doar că a primit cererea. Dacă nu sună nimeni, verifică la cei care îl administrează dacă tokenul și formatul cererii sunt corecte.")}
                  {callStats.failed > 0 ? ` ${tr("Cele respinse rămân în registru și pot fi exportate pentru autoinformarea PBX.")}` : ""}
                </p>
                <Link href="/pbx?tab=notificari" className="tap mt-2 inline-flex h-9 cursor-pointer items-center rounded-lg border border-[var(--color-line)] px-4 text-xs font-semibold hover:bg-brand-soft">{tr("Deschide registrul de apeluri →")}</Link>
              </div>
            )}

            {runError && <p className="rounded-lg bg-st-cancelled/10 px-3 py-2 text-sm text-st-cancelled">{runError}</p>}

            {failures.length > 0 && (
              <details className="rounded-xl border border-[var(--color-line)] p-3 text-sm" open={failures.length <= 8}>
                <summary className="cursor-pointer font-semibold text-st-cancelled">{tr("Eșuate")} ({nf(failures.length)})</summary>
                <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-xs">
                  {failures.map((f, i) => (
                    <li key={i}>
                      <b>{f.name}</b> · {tr(f.channel)} · <span className="text-ink-soft">{f.detail}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              {sending ? (
                <button type="button" onClick={() => (stopRef.current = true)} className="tap h-11 rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium hover:bg-[var(--color-surface-2)]">
                  {tr("Oprește după lotul curent")}
                </button>
              ) : (
                <>
                  {failedIds.length > 0 && (
                    <button type="button" onClick={() => onSelectFailed(failedIds)} className="tap h-11 rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium hover:bg-[var(--color-surface-2)]">
                      {tr("Selectează doar cei eșuați")} ({nf(failedIds.length)})
                    </button>
                  )}
                  {resumeAt !== null && (
                    <button type="button" onClick={() => run(resumeAt)} className="tap h-11 rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong">
                      {tr("Reia")}
                    </button>
                  )}
                  <button type="button" onClick={onClose} className="tap h-11 rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium hover:bg-[var(--color-surface-2)]">
                    {tr("Închide")}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ChannelToggle({
  label, icon, checked, disabled, hint, onChange,
}: {
  label: string;
  icon: string;
  checked: boolean;
  disabled: boolean;
  hint: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`tap flex min-w-36 items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "border-brand bg-brand/10 text-brand" : "border-[var(--color-line)] text-ink-soft"
      }`}
    >
      <span className="text-base">{icon}</span>
      <span>
        <span className="block font-semibold">{label}</span>
        <span className="block text-[11px] font-normal text-ink-soft">{hint}</span>
      </span>
      <span className="ml-auto text-xs">{checked ? "✓" : ""}</span>
    </button>
  );
}

function StatCard({ title, s, sentLabel }: { title: string; s: Channel; sentLabel?: string }) {
  const tr = useT();
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag);
  return (
    <div className="rounded-xl border border-[var(--color-line)] p-3 text-sm">
      <p className="mb-1 font-semibold">{title}</p>
      <p className="flex flex-wrap gap-x-4 text-xs">
        <span className="text-st-done">{sentLabel ?? tr("Trimise")}: <b>{nf(s.sent)}</b></span>
        <span className={s.failed ? "text-st-cancelled" : "text-ink-soft"}>{tr("Eșuate")}: <b>{nf(s.failed)}</b></span>
        <span className="text-ink-soft">{tr("Omise")}: <b>{nf(s.skipped)}</b></span>
      </p>
    </div>
  );
}
