"use client";

import { useEffect, useState } from "react";
import { getIssueTeamsAction, updateIssueAction } from "@/app/actions/meter-issues";
import { ISSUE_LABELS, type IssueDto } from "@/lib/meter-issues";
import { useT } from "@/lib/i18n/context";
import { useToast } from "./toast";
import { IconX } from "./icons";

const fld = "h-10 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

/**
 * Corectarea unei nereguli de contor: cine remediază (client / companie / de stabilit), secția responsabilă și termenul de remediere.
 * Un termen nou reia notificările (cu 3 zile înainte și la depășire). Secțiile se încarcă la deschidere.
 */
export default function IssueEditDialog({ issue, onClose, onSaved }: { issue: IssueDto; onClose: () => void; onSaved: (i: IssueDto) => void }) {
  const t = useT();
  const toast = useToast();
  const [teams, setTeams] = useState<{ id: string; name: string }[] | null>(null);
  const [responsible, setResponsible] = useState<string>(issue.responsible ?? "");
  const [teamId, setTeamId] = useState(issue.teamId ?? "");
  const [dueAt, setDueAt] = useState(issue.dueAt ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void getIssueTeamsAction().then((r) => alive && setTeams(r)).catch(() => alive && setTeams([]));
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save() {
    setBusy(true);
    try {
      const r = await updateIssueAction(issue.id, { responsible: responsible || null, teamId: teamId || null, dueAt: dueAt || null });
      if (!r.ok) return toast.error(t(r.error));
      toast.success(t("Neregula a fost actualizată."));
      onSaved(r.issue);
      onClose();
    } catch {
      toast.error(t("Nu am putut salva."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={t("Editează neregula")} className="card w-full max-w-md rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl" data-issue-edit="">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold">{t("Editează neregula")}</h2>
            <p className="mt-0.5 truncate text-xs text-ink-soft">{t(ISSUE_LABELS[issue.kind])} · {issue.contor}</p>
          </div>
          <button type="button" onClick={onClose} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>
            <IconX className="size-4" />
          </button>
        </div>

        <label className="mb-1 block text-xs font-semibold text-ink-soft" htmlFor="ie-resp">{t("Cine remediază")}</label>
        <select id="ie-resp" name="responsible" value={responsible} onChange={(e) => setResponsible(e.target.value)} className={fld}>
          <option value="">{t("De stabilit")}</option>
          <option value="CLIENT">{t("Clientul")}</option>
          <option value="COMPANY">{t("Compania")}</option>
        </select>

        <label className="mb-1 mt-3 block text-xs font-semibold text-ink-soft" htmlFor="ie-team">{t("Secția responsabilă")}</label>
        <select id="ie-team" name="teamId" value={teamId} onChange={(e) => setTeamId(e.target.value)} className={fld} disabled={!teams}>
          <option value="">{t("Fără secție")}</option>
          {(teams ?? []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>

        <label className="mb-1 mt-3 block text-xs font-semibold text-ink-soft" htmlFor="ie-due">{t("Termen de remediere")}</label>
        <input id="ie-due" name="dueAt" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={fld} />
        <p className="mt-1 text-[11px] text-ink-soft">{t("Un termen nou reia notificările: cu 3 zile înainte și la depășire.")}</p>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="tap h-11 cursor-pointer rounded-xl border border-[var(--color-line)] px-4 text-sm hover:bg-[var(--color-surface-2)]">{t("Anulează")}</button>
          <button type="button" onClick={() => void save()} disabled={busy} className="tap h-11 cursor-pointer rounded-xl bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-50">{busy ? t("Se salvează…") : t("Salvează")}</button>
        </div>
      </div>
    </div>
  );
}
