"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { saveAutoNotifyAction, saveIssueMessagesAction } from "@/app/actions/auto-notify";
import type { AutoNotifySettings } from "@/lib/auto-notify";
import { ISSUE_LABELS } from "@/lib/meter-issues";
import { DEFAULT_ISSUE_MESSAGES, MSG_KEYS, MSG_LIMITS, MSG_STAGES, MSG_TOKENS, renderIssueTemplate, sampleVars, smsSegments, type IssueMessages, type MsgKey, type MsgStage } from "@/lib/issue-messages";
import { stripLatinDiacritics } from "@/lib/payer-notify";
import { useT } from "@/lib/i18n/context";
import { useToast } from "./toast";
import { IconX } from "./icons";

const fld = "w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

/**
 * „Mesaje automate”: textele (SMS, subiect și email) pe care clientul le primește automat înainte de termenul de remediere și când termenul a trecut, pe fiecare tip de neregulă.
 * Se văd exact cum ajung (cu date de exemplu), se pot modifica și readuce la textul implicit. Sus se alege dacă se trimit automat și pe ce canal (SMS costă bani).
 */
export default function IssueMessagesDialog({
  initial,
  autoNotify,
  canEdit,
  isSuper,
  emailEnabled,
  smsEnabled,
  onClose,
}: {
  initial: IssueMessages;
  autoNotify: AutoNotifySettings;
  canEdit: boolean;
  isSuper: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [msgs, setMsgs] = useState<IssueMessages>(initial);
  const [saved, setSaved] = useState<IssueMessages>(initial);
  const [auto, setAuto] = useState(autoNotify.issue);
  const [key, setKey] = useState<MsgKey>("SEAL");
  const [stage, setStage] = useState<MsgStage>("before");
  const [pending, start] = useTransition();
  const smsRef = useRef<HTMLTextAreaElement>(null);
  const subjRef = useRef<HTMLInputElement>(null);
  const mailRef = useRef<HTMLTextAreaElement>(null);
  const focused = useRef<"sms" | "subject" | "email">("sms");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cur = msgs[key][stage];
  const def = DEFAULT_ISSUE_MESSAGES[key][stage];
  const vars = useMemo(() => sampleVars(key, stage), [key, stage]);
  const smsText = stripLatinDiacritics(renderIssueTemplate(cur.sms, vars));
  const changed = (k: MsgKey) => MSG_STAGES.some((st) => (["sms", "subject", "email"] as const).some((f) => msgs[k][st][f] !== DEFAULT_ISSUE_MESSAGES[k][st][f]));
  const dirty = JSON.stringify(msgs) !== JSON.stringify(saved) || JSON.stringify(auto) !== JSON.stringify(autoNotify.issue);
  const label = (k: MsgKey) => (k === "MULTI" ? t("Mai multe nereguli (mesaj comun)") : t(ISSUE_LABELS[k]));
  const tokens = MSG_TOKENS.filter((x) => (key === "MULTI" ? !x.singleOnly : !x.multiOnly));

  const setField = (f: "sms" | "subject" | "email", v: string) => setMsgs((m) => ({ ...m, [key]: { ...m[key], [stage]: { ...m[key][stage], [f]: v } } }));

  function insertToken(tok: string) {
    const f = focused.current;
    const el = f === "sms" ? smsRef.current : f === "subject" ? subjRef.current : mailRef.current;
    if (!el) return;
    const a = el.selectionStart ?? el.value.length;
    const b = el.selectionEnd ?? a;
    const v = `${el.value.slice(0, a)}{${tok}}${el.value.slice(b)}`;
    setField(f, v);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tok.length + 2, a + tok.length + 2); });
  }

  function save() {
    start(async () => {
      const r1 = await saveAutoNotifyAction({ ...autoNotify, issue: auto });
      if (r1.error) return toast.error(t(r1.error));
      const r2 = await saveIssueMessagesAction(msgs);
      if (r2.error) return toast.error(t(r2.error));
      setSaved(msgs);
      toast.success(t("Mesajele automate au fost salvate."));
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={t("Mesaje automate")} className="card flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-b-none rounded-t-2xl sm:rounded-2xl" data-issue-messages="">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-line)] p-4">
          <div className="min-w-0">
            <h2 className="text-base font-bold">{t("Mesaje automate către clienți")}</h2>
            <p className="mt-0.5 text-xs text-ink-soft">{t("Se trimit clientului când răspunde el de neregulă: cu 3 zile înainte de termen și când termenul a trecut. Alege tipul și etapa, apoi modifică textul.")}</p>
          </div>
          <button type="button" onClick={onClose} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}><IconX className="size-4" /></button>
        </div>

        {/* canale */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-[var(--color-line)] bg-[var(--color-surface-2)]/50 px-4 py-2 text-sm" data-channels="">
          <label className="flex items-center gap-1.5 font-semibold">
            <input type="checkbox" name="auto-enabled" checked={auto.enabled} disabled={!canEdit} onChange={(e) => setAuto((a) => ({ ...a, enabled: e.target.checked }))} className="size-4 rounded accent-brand" />
            {t("Trimite automat")}
          </label>
          <label className={`flex items-center gap-1.5 ${auto.enabled ? "" : "opacity-50"}`}>
            <input type="checkbox" name="auto-email" checked={auto.email} disabled={!canEdit || !auto.enabled} onChange={(e) => setAuto((a) => ({ ...a, email: e.target.checked }))} className="size-4 rounded accent-brand" />
            {t("Email")} <span className="text-xs text-ink-soft">({t("gratuit")})</span>
          </label>
          <label className={`flex items-center gap-1.5 ${auto.enabled ? "" : "opacity-50"}`}>
            <input type="checkbox" name="auto-sms" checked={auto.sms} disabled={!canEdit || !auto.enabled} onChange={(e) => setAuto((a) => ({ ...a, sms: e.target.checked }))} className="size-4 rounded accent-brand" />
            {t("SMS")} <span className="text-xs text-ink-soft">({t("costă bani")})</span>
          </label>
          {auto.enabled && !auto.email && !auto.sms && <span className="text-xs text-st-progress">⚠ {t("Niciun canal bifat: clientul nu primește nimic, personalul vede „de contactat personal”.")}</span>}
          {!smsEnabled && auto.sms && <span className="text-xs text-st-progress">⚠ {t("SMS-ul nu este configurat pe server.")}</span>}
          {!emailEnabled && auto.email && <span className="text-xs text-st-progress">⚠ {t("Emailul nu este configurat pe server (SMTP).")}</span>}
          {canEdit && <Link href="/settings?tab=workflow" className="ml-auto text-xs font-semibold text-brand hover:underline">{t("Contract și verificare metrologică → Setări")}</Link>}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[14rem_1fr]">
          {/* tipuri */}
          <nav className="max-h-40 overflow-auto border-b border-[var(--color-line)] p-2 md:max-h-none md:border-b-0 md:border-r" aria-label={t("Tipul neregulii")}>
            {MSG_KEYS.map((k) => (
              <button key={k} type="button" onClick={() => setKey(k)} data-msg-key={k} className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm ${k === key ? "bg-brand/10 font-semibold text-brand" : "hover:bg-[var(--color-surface-2)]"}`}>
                <span className="truncate">{label(k)}</span>
                {changed(k) && <span className="size-1.5 shrink-0 rounded-full bg-brand" title={t("Modificat față de textul implicit")} />}
              </button>
            ))}
          </nav>

          <div className="min-h-0 overflow-auto p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div role="tablist" className="inline-flex rounded-xl border border-[var(--color-line)] p-0.5 text-sm">
                {MSG_STAGES.map((st) => (
                  <button key={st} type="button" role="tab" aria-selected={st === stage} onClick={() => setStage(st)} data-msg-stage={st} className={`cursor-pointer rounded-lg px-3 py-1 ${st === stage ? "bg-brand text-white" : "text-ink-soft hover:bg-[var(--color-surface-2)]"}`}>
                    {st === "before" ? t("Înainte de termen") : t("Termen depășit")}
                  </button>
                ))}
              </div>
              <span className="text-sm font-semibold">{label(key)}</span>
              {canEdit && (cur.sms !== def.sms || cur.subject !== def.subject || cur.email !== def.email) && (
                <button type="button" onClick={() => setMsgs((m) => ({ ...m, [key]: { ...m[key], [stage]: { ...def } } }))} className="tap ml-auto h-7 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-xs hover:bg-[var(--color-surface-2)]" data-reset="">{t("Revino la textul implicit")}</button>
              )}
            </div>

            {canEdit && (
              <div className="mb-3 flex flex-wrap items-center gap-1" data-tokens="">
                <span className="text-xs text-ink-soft">{t("Inserează:")}</span>
                {tokens.map((x) => (
                  <button key={x.key} type="button" onClick={() => insertToken(x.key)} title={t(x.label)} className="tap h-6 cursor-pointer rounded-md border border-[var(--color-line)] px-1.5 font-mono text-[11px] hover:bg-brand-soft">{`{${x.key}}`}</button>
                ))}
              </div>
            )}

            {/* SMS */}
            <label className="mb-1 block text-xs font-semibold text-ink-soft" htmlFor="im-sms">{t("SMS")}</label>
            <textarea id="im-sms" name="sms" ref={smsRef} value={cur.sms} rows={3} maxLength={MSG_LIMITS.sms} disabled={!canEdit} onFocus={() => (focused.current = "sms")} onChange={(e) => setField("sms", e.target.value)} className={`${fld} py-2`} />
            <div className="mt-1 rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface-2)]/40 px-3 py-2 text-sm" data-sms-preview="">
              <p className="whitespace-pre-wrap break-words">{smsText || "—"}</p>
              <p className="mt-1 text-[11px] text-ink-soft">{t("Așa ajunge la client (fără diacritice, cu date de exemplu).")} · {smsText.length} {t("caractere")} · {smsSegments(smsText.length)} {t("SMS")}</p>
            </div>

            {/* email */}
            <label className="mb-1 mt-4 block text-xs font-semibold text-ink-soft" htmlFor="im-subj">{t("Email: subiect")}</label>
            <input id="im-subj" name="subject" ref={subjRef} value={cur.subject} maxLength={MSG_LIMITS.subject} disabled={!canEdit} onFocus={() => (focused.current = "subject")} onChange={(e) => setField("subject", e.target.value)} className={`${fld} h-10`} />
            <label className="mb-1 mt-3 block text-xs font-semibold text-ink-soft" htmlFor="im-mail">{t("Email: mesaj")}</label>
            <textarea id="im-mail" name="email" ref={mailRef} value={cur.email} rows={9} maxLength={MSG_LIMITS.email} disabled={!canEdit} onFocus={() => (focused.current = "email")} onChange={(e) => setField("email", e.target.value)} className={`${fld} py-2 font-mono text-[13px]`} />
            <details className="mt-1 rounded-lg border border-dashed border-[var(--color-line)] bg-[var(--color-surface-2)]/40 px-3 py-2 text-sm" data-mail-preview="">
              <summary className="cursor-pointer text-xs font-semibold text-brand">{t("Previzualizare email")}</summary>
              <p className="mt-1 font-semibold">{renderIssueTemplate(cur.subject, vars)}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-[13px]">{renderIssueTemplate(cur.email, vars)}</p>
            </details>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-line)] p-3">
          <span className="text-xs text-ink-soft">
            {isSuper && <Link href="/admin/jurnal-notificari" className="font-semibold text-brand hover:underline">{t("Mesajele trimise → Jurnalul de notificări")}</Link>}
            {!canEdit && t("Doar administratorii pot modifica mesajele.")}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="tap h-10 cursor-pointer rounded-xl border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)]">{canEdit ? t("Anulează") : t("Închide")}</button>
            {canEdit && <button type="button" onClick={save} disabled={pending || !dirty} className="tap h-10 cursor-pointer rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50" data-save="">{pending ? t("Se salvează…") : t("Salvează")}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
