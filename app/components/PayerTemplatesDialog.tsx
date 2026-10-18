"use client";

import { useRef, useState } from "react";
import {
  NOTIFY_MAX_EMAIL_BODY,
  NOTIFY_MAX_SMS_BODY,
  NOTIFY_MAX_SUBJECT,
  NOTIFY_MAX_TEMPLATE_NAME,
  NOTIFY_PRESETS,
  NOTIFY_TOKENS,
  type PayerTemplate,
  type PayerTemplateDraft,
} from "@/lib/payer-notify";
import { IconX } from "./icons";

type Field = "subject" | "email" | "sms";
const inputCls =
  "w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

/**
 * Gestionarea șabloanelor: listă + formular de creare/editare. Totul e optimist — apăsarea pe „Salvează" sau
 * „Șterge" închide formularul/scoate rândul pe loc, iar părintele face apelul către server și anulează schimbarea
 * (cu mesaj) doar dacă eșuează.
 */
export default function PayerTemplatesDialog({
  templates,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: {
  templates: PayerTemplate[];
  onCreate: (draft: PayerTemplateDraft) => void;
  onUpdate: (id: string, draft: PayerTemplateDraft) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  // null = doar lista; "new" = formular gol; altfel formular pentru șablonul editat
  const [editing, setEditing] = useState<PayerTemplate | "new" | null>(null);
  const [seed, setSeed] = useState<PayerTemplateDraft | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function openNew(from?: PayerTemplateDraft) {
    setSeed(from ?? { name: "", subject: "", email: "", sms: "" });
    setEditing("new");
  }
  function openEdit(t: PayerTemplate) {
    setSeed({ name: t.name, subject: t.subject, email: t.email, sms: t.sms });
    setEditing(t);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-2xl overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold">{editing ? (editing === "new" ? "Șablon nou" : "Editează șablonul") : "Șabloane de mesaje"}</h2>
          <div className="flex items-center gap-2">
            {!editing && (
              <button type="button" onClick={() => openNew()} className="tap h-8 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">
                + Șablon nou
              </button>
            )}
            <button onClick={onClose} className="tap grid size-8 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label="Închide">
              <IconX className="size-4" />
            </button>
          </div>
        </div>

        {editing && seed ? (
          <TemplateForm
            key={editing === "new" ? "new" : editing.id}
            seed={seed}
            onCancel={() => setEditing(null)}
            onSave={(d) => {
              if (editing === "new") onCreate(d);
              else onUpdate(editing.id, d);
              setEditing(null);
            }}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Șabloanele tale ({templates.length})</h3>
              {templates.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-line)] p-4 text-center text-sm text-ink-soft">
                  Încă nu ai șabloane. Apasă „+ Șablon nou” sau pornește de la unul predefinit de mai jos.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {templates.map((t) => {
                    const pending = t.id.startsWith("tmp-");
                    return (
                      <li key={t.id} className={`flex items-center gap-2 rounded-lg border border-[var(--color-line)] px-3 py-2 ${pending ? "opacity-60" : ""}`}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold">{t.name}</p>
                          <p className="truncate text-[11px] text-ink-soft">
                            {t.email && "✉ "}
                            {t.sms && "💬 "}
                            {t.subject || t.email.split("\n")[0] || t.sms}
                          </p>
                        </div>
                        {confirmId === t.id ? (
                          <>
                            <button type="button" onClick={() => { setConfirmId(null); onDelete(t.id); }} className="tap h-7 rounded-md bg-st-cancelled px-2.5 text-[11px] font-semibold text-white">
                              Șterge
                            </button>
                            <button type="button" onClick={() => setConfirmId(null)} className="tap h-7 rounded-md border border-[var(--color-line)] px-2.5 text-[11px]">
                              Nu
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="button" disabled={pending} onClick={() => openEdit(t)} title="Editează" className="tap grid size-7 place-items-center rounded-md border border-[var(--color-line)] text-xs hover:bg-brand-soft disabled:opacity-40">
                              ✎
                            </button>
                            <button type="button" disabled={pending} onClick={() => setConfirmId(t.id)} title="Șterge" className="tap grid size-7 place-items-center rounded-md border border-[var(--color-line)] text-xs text-st-cancelled hover:bg-[var(--color-surface-2)] disabled:opacity-40">
                              🗑
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">Predefinite (pornește de la ele)</h3>
              <div className="flex flex-wrap gap-1.5">
                {NOTIFY_PRESETS.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => openNew({ name: p.label, subject: p.subject, email: p.email, sms: p.sms })}
                    className="tap h-7 rounded-full border border-[var(--color-line)] px-3 text-xs hover:border-brand hover:bg-brand-soft"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateForm({
  seed,
  onSave,
  onCancel,
}: {
  seed: PayerTemplateDraft;
  onSave: (d: PayerTemplateDraft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState(seed);
  const [err, setErr] = useState<string | null>(null);
  const last = useRef<Field>("email");
  const subjectRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLTextAreaElement>(null);
  const smsRef = useRef<HTMLTextAreaElement>(null);

  function insert(token: string) {
    const f = last.current;
    const el = f === "subject" ? subjectRef.current : f === "email" ? emailRef.current : smsRef.current;
    if (!el) return;
    const text = `{${token}}`;
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? s;
    setD((cur) => ({ ...cur, [f]: cur[f].slice(0, s) + text + cur[f].slice(e) }));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + text.length, s + text.length);
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!d.name.trim()) return setErr("Dă un nume șablonului.");
    if (!d.email.trim() && !d.sms.trim()) return setErr("Scrie măcar mesajul de email sau de SMS.");
    onSave({ ...d, name: d.name.trim(), subject: d.subject.trim() });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        value={d.name}
        maxLength={NOTIFY_MAX_TEMPLATE_NAME}
        onChange={(e) => setD({ ...d, name: e.target.value })}
        placeholder="Nume șablon *"
        autoFocus
        className={`${inputCls} h-10`}
      />
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-semibold text-ink-soft">Inserează:</span>
        {NOTIFY_TOKENS.map((t) => (
          <button key={t.key} type="button" onClick={() => insert(t.key)} title={t.label} className="tap h-6 rounded-md bg-[var(--color-surface-2)] px-2 font-mono text-[11px] hover:bg-brand-soft">
            {`{${t.key}}`}
          </button>
        ))}
      </div>
      <input
        ref={subjectRef}
        value={d.subject}
        maxLength={NOTIFY_MAX_SUBJECT}
        onFocus={() => (last.current = "subject")}
        onChange={(e) => setD({ ...d, subject: e.target.value })}
        placeholder="Email — subiect"
        className={`${inputCls} h-10`}
      />
      <textarea
        ref={emailRef}
        value={d.email}
        maxLength={NOTIFY_MAX_EMAIL_BODY}
        onFocus={() => (last.current = "email")}
        onChange={(e) => setD({ ...d, email: e.target.value })}
        rows={6}
        placeholder="Email — mesaj"
        className={`${inputCls} py-2`}
      />
      <textarea
        ref={smsRef}
        value={d.sms}
        maxLength={NOTIFY_MAX_SMS_BODY}
        onFocus={() => (last.current = "sms")}
        onChange={(e) => setD({ ...d, sms: e.target.value })}
        rows={3}
        placeholder="SMS — mesaj (scurt)"
        className={`${inputCls} py-2`}
      />
      {err && <p className="text-sm text-st-cancelled">{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="tap h-10 rounded-xl border border-[var(--color-line)] px-4 text-sm font-medium text-ink-soft hover:bg-[var(--color-surface-2)]">
          Înapoi
        </button>
        <button type="submit" className="tap h-10 rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong">
          Salvează
        </button>
      </div>
    </form>
  );
}
