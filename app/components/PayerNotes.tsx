"use client";

import { useState } from "react";
import {
  addPayerNoteAction,
  deletePayerNoteAction,
  updatePayerNoteAction,
} from "@/app/actions/payer-notes";
import { NOTIFY_MAX_NOTE, agoLabel, type PayerNoteItem } from "@/lib/payer-notify";
import { useToast } from "./toast";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";

/**
 * Notițe interne pe un plătitor, ca un jurnal (autor + dată). Totul e optimist: notița apare/dispare/se schimbă
 * pe loc, iar serverul confirmă din urmă; la eșec revenim la starea de dinainte și arătăm eroarea.
 * `legacy` = vechiul câmp unic „Notițe" al fișei (importat din CSV), arătat separat, doar pentru citit.
 */
export default function PayerNotes({
  payerId,
  initial,
  legacy,
  canAdd,
  userId,
  isAdmin,
  compact = false,
  loading = false,
}: {
  payerId: string;
  initial: PayerNoteItem[];
  legacy?: string | null;
  canAdd: boolean;
  userId: string;
  isAdmin: boolean;
  compact?: boolean;
  loading?: boolean;
}) {
  const toast = useToast();
  const t = useT();
  const tag = dateTag(useLocale());
  const when = (iso: string) => new Date(iso).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" });
  const [notes, setNotes] = useState<PayerNoteItem[]>(initial);
  const [draft, setDraft] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function add() {
    const body = draft.trim();
    if (!body) return;
    const tmp = `tmp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date().toISOString();
    setNotes((n) => [{ id: tmp, body, userId, userName: t("Tu"), createdAt: now, updatedAt: now }, ...n]);
    setDraft("");
    addPayerNoteAction(payerId, body)
      .then((res) => {
        if (res.ok) setNotes((n) => n.map((x) => (x.id === tmp ? res.note : x)));
        else { setNotes((n) => n.filter((x) => x.id !== tmp)); setDraft(body); toast.error(res.error); }
      })
      .catch(() => { setNotes((n) => n.filter((x) => x.id !== tmp)); setDraft(body); toast.error(t("Nu am putut salva notița.")); });
  }

  function saveEdit(id: string) {
    const body = editText.trim();
    const prev = notes.find((x) => x.id === id);
    if (!prev || !body) return;
    setEditId(null);
    if (body === prev.body) return;
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, body } : x)));
    const revert = (msg: string) => { setNotes((n) => n.map((x) => (x.id === id ? prev : x))); toast.error(msg); };
    updatePayerNoteAction(id, body)
      .then((res) => { if (res.ok) setNotes((n) => n.map((x) => (x.id === id ? res.note : x))); else revert(res.error); })
      .catch(() => revert(t("Nu am putut salva modificarea.")));
  }

  function remove(id: string) {
    const prevList = notes;
    setConfirmId(null);
    setNotes((n) => n.filter((x) => x.id !== id));
    const revert = (msg: string) => { setNotes(prevList); toast.error(msg); };
    deletePayerNoteAction(id)
      .then((res) => { if (!res.ok) revert(res.error); })
      .catch(() => revert(t("Nu am putut șterge notița.")));
  }

  const canTouch = (n: PayerNoteItem) => canAdd && !n.id.startsWith("tmp-") && (n.userId === userId || isAdmin);

  return (
    <div className="flex flex-col gap-2">
      {canAdd && (
        <div className="flex flex-col gap-1.5">
          <textarea
            value={draft}
            maxLength={NOTIFY_MAX_NOTE}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
            rows={compact ? 2 : 3}
            placeholder={t("Scrie o notiță despre acest plătitor… (Ctrl+Enter = salvează)")}
            className="w-full resize-y rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[13px] outline-none focus:border-brand"
          />
          <div className="flex items-center justify-end gap-2">
            {draft.length > NOTIFY_MAX_NOTE * 0.8 && <span className="text-[11px] text-ink-soft">{draft.length}/{NOTIFY_MAX_NOTE}</span>}
            <button
              type="button"
              onClick={add}
              disabled={!draft.trim()}
              className="tap h-7 cursor-pointer rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong disabled:cursor-default disabled:opacity-40"
            >
              {t("Adaugă notița")}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-soft">{t("Se încarcă…")}</p>
      ) : notes.length === 0 && !legacy ? (
        <p className="text-sm text-ink-soft">{t("Nicio notiță încă.")}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {notes.map((n) => {
            const pending = n.id.startsWith("tmp-");
            return (
              <li key={n.id} className={`rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)]/60 px-2.5 py-1.5 ${pending ? "opacity-60" : ""}`}>
                <div className="flex items-center justify-between gap-2 text-[11px] text-ink-soft">
                  <span>
                    <b className="text-ink">{n.userName}</b> · {when(n.createdAt)} <span className="opacity-70">({agoLabel(n.createdAt, t)})</span>
                    {n.updatedAt !== n.createdAt && new Date(n.updatedAt).getTime() - new Date(n.createdAt).getTime() > 2000 && <span> · {t("editată")}</span>}
                  </span>
                  {canTouch(n) && editId !== n.id && (
                    <span className="flex shrink-0 items-center gap-1">
                      {confirmId === n.id ? (
                        <>
                          <button type="button" onClick={() => remove(n.id)} className="tap cursor-pointer rounded bg-st-cancelled px-2 py-0.5 text-[11px] font-semibold text-white">{t("Șterge")}</button>
                          <button type="button" onClick={() => setConfirmId(null)} className="tap cursor-pointer rounded border border-[var(--color-line)] px-2 py-0.5 text-[11px]">{t("Nu")}</button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => { setEditId(n.id); setEditText(n.body); }} title={t("Editează")} className="tap grid size-5 cursor-pointer place-items-center rounded hover:bg-brand-soft">✎</button>
                          <button type="button" onClick={() => setConfirmId(n.id)} title={t("Șterge")} className="tap grid size-5 cursor-pointer place-items-center rounded text-st-cancelled hover:bg-brand-soft">🗑</button>
                        </>
                      )}
                    </span>
                  )}
                </div>
                {editId === n.id ? (
                  <div className="mt-1 flex flex-col gap-1.5">
                    <textarea
                      value={editText}
                      autoFocus
                      maxLength={NOTIFY_MAX_NOTE}
                      onChange={(e) => setEditText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveEdit(n.id); }
                        if (e.key === "Escape") setEditId(null);
                      }}
                      rows={3}
                      className="w-full resize-y rounded-lg border border-brand bg-[var(--color-surface)] px-2 py-1 text-[13px] outline-none"
                    />
                    <div className="flex justify-end gap-1.5">
                      <button type="button" onClick={() => setEditId(null)} className="tap h-6 cursor-pointer rounded-md border border-[var(--color-line)] px-2.5 text-[11px]">{t("Anulează")}</button>
                      <button type="button" onClick={() => saveEdit(n.id)} disabled={!editText.trim()} className="tap h-6 cursor-pointer rounded-md bg-brand px-2.5 text-[11px] font-semibold text-white disabled:opacity-40">{t("Salvează")}</button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px]">{n.body}</p>
                )}
              </li>
            );
          })}
          {legacy && (
            <li className="rounded-lg border border-dashed border-[var(--color-line)] px-2.5 py-1.5">
              <p className="text-[11px] text-ink-soft">{t("Notiță din fișă (veche — se modifică din „Editează”)")}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px]">{legacy}</p>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
