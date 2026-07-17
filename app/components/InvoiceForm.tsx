"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveInvoice, type InvoicePayload } from "@/app/actions/invoices";
import { quickCreateClient } from "@/app/actions/clients";
import { quickCreateProject } from "@/app/actions/projects";
import { money } from "./invoice-meta";
import { useToast } from "./toast";
import { IconTrash, IconPlus, IconCheck, IconX } from "./icons";
import { useMessages } from "@/lib/i18n/context";

type Opt = { id: string; name: string };
type ProjOpt = { id: string; name: string; clientId: string | null };
type Item = { description: string; quantity: number; unitPrice: number; taxRate: number };
// În formular ținem valorile numerice ca string ca să permitem golire/zecimale/valori mari.
type FormItem = { description: string; quantity: string; unitPrice: string; taxRate: string };
const num = (s: string) => Number(s) || 0;

export type InvoiceInitial = {
  id: string;
  status: string;
  issueDate: string;
  dueDate: string;
  clientId: string | null;
  projectId: string | null;
  taskIds: string[];
  notes: string;
  terms: string;
  currency: string;
  items: Item[];
};

const input =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";
const label = "mb-1.5 block text-xs font-semibold text-ink-soft";
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function InvoiceForm({
  clients,
  projects,
  currency,
  initial,
  canCreateClient = false,
  canCreateProject = false,
}: {
  clients: Opt[];
  projects: ProjOpt[];
  currency: string;
  initial?: InvoiceInitial;
  canCreateClient?: boolean;
  canCreateProject?: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const m = useMessages();
  // Liste locale ca să apară imediat ce creăm inline
  const [clientList, setClientList] = useState<Opt[]>(clients);
  const [projectList, setProjectList] = useState<ProjOpt[]>(projects);
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  // Inline-create
  const [addingClient, setAddingClient] = useState(false);
  const [newClient, setNewClient] = useState("");
  const [addingProject, setAddingProject] = useState(false);
  const [newProject, setNewProject] = useState("");
  const [busy, setBusy] = useState(false);

  async function createClientInline() {
    const n = newClient.trim();
    if (!n) return;
    setBusy(true);
    const res = await quickCreateClient(n);
    setBusy(false);
    if (res.ok) {
      setClientList((l) => [{ id: res.id, name: res.name }, ...l]);
      onClientChange(res.id);
      setNewClient("");
      setAddingClient(false);
      toast.success(m.invoices.clientCreated);
    } else toast.error(res.error);
  }

  async function createProjectInline() {
    const n = newProject.trim();
    if (!n) return;
    setBusy(true);
    const res = await quickCreateProject(n);
    setBusy(false);
    if (res.ok) {
      // legăm proiectul de clientul curent (dacă există) ca să apară în filtrare
      setProjectList((l) => [{ id: res.id, name: res.name, clientId: clientId || null }, ...l]);
      setProjectId(res.id);
      setTaskIds([]);
      setNewProject("");
      setAddingProject(false);
      toast.success(m.invoices.projectCreated);
    } else toast.error(res.error);
  }
  const [taskIds, setTaskIds] = useState<string[]>(initial?.taskIds ?? []);
  const [tasks, setTasks] = useState<{ id: string; title: string }[]>([]);
  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? todayStr());
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [terms, setTerms] = useState(initial?.terms ?? "");
  const [items, setItems] = useState<FormItem[]>(
    initial?.items?.length
      ? initial.items.map((it) => ({
          description: it.description,
          quantity: String(it.quantity),
          unitPrice: String(it.unitPrice),
          taxRate: String(it.taxRate),
        }))
      : [{ description: "", quantity: "1", unitPrice: "0", taxRate: "0" }],
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Proiectele clientului selectat (sau toate dacă nu e client)
  const filteredProjects = useMemo(
    () => (clientId ? projectList.filter((p) => p.clientId === clientId) : projectList),
    [clientId, projectList],
  );

  // Încarcă task-urile pentru proiectul curent
  useEffect(() => {
    if (!projectId) {
      setTasks([]);
      return;
    }
    let active = true;
    fetch(`/api/invoices/tasks?projectId=${projectId}`)
      .then((r) => r.json())
      .then((d) => active && setTasks(d.items ?? []))
      .catch(() => active && setTasks([]));
    return () => {
      active = false;
    };
  }, [projectId]);

  function onClientChange(cid: string) {
    setClientId(cid);
    setTaskIds([]);
    const owned = projectList.filter((p) => p.clientId === cid);
    // Un singur proiect → selectat automat; altfel resetăm
    if (cid && owned.length === 1) setProjectId(owned[0].id);
    else setProjectId("");
  }

  function onProjectChange(pid: string) {
    setProjectId(pid);
    setTaskIds([]);
    const proj = projectList.find((p) => p.id === pid);
    if (proj?.clientId) setClientId(proj.clientId); // autofill client
  }

  function toggleTask(id: string) {
    setTaskIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  // Calcule live
  const totals = useMemo(() => {
    let subtotal = 0;
    let taxTotal = 0;
    const lines = items.map((it) => {
      const ls = round2(num(it.quantity) * num(it.unitPrice));
      const lt = round2((ls * num(it.taxRate)) / 100);
      subtotal += ls;
      taxTotal += lt;
      return { lineSubtotal: ls, lineTotal: round2(ls + lt) };
    });
    subtotal = round2(subtotal);
    taxTotal = round2(taxTotal);
    return { lines, subtotal, taxTotal, grandTotal: round2(subtotal + taxTotal) };
  }, [items]);

  function setItem(i: number, patch: Partial<FormItem>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  }
  function addItem() {
    setItems((prev) => [...prev, { description: "", quantity: "1", unitPrice: "0", taxRate: "0" }]);
  }
  function removeItem(i: number) {
    setItems((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));
  }

  async function submit(status: "DRAFT" | "SENT") {
    setError("");
    const valid = items.filter((it) => it.description.trim() !== "");
    if (valid.length === 0) {
      setError(m.invoices.validationError);
      return;
    }
    setSaving(true);
    const payload: InvoicePayload = {
      id: initial?.id,
      status,
      issueDate,
      dueDate: dueDate || null,
      clientId: clientId || null,
      projectId: projectId || null,
      taskIds,
      notes,
      terms,
      items: valid.map((it) => ({
        description: it.description,
        quantity: num(it.quantity),
        unitPrice: num(it.unitPrice),
        taxRate: num(it.taxRate),
      })),
    };
    const res = await saveInvoice(payload);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? m.common.error);
      return;
    }
    router.push("/invoices");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>{m.invoices.issueDate}</label>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>{m.invoices.dueDate}</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={label}>{m.invoices.clientLabel}</label>
            <div className="flex gap-2">
              <select value={clientId} onChange={(e) => onClientChange(e.target.value)} className={input}>
                <option value="">—</option>
                {clientList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {canCreateClient && !addingClient && (
                <button type="button" onClick={() => setAddingClient(true)} className="tap grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--color-line)] text-brand hover:bg-brand-soft" title={m.invoices.addClient}>
                  <IconPlus className="size-4" />
                </button>
              )}
            </div>
            {addingClient && (
              <div className="mt-2 flex gap-2">
                <input autoFocus value={newClient} onChange={(e) => setNewClient(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createClientInline(); } if (e.key === "Escape") { setAddingClient(false); setNewClient(""); } }}
                  placeholder={m.invoices.clientNamePlaceholder} className={input} />
                <button type="button" disabled={busy || !newClient.trim()} onClick={createClientInline} className="tap grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-white hover:bg-brand-strong disabled:opacity-50" title={m.common.save}><IconCheck className="size-4" /></button>
                <button type="button" onClick={() => { setAddingClient(false); setNewClient(""); }} className="tap grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]" title={m.common.cancel}><IconX className="size-4" /></button>
              </div>
            )}
          </div>
          <div>
            <label className={label}>{m.invoices.projectLabel}</label>
            <div className="flex gap-2">
              <select value={projectId} onChange={(e) => onProjectChange(e.target.value)} className={input}>
                <option value="">—</option>
                {filteredProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {canCreateProject && !addingProject && (
                <button type="button" onClick={() => setAddingProject(true)} className="tap grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--color-line)] text-brand hover:bg-brand-soft" title={m.invoices.addProject}>
                  <IconPlus className="size-4" />
                </button>
              )}
            </div>
            {addingProject && (
              <div className="mt-2 flex gap-2">
                <input autoFocus value={newProject} onChange={(e) => setNewProject(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createProjectInline(); } if (e.key === "Escape") { setAddingProject(false); setNewProject(""); } }}
                  placeholder={m.invoices.projectNamePlaceholder} className={input} />
                <button type="button" disabled={busy || !newProject.trim()} onClick={createProjectInline} className="tap grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-white hover:bg-brand-strong disabled:opacity-50" title={m.common.save}><IconCheck className="size-4" /></button>
                <button type="button" onClick={() => { setAddingProject(false); setNewProject(""); }} className="tap grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]" title={m.common.cancel}><IconX className="size-4" /></button>
              </div>
            )}
          </div>
        </div>

        {projectId && (
          <div>
            <label className={label}>
              {m.invoices.tasksLabel}
              {taskIds.length > 0 && (
                <span className="ml-2 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-semibold text-brand">
                  {taskIds.length} selectat{taskIds.length !== 1 ? "e" : ""}
                </span>
              )}
            </label>
            {tasks.length === 0 ? (
              <p className="text-sm text-ink-soft">{m.invoices.noTasksInProject}</p>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] p-1">
                {tasks.map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-[var(--color-surface-1)]">
                    <input
                      type="checkbox"
                      checked={taskIds.includes(t.id)}
                      onChange={() => toggleTask(t.id)}
                      className="size-4 shrink-0 rounded border-[var(--color-line)] accent-[var(--color-brand)]"
                    />
                    <span className="text-sm">{t.title}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Items */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold">{m.invoices.rowsLabel}</h2>
          <button onClick={addItem} className="tap rounded-lg bg-brand px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-strong">
            {m.invoices.addRow}
          </button>
        </div>

        <div className="flex flex-col gap-2.5">
          {items.map((it, i) => (
            <div key={i} className="rounded-xl border border-[var(--color-line)] p-3">
              <input
                value={it.description}
                onChange={(e) => setItem(i, { description: e.target.value })}
                placeholder={m.invoices.descPlaceholder}
                className="mb-2 h-10 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
              />
              <div className="flex flex-wrap items-end gap-2">
                <Field label={m.invoices.qtyLabel} w="w-20">
                  <input type="number" inputMode="decimal" step="any" min={0} value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} className="h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm outline-none" />
                </Field>
                <Field label={m.invoices.unitPriceLabel} w="w-28">
                  <input type="number" inputMode="decimal" step="any" min={0} value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} className="h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm outline-none" />
                </Field>
                <Field label={m.invoices.taxLabel} w="w-20">
                  <input type="number" inputMode="decimal" step="any" min={0} value={it.taxRate} onChange={(e) => setItem(i, { taxRate: e.target.value })} className="h-9 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-sm outline-none" />
                </Field>
                <div className="ml-auto text-right">
                  <p className="text-[11px] text-ink-soft">{m.invoices.rowTotal}</p>
                  <p className="font-semibold tabular-nums">{money(totals.lines[i]?.lineTotal ?? 0, currency)}</p>
                </div>
                <button onClick={() => removeItem(i)} className="tap grid size-9 place-items-center rounded-lg border border-[var(--color-line)] text-st-cancelled hover:bg-[var(--color-surface-2)]" title={m.invoices.deleteRow}>
                  <IconTrash className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col items-end gap-1 border-t border-[var(--color-line)] pt-4 text-sm">
          <Row k={m.invoices.subtotal} v={money(totals.subtotal, currency)} />
          <Row k={m.invoices.totalTax} v={money(totals.taxTotal, currency)} />
          <div className="flex w-56 justify-between text-base font-bold">
            <span>{m.invoices.grandTotal}</span>
            <span className="tabular-nums">{money(totals.grandTotal, currency)}</span>
          </div>
        </div>
      </div>

      <div className="card grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
        <div>
          <label className={label}>{m.invoices.notesLabel}</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand" />
        </div>
        <div>
          <label className={label}>{m.invoices.termsLabel}</label>
          <textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={3} className="w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 py-2.5 text-sm outline-none focus:border-brand" />
        </div>
      </div>

      {error && <p className="text-sm text-st-cancelled">{error}</p>}

      <div className="flex flex-wrap gap-3">
        <button onClick={() => submit("DRAFT")} disabled={saving} className="tap h-12 flex-1 rounded-xl border border-[var(--color-line)] font-semibold hover:bg-[var(--color-surface-2)] disabled:opacity-60">
          {saving ? m.common.saving : m.invoices.saveDraft}
        </button>
        <button onClick={() => submit("SENT")} disabled={saving} className="tap h-12 flex-1 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
          {saving ? m.common.saving : m.invoices.saveAndSend}
        </button>
      </div>
    </div>
  );
}

function Field({ label, w, children }: { label: string; w: string; children: React.ReactNode }) {
  return (
    <div className={w}>
      <p className="mb-1 text-[11px] text-ink-soft">{label}</p>
      {children}
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex w-56 justify-between text-ink-soft">
      <span>{k}</span>
      <span className="tabular-nums">{v}</span>
    </div>
  );
}
