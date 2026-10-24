"use client";

import { useState } from "react";
import { deleteTaskTemplateAction, saveTaskTemplateAction } from "@/app/actions/task-templates";
import { TEMPLATE_MAX_NAME, TEMPLATE_MAX_TITLE, TEMPLATE_VARIABLES, type TaskTemplate, type TaskTemplateType } from "@/lib/task-template";
import MultiAssignPicker from "./MultiAssignPicker";
import AddressInput from "./AddressInput";
import { IconPencil, IconTrash, IconX } from "./icons";
import { useToast } from "./toast";
import { useMessages } from "@/lib/i18n/context";
import type { CategoryLite } from "./types";
import { useT } from "@/lib/i18n/context";

type Opt = { id: string; name: string };

const input =
  "h-10 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";
const label = "mb-1 block text-xs font-semibold text-ink-soft";

const EMPTY: Omit<TaskTemplate, "id" | "type"> = {
  name: "", title: "", description: "", priority: "MEDIUM", categoryId: "", projectId: "", clientId: "", address: "",
  assigneeIds: [], teamIds: [], dueDays: null, reminderIntervalMinutes: 0, counter: 1,
};

/**
 * Șabloane de task-uri / tichete: listă + editor. „Folosește" deschide fereastra de creare cu câmpurile completate (titlul cu {contor}
 * înlocuit), iar tu schimbi doar ce e diferit și creezi.
 */
