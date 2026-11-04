"use client";

import { useSyncedState } from "@/app/hooks/useSyncedState";
import { useActionState, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSection, updateSection, deleteSection, setTeamSection, type SectionState } from "@/app/actions/sections";
import {
  createTeam,
  updateTeam,
  deleteTeam,
  type TeamState,
} from "@/app/actions/teams";
import { useToast } from "./toast";
import { IconX, IconPencil, IconTrash } from "./icons";
import CardActionsMenu from "./CardActionsMenu";
import { useMessages, useT } from "@/lib/i18n/context";

type Opt = { id: string; name: string; sectionId?: string | null };
type Section = { id: string; name: string; description: string | null };
type Team = {
  id: string;
  name: string;
  description: string | null;
  sectionId: string | null;
  memberIds: string[];
  members: { id: string; name: string }[];
};

const input =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

/**
 * Secții și echipe: o secție are mai multe echipe, iar fiecare utilizator face parte dintr-o secție (se alege în Utilizatori) și din oricâte echipe.
 * Echipele funcționează ca până acum (atribuire, notificări, membri); secția e nivelul de deasupra lor, pe care se filtrează și se scot rapoartele.
 */
export default function TeamsManager({ teams, users, sections, canManage = true }: { teams: Team[]; users: Opt[]; sections: Section[]; canManage?: boolean }) {
  const toast = useToast();
  const m = useMessages();
  const t = useT();
  const [rows, setRows] = useSyncedState(teams);
  const [secRows, setSecRows] = useSyncedState(sections);
  const [dialog, setDialog] = useState<{ open: boolean; team: Team | null; sectionId?: string }>({ open: false, team: null });
  const [secDialog, setSecDialog] = useState<{ open: boolean; section: Section | null }>({ open: false, section: null });

  const [fSearch, setFSearch] = useState("");
  const term = fSearch.trim().toLowerCase();

  // Grupuri: fiecare secție cu echipele și persoanele ei; la urmă, echipele fără secție. Căutarea păstrează o secție dacă se potrivește ea, o echipă sau o persoană din ea.
  const groups = useMemo(() => {
    const matchTeam = (x: Team) => `${x.name} ${x.members.map((mem) => mem.name).join(" ")}`.toLowerCase().includes(term);
    const out = secRows.map((s) => {
      const own = rows.filter((x) => x.sectionId === s.id);
      const people = users.filter((u) => u.sectionId === s.id);
      const secHit = !term || `${s.name} ${people.map((p) => p.name).join(" ")}`.toLowerCase().includes(term);
      return { section: s, all: own.length, teams: secHit ? own : own.filter(matchTeam), people, show: secHit || own.some(matchTeam) };
    });
    const loose = rows.filter((x) => !x.sectionId && (!term || matchTeam(x)));
    return { sections: out.filter((g) => g.show), loose };
  }, [secRows, rows, users, term]);

  function removeTeam(id: string) {
    if (!confirm(m.team.deleteConfirm)) return;
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id)); // optimistic
    deleteTeam(id)
      .then(() => toast.success(m.team.deleted))
      .catch(() => {
        setRows(prev);
        toast.error(m.team.deleteFailed);
      });
  }

  function removeSection(s: Section) {
    if (!confirm(t("Ștergi secția „{name}”? Echipele, persoanele și cererile ei rămân, doar fără secție.", { name: s.name }))) return;
    const prev = { rows, secRows };
    setSecRows((r) => r.filter((x) => x.id !== s.id));
    setRows((r) => r.map((x) => (x.sectionId === s.id ? { ...x, sectionId: null } : x)));
    deleteSection(s.id)
      .then((res) => {
        if (!res.ok) throw new Error(res.error);
        toast.success(t("Secție ștearsă."));
      })
      .catch((e: Error) => {
        setRows(prev.rows);
        setSecRows(prev.secRows);
        toast.error(e.message ? t(e.message) : t("Nu am putut șterge secția."));
      });
  }

  /** Mută o echipă într-o secție (sau o scoate, cu `sectionId` null) direct din pagină; la eșec revine. */
  function moveTeam(teamId: string, sectionId: string | null) {
    const prev = rows;
    setRows((r) => r.map((x) => (x.id === teamId ? { ...x, sectionId } : x)));
    setTeamSection(teamId, sectionId)
      .then((res) => {
        if (!res.ok) throw new Error(res.error);
        toast.success(sectionId ? t("Echipa a fost adăugată în secție.") : t("Echipa a fost scoasă din secție."));
      })
      .catch((e: Error) => {
        setRows(prev);
        toast.error(e.message ? t(e.message) : m.common.error);
      });
  }

  const teamCard = (x: Team) => (
    <div key={x.id} className="flex items-center gap-3 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{x.name}</p>
        <p className="truncate text-xs text-ink-soft">
          {x.members.length} {m.team.membersLabel.toLowerCase()}{x.members.length ? `: ${x.members.map((mem) => mem.name).join(", ")}` : ""}
        </p>
      </div>
      {canManage && x.sectionId && (
        <button onClick={() => moveTeam(x.id, null)} className="tap hidden h-9 shrink-0 rounded-lg border border-[var(--color-line)] px-2 text-xs text-ink-soft hover:bg-[var(--color-surface-2)] sm:block" title={t("Scoate echipa din secție")}>
          {t("Scoate din secție")}
        </button>
      )}
      {canManage && <div className="hidden shrink-0 items-center gap-2 sm:flex">
        <button onClick={() => setDialog({ open: true, team: x })} className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] hover:bg-[var(--color-surface-2)]" title={m.common.edit}>
          <IconPencil className="size-4" />
        </button>
        <button onClick={() => removeTeam(x.id)} className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-st-cancelled hover:bg-[var(--color-surface-2)]" title={m.common.delete}>
          <IconTrash className="size-4" />
        </button>
      </div>}
      {canManage && <CardActionsMenu
        className="sm:hidden"
        items={[
          { key: "edit", label: m.common.edit, icon: <IconPencil className="size-3.5" />, onClick: () => setDialog({ open: true, team: x }) },
          { key: "delete", label: m.common.delete, icon: <IconTrash className="size-3.5" />, onClick: () => removeTeam(x.id), danger: true },
        ]}
      />}
    </div>
  );

  const empty = secRows.length === 0 && rows.length === 0;
  const noMatch = !empty && groups.sections.length === 0 && groups.loose.length === 0;

  return (
    <>
      {canManage && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <button
            onClick={() => setSecDialog({ open: true, section: null })}
            data-new-section
            className="tap flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong"
          >
            {t("+ Secție nouă")}
          </button>
          <button
            onClick={() => setDialog({ open: true, team: null })}
            className="tap flex h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-brand font-semibold text-brand hover:bg-brand-soft"
          >
            {m.team.new}
          </button>
        </div>
      )}

      <input
        value={fSearch}
        onChange={(e) => setFSearch(e.target.value)}
        placeholder={m.team.searchPlaceholder}
        className="mb-3 h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm outline-none focus:border-brand"
      />

      {empty ? (
        <div className="card grid place-items-center p-10 text-center text-sm text-ink-soft">{m.team.noTeams}</div>
      ) : noMatch ? (
        <div className="card grid place-items-center p-8 text-center text-sm text-ink-soft">{m.team.noResults}</div>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.sections.map(({ section, all, teams: own, people }) => (
            <section key={section.id} className="card p-3.5" data-section={section.id}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-base font-bold">{section.name}</h2>
                  <p className="text-xs text-ink-soft">
                    {t("{teams} echipe · {people} persoane", { teams: all, people: people.length })}
                    {section.description ? ` · ${section.description}` : ""}
                  </p>
                  {people.length > 0 && <p className="mt-0.5 truncate text-xs text-ink-soft">{people.map((p) => p.name).join(", ")}</p>}
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => setDialog({ open: true, team: null, sectionId: section.id })} className="tap h-9 rounded-lg border border-[var(--color-line)] px-2.5 text-xs font-medium hover:bg-[var(--color-surface-2)]">
                      {t("+ Echipă")}
                    </button>
                    <button onClick={() => setSecDialog({ open: true, section })} className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] hover:bg-[var(--color-surface-2)]" title={m.common.edit}>
                      <IconPencil className="size-4" />
                    </button>
                    <button onClick={() => removeSection(section)} className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-st-cancelled hover:bg-[var(--color-surface-2)]" title={m.common.delete}>
                      <IconTrash className="size-4" />
                    </button>
                  </div>
                )}
              </div>
              {canManage && rows.some((x) => x.sectionId !== section.id) && (
                <select
                  value=""
                  onChange={(e) => e.target.value && moveTeam(e.target.value, section.id)}
                  aria-label={t("Adaugă o echipă existentă")}
                  data-add-team-to-section
                  className="mt-3 h-10 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
                >
                  <option value="">{t("＋ Adaugă o echipă existentă în această secție…")}</option>
                  {rows.filter((x) => x.sectionId !== section.id).map((x) => (
                    <option key={x.id} value={x.id}>{x.name}{x.sectionId ? ` (${secRows.find((s) => s.id === x.sectionId)?.name ?? ""})` : ""}</option>
                  ))}
                </select>
              )}
              <div className="mt-3 flex flex-col gap-2">
                {own.length === 0 ? <p className="text-xs text-ink-soft">{t("Nicio echipă în această secție.")}</p> : own.map(teamCard)}
              </div>
            </section>
          ))}

          {groups.loose.length > 0 && (
            <section className="card p-3.5" data-section="none">
              <h2 className="mb-0.5 text-base font-bold">{t("Echipe fără secție")}</h2>
              <p className="mb-3 text-xs text-ink-soft">{t("Alege o secție pentru ele (din „Editează”) sau din „Secție nouă”.")}</p>
              <div className="flex flex-col gap-2">{groups.loose.map(teamCard)}</div>
            </section>
          )}
        </div>
      )}

      {dialog.open && (
        <TeamDialog team={dialog.team} defaultSectionId={dialog.sectionId} users={users} sections={secRows} onClose={() => setDialog({ open: false, team: null })} />
      )}
      {secDialog.open && (
        <SectionDialog section={secDialog.section} teams={rows} onClose={() => setSecDialog({ open: false, section: null })} />
      )}
    </>
  );
}

