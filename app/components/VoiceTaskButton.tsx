"use client";

import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { createTaskAction } from "@/app/actions/tasks";
import { quickCreateProject } from "@/app/actions/projects";
import { voiceCreateClient, quickCreateClient } from "@/app/actions/clients";
import { quickDraftInvoice } from "@/app/actions/invoices";
import { useToast } from "./toast";
import { IconX, IconMic } from "./icons";
import MultiAssignPicker from "./MultiAssignPicker";
import type { UniversalVoiceParsed } from "@/lib/validation";
import { useMessages } from "@/lib/i18n/context";

type Phase = "idle" | "rec" | "proc" | "err";
type Opt = { id: string; name: string };

type DialogData = {
  transcript: string;
  parsed: UniversalVoiceParsed;
  context: { users: Opt[]; teams: Opt[]; projects: Opt[]; clients: Opt[] };
};

type Entity = "task" | "ticket" | "project" | "client" | "invoice";

const dlgInput =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";

function chip(active: boolean) {
  return `tap rounded-full px-3 py-1.5 text-sm font-medium border transition-colors ${
    active
      ? "bg-brand text-white border-brand"
      : "border-[var(--color-line)] text-ink-soft hover:border-brand/40"
  }`;
}

function UniversalVoiceDialog({ data, onClose }: { data: DialogData; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const m = useMessages();
  const { parsed, context } = data;

  const ENTITY_LABELS: Record<Entity, string> = {
    task: m.voice.entityTask,
    ticket: m.voice.entityTicket,
    project: m.voice.entityProject,
    client: m.voice.entityClient,
    invoice: m.voice.entityInvoice,
  };

  const [entity, setEntity] = useState<Entity>((parsed.entity as Entity) ?? "task");

  // Task / Ticket fields
  const [title, setTitle] = useState(parsed.title ?? "");
  const [description, setDescription] = useState(parsed.description ?? "");
  const [taskType, setTaskType] = useState<"TASK" | "TICKET">(entity === "ticket" ? "TICKET" : "TASK");
  const [priority, setPriority] = useState(parsed.priority ?? "MEDIUM");
  const [dueDate, setDueDate] = useState(parsed.dueDate ?? "");
  const [dueTime, setDueTime] = useState(parsed.dueTime ?? "");
  const [assigneeId, setAssigneeId] = useState(parsed.assigneeId ?? "");
  const [teamId, setTeamId] = useState(parsed.teamId ?? "");
  const [projectId, setProjectId] = useState(parsed.projectId ?? "");
  const [newProjectName, setNewProjectName] = useState(parsed.newProjectName ?? "");
  const [clientId, setClientId] = useState(parsed.clientId ?? "");
  const [newClientName, setNewClientName] = useState(parsed.newClientName ?? "");

  // Client-only
  const [clientPhone, setClientPhone] = useState(parsed.clientPhone ?? "");
  const [clientEmail, setClientEmail] = useState(parsed.clientEmail ?? "");

  // Project-only
  const [projectDesc, setProjectDesc] = useState(parsed.description ?? "");

  // Invoice
  const [invoiceDueDate, setInvoiceDueDate] = useState(parsed.invoiceDueDate ?? "");
  const [invoiceNotes, setInvoiceNotes] = useState(
    parsed.invoiceNotes ?? parsed.description ?? ""
  );
  const [invoiceItems, setInvoiceItems] = useState(
    parsed.invoiceItems?.length
      ? parsed.invoiceItems.map((i) => ({ description: i.description, qty: i.qty ?? 1, unitPrice: i.unitPrice ?? 0 }))
      : [{ description: "", qty: 1, unitPrice: 0 }]
  );

  const [submitting, setSubmitting] = useState(false);

  // Keep taskType in sync when switching entity
  useEffect(() => {
    setTaskType(entity === "ticket" ? "TICKET" : "TASK");
  }, [entity]);

  async function resolveProject(): Promise<string | null> {
    if (projectId) return projectId;
    if (newProjectName.trim()) {
      const res = await quickCreateProject(newProjectName.trim());
      if (!res.ok) { toast.error(`${m.voice.entityProject}: ${res.error}`); return null; }
      toast.success(m.voice.projectCreated.replace("{name}", res.name));
      return res.id;
    }
    return null;
  }

  async function resolveClient(): Promise<string | null> {
    if (clientId) return clientId;
    if (newClientName.trim()) {
      const res = await quickCreateClient(newClientName.trim());
      if (res.ok) { toast.success(m.voice.clientCreated.replace("{name}", res.name)); return res.id; }
    }
    return null;
  }

  async function handleTask(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) { toast.error(m.voice.titleRequired); return; }
    setSubmitting(true);
    try {
      const resolvedProjectId = await resolveProject();
      if (resolvedProjectId === null && newProjectName.trim()) { setSubmitting(false); return; }
      await resolveClient();
      // Citim FormData din form — prinde hidden inputs de la MultiAssignPicker (assigneeIds, notifyUntil_*)
      const fd = new FormData(e.currentTarget);
      fd.set("title", title.trim());
      fd.set("type", taskType);
      fd.set("priority", priority);
      fd.set("description", description);
      if (dueDate) fd.set("dueDate", dueDate); else fd.delete("dueDate");
      if (dueTime) fd.set("dueTime", dueTime); else fd.delete("dueTime");
      fd.delete("projectId");
      if (resolvedProjectId) fd.append("projectId", resolvedProjectId);
      const result = await createTaskAction(undefined, fd);
      if (result?.error) { toast.error(result.error); setSubmitting(false); return; }
      toast.success(taskType === "TICKET" ? m.tasks.ticketCreated : m.tasks.taskCreated);
      router.refresh();
      onClose();
    } catch { toast.error(m.voice.createError); setSubmitting(false); }
  }

  async function handleProject(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast.error(m.voice.projectNameRequired); return; }
    setSubmitting(true);
    try {
      const res = await quickCreateProject(title.trim());
      if (!res.ok) { toast.error(res.error); setSubmitting(false); return; }
      toast.success(m.voice.projectCreated.replace("{name}", res.name));
      router.push(`/projects`);
      router.refresh();
      onClose();
    } catch { toast.error(m.voice.createError); setSubmitting(false); }
  }

  async function handleClient(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast.error(m.voice.titleRequired); return; }
    setSubmitting(true);
    try {
      const res = await voiceCreateClient(title.trim(), clientPhone || undefined, clientEmail || undefined);
      if (!res.ok) { toast.error(res.error); setSubmitting(false); return; }
      toast.success(m.voice.clientCreated.replace("{name}", res.name));
      router.push(`/clients`);
      router.refresh();
      onClose();
    } catch { toast.error(m.voice.createError); setSubmitting(false); }
  }

  async function handleInvoice(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      let resolvedClientId = clientId;
      if (!resolvedClientId && newClientName.trim()) {
        const res = await quickCreateClient(newClientName.trim());
        if (res.ok) { resolvedClientId = res.id; toast.success(m.voice.clientCreated.replace("{name}", res.name)); }
      }
      const res = await quickDraftInvoice({
        title: title || invoiceNotes || m.voice.voiceInvoice,
        clientId: resolvedClientId || undefined,
        projectId: projectId || undefined,
        dueDate: invoiceDueDate || undefined,
        notes: invoiceNotes || undefined,
        items: invoiceItems.filter((i) => i.description.trim()),
      });
      if (!res.ok) { toast.error(res.error); setSubmitting(false); return; }
      toast.success(m.voice.invoiceDraftCreated);
      router.push(`/invoices/${res.id}/edit`);
      onClose();
    } catch { toast.error(m.voice.createError); setSubmitting(false); }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    if (entity === "task" || entity === "ticket") return handleTask(e);
    if (entity === "project") return handleProject(e);
    if (entity === "client") return handleClient(e);
    if (entity === "invoice") return handleInvoice(e);
  }

  const submitLabel = submitting
    ? m.voice.creating
    : entity === "task" ? m.voice.createTask
    : entity === "ticket" ? m.voice.createTicket
    : entity === "project" ? m.voice.createProject
    : entity === "client" ? m.voice.createClient
    : m.voice.createInvoiceDraft;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.4)", padding: "16px" }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="card rounded-2xl p-5 shadow-2xl" style={{ width: "100%", maxWidth: "560px", maxHeight: "90vh", overflowY: "auto" }}>
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-base font-bold">{m.voice.confirmTitle}</h2>
            {data.transcript && (
              <p className="mt-0.5 text-xs text-ink-soft">
                „{data.transcript.length > 100 ? `${data.transcript.slice(0, 100)}…` : data.transcript}"
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="tap grid size-9 shrink-0 place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>

        {/* Entity switcher */}
        <div className="mb-4 flex flex-wrap gap-2">
          {(["task", "ticket", "project", "client", "invoice"] as Entity[]).map((e) => (
            <button key={e} type="button" onClick={() => setEntity(e)} className={chip(entity === e)}>
              {ENTITY_LABELS[e]}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* TASK / TICKET */}
          {(entity === "task" || entity === "ticket") && (
            <>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={m.tasks.titlePlaceholder} required autoFocus className={dlgInput} />

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={m.tasks.descriptionPlaceholder}
                rows={2}
                className={`${dlgInput} h-auto resize-none py-2.5`}
              />

              <div className="flex flex-wrap gap-2">
                {(["TASK", "TICKET"] as const).map((t) => (
                  <button key={t} type="button" onClick={() => { setTaskType(t); setEntity(t === "TICKET" ? "ticket" : "task"); }} className={chip(taskType === t)}>
                    {t === "TASK" ? m.voice.entityTask : m.voice.entityTicket}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                {(["LOW", "MEDIUM", "HIGH", "URGENT"] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setPriority(p)} className={chip(priority === p)}>
                    {m.priority[p]}
                  </button>
                ))}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.tasks.metaDue}</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={dlgInput} />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.common.time}</label>
                  <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={dlgInput} />
                </div>
              </div>

              <MultiAssignPicker
                users={context.users}
                teams={context.teams}
                initialAssigneeIds={assigneeId ? [assigneeId] : []}
                initialTeamIds={teamId ? [teamId] : []}
              />

              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.tasks.metaProject}</label>
                {newProjectName && !projectId ? (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate rounded-xl border border-brand/40 bg-brand/5 px-3 py-2.5 text-sm text-brand">{m.voice.newProject.replace("{name}", newProjectName)}</span>
                    <button type="button" onClick={() => setNewProjectName("")} className="tap h-11 shrink-0 rounded-xl border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]">{m.common.cancel}</button>
                  </div>
                ) : (
                  <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={dlgInput}>
                    <option value="">{m.tasks.noProjectEdit}</option>
                    {context.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
              </div>

              {newClientName && (
                <div className="flex items-center justify-between rounded-xl border border-amber-300/40 bg-amber-50 px-3 py-2.5 text-xs dark:bg-amber-500/10">
                  <span className="text-amber-800 dark:text-amber-300">{m.voice.newClientWillBeCreated.replace("{name}", newClientName)}</span>
                  <button type="button" onClick={() => setNewClientName("")} className="tap ml-2 shrink-0 text-ink-soft hover:text-ink">{m.common.cancel}</button>
                </div>
              )}
            </>
          )}

          {/* PROJECT */}
          {entity === "project" && (
            <>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={m.projects.namePlaceholder} required autoFocus className={dlgInput} />
              <textarea value={projectDesc} onChange={(e) => setProjectDesc(e.target.value)} placeholder={m.voice.descriptionOptional} rows={3} className={`${dlgInput} h-auto resize-none py-2.5`} />
              <div className="grid gap-2 sm:grid-cols-2">
                <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={dlgInput}>
                  <option value="">{m.projects.responsibleLabel}…</option>
                  {context.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)} className={dlgInput}>
                  <option value="">{m.projects.teamPlaceholder}</option>
                  {context.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.projects.clientLabelShort}</label>
                {newClientName && !clientId ? (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate rounded-xl border border-brand/40 bg-brand/5 px-3 py-2.5 text-sm text-brand">{m.voice.newClient.replace("{name}", newClientName)}</span>
                    <button type="button" onClick={() => setNewClientName("")} className="tap h-11 shrink-0 rounded-xl border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]">{m.common.cancel}</button>
                  </div>
                ) : (
                  <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={dlgInput}>
                    <option value="">{m.tasks.noClient}</option>
                    {context.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
            </>
          )}

          {/* CLIENT */}
          {entity === "client" && (
            <>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`${m.clients.namePlaceholder}`} required autoFocus className={dlgInput} />
              <input value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} placeholder={`${m.clients.phonePlaceholder} (${m.common.optional})`} type="tel" className={dlgInput} />
              <input value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder={`${m.clients.emailPlaceholder} (${m.common.optional})`} type="email" className={dlgInput} />
            </>
          )}

          {/* INVOICE */}
          {entity === "invoice" && (
            <>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={m.voice.invoiceTitlePh} className={dlgInput} />
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.tasks.metaClient}</label>
                {newClientName && !clientId ? (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate rounded-xl border border-brand/40 bg-brand/5 px-3 py-2.5 text-sm text-brand">{m.voice.newClient.replace("{name}", newClientName)}</span>
                    <button type="button" onClick={() => setNewClientName("")} className="tap h-11 shrink-0 rounded-xl border border-[var(--color-line)] px-3 text-xs text-ink-soft hover:bg-[var(--color-surface-2)]">{m.common.cancel}</button>
                  </div>
                ) : (
                  <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={dlgInput}>
                    <option value="">{m.tasks.noClient}</option>
                    {context.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.tasks.metaProject}</label>
                <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={dlgInput}>
                  <option value="">{m.tasks.noProjectEdit}</option>
                  {context.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.voice.paymentDue}</label>
                <input type="date" value={invoiceDueDate} onChange={(e) => setInvoiceDueDate(e.target.value)} className={dlgInput} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-ink-soft">{m.voice.invoiceLines}</label>
                <div className="flex flex-col gap-1.5">
                  {invoiceItems.map((item, i) => (
                    <div key={i} className="grid grid-cols-[1fr_5rem_6rem_2rem] gap-1.5">
                      <input value={item.description} onChange={(e) => { const n = [...invoiceItems]; n[i] = { ...n[i], description: e.target.value }; setInvoiceItems(n); }} placeholder={m.invoices.descPlaceholder} className={dlgInput} />
                      <input type="number" value={item.qty} min={1} onChange={(e) => { const n = [...invoiceItems]; n[i] = { ...n[i], qty: Number(e.target.value) }; setInvoiceItems(n); }} className={dlgInput} />
                      <input type="number" value={item.unitPrice} min={0} step="0.01" onChange={(e) => { const n = [...invoiceItems]; n[i] = { ...n[i], unitPrice: Number(e.target.value) }; setInvoiceItems(n); }} placeholder={m.voice.price} className={dlgInput} />
                      <button type="button" onClick={() => setInvoiceItems(invoiceItems.filter((_, j) => j !== i))} className="tap grid size-11 place-items-center rounded-xl border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]">
                        <IconX className="size-3.5" />
                      </button>
                    </div>
                  ))}
                  <button type="button" onClick={() => setInvoiceItems([...invoiceItems, { description: "", qty: 1, unitPrice: 0 }])} className="tap h-9 rounded-xl border border-dashed border-[var(--color-line)] text-xs text-ink-soft hover:bg-[var(--color-surface-2)]">
                    {m.voice.addLine}
                  </button>
                </div>
              </div>
              <textarea value={invoiceNotes} onChange={(e) => setInvoiceNotes(e.target.value)} placeholder={m.voice.notesOptional} rows={2} className={`${dlgInput} h-auto resize-none py-2.5`} />
              <p className="text-xs text-ink-soft">{m.voice.draftNote}</p>
            </>
          )}

          <button type="submit" disabled={submitting} className="tap h-12 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {submitLabel}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function VoiceTaskButton() {
  const m = useMessages();
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [dialogData, setDialogData] = useState<DialogData | null>(null);

  useEffect(() => setMounted(true), []);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    setErrMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        await process(new Blob(chunksRef.current, { type: rec.mimeType }));
      };
      recRef.current = rec;
      rec.start();
      setPhase("rec");
    } catch {
      setPhase("err");
      setErrMsg(m.voice.noMicAccess);
    }
  }

  function stop() {
    recRef.current?.stop();
    setPhase("proc");
  }

  async function process(blob: Blob) {
    try {
      const fd = new FormData();
      fd.append("audio", blob, "voice.webm");
      const res = await fetch("/api/voice/task", { method: "POST", body: fd });
      const data = (await res.json()) as { error?: string } & Partial<DialogData>;
      if (!res.ok) throw new Error(data.error ?? m.voice.aiError);
      setPhase("idle");
      setDialogData(data as DialogData);
    } catch (e) {
      setPhase("err");
      setErrMsg(e instanceof Error ? e.message : m.common.error);
    }
  }

  return (
    <>
      <div className="relative">
        <button
          type="button"
          onClick={phase === "rec" ? stop : start}
          disabled={phase === "proc"}
          title={phase === "rec" ? m.voice.stopRecording : m.voice.voiceCommandTitle}
          aria-label={m.voice.voiceCommand}
          className={`tap grid size-11 place-items-center rounded-xl ${
            phase === "rec"
              ? "animate-pulse bg-st-cancelled text-white"
              : "bg-[var(--color-surface-2)] text-ink hover:bg-brand-soft"
          }`}
        >
          {phase === "proc" ? (
            <span className="text-xs font-medium leading-none">…</span>
          ) : (
            <IconMic className="size-5" />
          )}
        </button>
        {phase === "err" && errMsg && (
          <span className="absolute right-0 top-12 z-30 w-52 rounded-lg bg-st-cancelled px-2.5 py-1.5 text-xs text-white shadow-lg">
            {errMsg}
          </span>
        )}
      </div>

      {dialogData && mounted && createPortal(
        <UniversalVoiceDialog
          data={dialogData}
          onClose={() => {
            setDialogData(null);
            setPhase("idle");
          }}
        />,
        document.body
      )}
    </>
  );
}