export default function TaskTemplatesDialog({
  type,
  templates,
  onChange,
  users,
  teams,
  projects,
  clients,
  categories,
  canAssign,
  onUse,
  onClose,
}: {
  type: TaskTemplateType;
  templates: TaskTemplate[];
  onChange: (next: TaskTemplate[]) => void;
  users: Opt[];
  teams: Opt[];
  projects: Opt[];
  clients: Opt[];
  categories: CategoryLite[];
  canAssign: boolean;
  onUse: (id: string) => void;
  onClose: () => void;
}) {
  const tr = useT();
  const toast = useToast();
  const m = useMessages();
  const [editing, setEditing] = useState<(Omit<TaskTemplate, "id" | "type"> & { id?: string }) | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const catName = (id: string) => categories.find((c) => c.id === id)?.name;

  function startEdit(t: (Omit<TaskTemplate, "id" | "type"> & { id?: string }) | null) {
    setError(null);
    setForm(t ? { ...t } : EMPTY);
    setEditing(t ?? { ...EMPTY });
  }

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (saving) return;
    const fd = new FormData(e.currentTarget);
    const dueRaw = String(fd.get("dueDays") ?? "").trim();
    setSaving(true);
    setError(null);
    const res = await saveTaskTemplateAction(type, {
      id: editing?.id,
      name: String(fd.get("name") ?? ""),
      title: String(fd.get("title") ?? ""),
      description: String(fd.get("description") ?? ""),
      priority: String(fd.get("priority") ?? "MEDIUM") as TaskTemplate["priority"],
      categoryId: String(fd.get("categoryId") ?? ""),
      projectId: String(fd.get("projectId") ?? ""),
      clientId: String(fd.get("clientId") ?? ""),
      address: String(fd.get("address") ?? ""),
      // fără „Asignare" selectorul de responsabili lipsește: păstrăm ce avea șablonul
      assigneeIds: canAssign ? fd.getAll("assigneeIds").map(String).filter(Boolean) : form.assigneeIds,
      teamIds: canAssign ? fd.getAll("teamIds").map(String).filter(Boolean) : form.teamIds,
      dueDays: dueRaw === "" ? null : Number(dueRaw),
      reminderIntervalMinutes: Number(fd.get("reminderIntervalMinutes") ?? 0) || 0,
      counter: Number(fd.get("counter") ?? 1) || 1,
    }).catch(() => null);
    setSaving(false);
    if (!res) return setError(tr(m.common.error));
    if (!res.ok) return setError(tr(res.error));
    onChange(editing?.id ? templates.map((t) => (t.id === res.template.id ? res.template : t)) : [...templates, res.template].sort((a, b) => a.name.localeCompare(b.name, "ro")));
    toast.success(tr("Șablon salvat."));
    setEditing(null);
  }

  async function remove(t: TaskTemplate) {
    if (!confirm(tr("Ștergi șablonul „{name}”?", { name: t.name }))) return;
    const res = await deleteTaskTemplateAction(t.id).catch(() => null);
    if (!res || !res.ok) return toast.error(res && !res.ok ? res.error : m.common.error);
    onChange(templates.filter((x) => x.id !== t.id));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-xl overflow-auto rounded-b-none rounded-t-2xl p-5 sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">{editing ? (editing.id ? tr("Editează șablonul") : tr("Șablon nou")) : type === "TICKET" ? tr("Șabloane de cereri") : tr("Șabloane de sarcini")}</h2>
          <button type="button" onClick={onClose} className="tap grid size-9 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>

        {!editing ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-ink-soft">
              {tr("Alegi un șablon, se deschide fereastra de creare deja completată (titlul cu numărul următor), schimbi doar ce e diferit și creezi.")}
            </p>
            {templates.length === 0 && <p className="rounded-xl border border-dashed border-[var(--color-line)] p-4 text-center text-sm text-ink-soft">{tr("Nu ai niciun șablon încă.")}</p>}
            {templates.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-xl border border-[var(--color-line)] p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{t.name}</p>
                  <p className="truncate text-[11px] text-ink-soft">
                    {t.title}
                    {catName(t.categoryId) ? ` · ${catName(t.categoryId)}` : ""}
                    {/\{contor\}/i.test(t.title + t.description) ? " " + tr("· următorul nr. {n}", { n: t.counter }) : ""}
                  </p>
                </div>
                <button type="button" onClick={() => onUse(t.id)} className="tap h-8 shrink-0 cursor-pointer rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">
                  {tr("Folosește")}
                </button>
                <button type="button" onClick={() => startEdit(t)} title={m.common.edit} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] hover:bg-brand-soft">
                  <IconPencil className="size-3.5" />
                </button>
                <button type="button" onClick={() => remove(t)} title={m.common.delete} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg border border-[var(--color-line)] text-st-cancelled hover:bg-st-cancelled/10">
                  <IconTrash className="size-3.5" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => startEdit(null)} className="tap mt-1 h-10 cursor-pointer rounded-xl border border-dashed border-brand text-sm font-semibold text-brand hover:bg-brand-soft">
              {tr("+ Șablon nou")}
            </button>
          </div>
        ) : (
          <form onSubmit={save} className="flex flex-col gap-3" key={editing.id ?? "nou"}>
            <div>
              <label className={label}>{tr("Numele șablonului (îl vezi doar în listă)")}</label>
              <input name="name" defaultValue={form.name} maxLength={TEMPLATE_MAX_NAME} required autoFocus placeholder={tr("ex. Citire lunară contoare")} className={input} />
            </div>
            <div>
              <label className={label}>{type === "TICKET" ? tr("Titlul cererii") : tr("Titlul sarcinii")}</label>
              <input name="title" defaultValue={form.title} maxLength={TEMPLATE_MAX_TITLE} required placeholder={tr("ex. Verificare contor #{contor} — {luna}")} className={input} />
              <p className="mt-1 text-[11px] text-ink-soft">
                {tr("Variabile (se înlocuiesc la creare, în titlu și în descriere):")} {TEMPLATE_VARIABLES.map((v) => <code key={v} className="mx-0.5 rounded bg-[var(--color-surface-2)] px-1">{v}</code>)}
                — {tr("{contor} crește cu 1 la fiecare creare din șablon.")}
              </p>
            </div>
            <div>
              <label className={label}>{tr("Descriere")}</label>
              <textarea name="description" defaultValue={form.description} rows={3} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2 text-sm outline-none focus:border-brand" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <label className={label}>{tr("Prioritate")}</label>
                <select name="priority" defaultValue={form.priority} className={input}>
                  <option value="LOW">{m.priority.LOW}</option>
                  <option value="MEDIUM">{m.priority.MEDIUM}</option>
                  <option value="HIGH">{m.priority.HIGH}</option>
                  <option value="URGENT">{m.priority.URGENT}</option>
                </select>
              </div>
              <div>
                <label className={label}>{m.tasks.categoryLabel}</label>
                <select name="categoryId" defaultValue={form.categoryId} className={input}>
                  <option value="">{m.tasks.noCategory}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className={label}>{tr("Proiect")}</label>
                <select name="projectId" defaultValue={form.projectId} className={input}>
                  <option value="">{m.tasks.noProject}</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              {clients.length > 0 && (
                <div>
                  <label className={label}>{tr("Client")}</label>
                  <select name="clientId" defaultValue={form.clientId} className={input}>
                    <option value="">{m.tasks.noClient}</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div>
              <label className={label}>{tr("Adresă")}</label>
              <AddressInput defaultValue={form.address} className={input} />
            </div>
            {canAssign && <MultiAssignPicker users={users} teams={teams} initialAssigneeIds={form.assigneeIds} initialTeamIds={form.teamIds} />}
            <div className="grid gap-2 sm:grid-cols-3">
              <div>
                <label className={label}>{tr("Termen: peste … zile")}</label>
                <input name="dueDays" type="number" min={0} max={3650} defaultValue={form.dueDays ?? ""} placeholder={tr("fără termen")} className={input} />
              </div>
              <div>
                <label className={label}>{m.tasks.reminderLabel}</label>
                <select name="reminderIntervalMinutes" defaultValue={form.reminderIntervalMinutes} className={input}>
                  <option value={0}>{m.tasks.reminderNever}</option>
                  <option value={10}>{m.tasks.reminder10m}</option>
                  <option value={30}>{m.tasks.reminder30m}</option>
                  <option value={60}>{m.tasks.reminder1h}</option>
                  <option value={180}>{m.tasks.reminder3h}</option>
                  <option value={360}>{m.tasks.reminder6h}</option>
                  <option value={720}>{m.tasks.reminder12h}</option>
                  <option value={1440}>{m.tasks.reminder24h}</option>
                  <option value={10080}>{m.tasks.reminder7d}</option>
                </select>
              </div>
              <div>
                <label className={label}>{tr("Următorul {contor}")}</label>
                <input name="counter" type="number" min={1} max={9999999} defaultValue={form.counter} className={input} />
              </div>
            </div>
            {error && <p className="text-sm text-st-cancelled">{tr(error)}</p>}
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(null)} className="tap h-11 flex-1 cursor-pointer rounded-xl border border-[var(--color-line)] text-sm font-medium hover:bg-[var(--color-surface-2)]">
                {tr("Înapoi")}
              </button>
              <button type="submit" disabled={saving} className="tap h-11 flex-[2] cursor-pointer rounded-xl bg-brand text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
                {saving ? m.common.saving : tr("Salvează șablonul")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