function TeamDialog({ team, defaultSectionId, users, sections, onClose }: { team: Team | null; defaultSectionId?: string; users: Opt[]; sections: Section[]; onClose: () => void }) {
  const router = useRouter();
  const m = useMessages();
  const t = useT();
  const [, startTransition] = useTransition();
  const action = team ? updateTeam : createTeam;
  const [state, formAction, pending] = useActionState<TeamState, FormData>(action, undefined);
  useEffect(() => {
    if (state?.ok) {
      onClose();
      startTransition(() => router.refresh());
    }
  }, [state, router, onClose, startTransition]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{team ? m.team.editTitle : m.team.newTitle}</h2>
          <button onClick={onClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>
        <form action={formAction} className="flex flex-col gap-3">
          {team && <input type="hidden" name="id" value={team.id} />}
          <input name="name" defaultValue={team?.name ?? ""} placeholder={m.team.namePlaceholder} required className={input} />
          <label className="text-xs font-semibold text-ink-soft">
            {t("Secție")}
            <select name="sectionId" defaultValue={team?.sectionId ?? defaultSectionId ?? ""} className={`${input} mt-1 font-normal text-ink`}>
              <option value="">{t("— fără secție —")}</option>
              {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <textarea name="description" defaultValue={team?.description ?? ""} placeholder={m.team.descriptionPlaceholder} rows={2} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand" />
          <div className="rounded-xl border border-[var(--color-line)] p-3">
            <p className="mb-2 text-xs font-semibold text-ink-soft">{m.team.membersLabel}</p>
            {users.length === 0 ? (
              <p className="text-sm text-ink-soft">{m.team.noUsersAvailable}</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {users.map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="memberIds"
                      value={u.id}
                      defaultChecked={team?.memberIds.includes(u.id) ?? false}
                      className="size-4 accent-[var(--color-brand)]"
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            )}
          </div>
          {state?.error && <p className="text-sm text-st-cancelled">{t(state.error)}</p>}
          <button type="submit" disabled={pending} className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {pending ? m.common.saving : m.common.save}
          </button>
        </form>
      </div>
    </div>
  );
}

/** Secție nouă / modificată: nume, descriere și echipele care fac parte din ea (persoanele își aleg secția din Utilizatori). */
function SectionDialog({ section, teams, onClose }: { section: Section | null; teams: Team[]; onClose: () => void }) {
  const router = useRouter();
  const m = useMessages();
  const t = useT();
  const [, startTransition] = useTransition();
  const action = section ? updateSection : createSection;
  const [state, formAction, pending] = useActionState<SectionState, FormData>(action, undefined);
  useEffect(() => {
    if (state?.ok) {
      onClose();
      startTransition(() => router.refresh());
    }
  }, [state, router, onClose, startTransition]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-lg overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-bold">{section ? t("Modifică secția") : t("Secție nouă")}</h2>
          <button onClick={onClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>
        <form action={formAction} className="flex flex-col gap-3">
          {section && <input type="hidden" name="id" value={section.id} />}
          <input name="name" defaultValue={section?.name ?? ""} placeholder={t("Numele secției *")} required className={input} />
          <textarea name="description" defaultValue={section?.description ?? ""} placeholder={m.team.descriptionPlaceholder} rows={2} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand" />
          <div className="rounded-xl border border-[var(--color-line)] p-3">
            <p className="mb-2 text-xs font-semibold text-ink-soft">{t("Echipele din secție")}</p>
            {teams.length === 0 ? (
              <p className="text-sm text-ink-soft">{m.team.noTeams}</p>
            ) : (
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {teams.map((x) => (
                  <label key={x.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="teamIds" value={x.id} defaultChecked={!!section && x.sectionId === section.id} className="size-4 accent-[var(--color-brand)]" />
                    <span className="min-w-0 truncate">{x.name}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-ink-soft">{t("O echipă face parte dintr-o singură secție: bifată aici, o părăsește pe cea veche.")}</p>
          </div>
          {state?.error && <p className="text-sm text-st-cancelled">{t(state.error)}</p>}
          <button type="submit" disabled={pending} className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {pending ? m.common.saving : m.common.save}
          </button>
        </form>
      </div>
    </div>
  );
}
