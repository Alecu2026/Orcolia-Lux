"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { describeSchedule, parseReminderSchedule } from "@/lib/reminder-schedule";
import Link from "next/link";
import { useRouter } from "next/navigation";
import RowColorPicker from "./RowColorPicker";
import { setTaskColorAction } from "@/app/actions/row-color";
import {
  getTaskRowAction,
  setTaskStatus,
  setTaskProgress,
  updateTaskFieldAction,
  type TaskFieldPatch,
  deleteTask,
  getTaskHistory,
  getTaskComments,
  addTaskCommentAction,
} from "@/app/actions/tasks";
import DataTable, { type Col, type Filter } from "./DataTable";
import { useTaskDataset } from "./useTaskDataset";
import TaskTemplatesDialog from "./TaskTemplatesDialog";
import { releaseTaskTemplateCounterAction, applyTaskTemplateAction } from "@/app/actions/task-templates";
import type { TaskTemplate, TemplatePrefill } from "@/lib/task-template";
import { DateTimePick, EditableSelect, EditableText, MultiPick, PopEditor } from "./InlineCells";
import ExportButton from "./ExportButton";
import ImportButton from "./ImportButton";
import TaskAttachmentsPanel from "./TaskAttachmentsPanel";
import { useProofPrompt } from "./ProofDialog";
import {
  Comments,
  CreateDialog,
  EditDialog,
  STATUSES,
  StatusDropdown,
  Timeline,
  TZ,
  fmtDue,
  withRetry,
  type CommentRow,
  type HistoryRow,
  type Opt,
  type Status,
  type Task,
} from "./TasksManager";
import { useToast } from "./toast";
import { IconPencil, IconTrash, IconX } from "./icons";
import { addDaysToKey, dateKeyOf, formatTime, todayKey, zonedToUtc } from "@/lib/date";
import TicketChat from "./TicketChat";
import { useMessages } from "@/lib/i18n/context";
import type { CategoryLite } from "./types";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";

const PRIO_RANK = { LOW: 1, MEDIUM: 2, HIGH: 3, URGENT: 4 } as const;
/** Prioritatea ca etichetă colorată (se vede și pe rânduri colorate / cu zebră): urgent roșu, ridicată portocaliu, medie albastru, scăzută gri. */
const PRIO_CLS: Record<Task["priority"], string> = {
  LOW: "inline-block rounded-full bg-[var(--color-surface-2)] px-2 py-px text-[10px] font-semibold text-ink-soft ring-1 ring-inset ring-[var(--color-line)]",
  MEDIUM: "inline-block rounded-full bg-brand/15 px-2 py-px text-[10px] font-semibold text-brand",
  HIGH: "inline-block rounded-full bg-st-progress/20 px-2 py-px text-[10px] font-bold text-st-progress",
  URGENT: "inline-block rounded-full bg-st-cancelled/20 px-2 py-px text-[10px] font-bold text-st-cancelled",
};
const OPEN: Status[] = ["NEW", "ASSIGNED", "READ", "IN_PROGRESS", "ON_HOLD", "REVIEW"];
const GROUPS: Record<string, Status[]> = {
  "g:active": OPEN,
  "g:new": ["NEW"],
  "g:closed": ["DONE", "CANCELLED"],
};

/**
 * Date derivate pe rând, calculate o singură dată (rândurile sunt obiecte stabile; la o editare se înlocuiește doar rândul modificat):
 * textul de căutare în litere mici și ziua termenului. Fără ele, fiecare tastă din căutare ar reface zeci de mii de toLowerCase/Intl.
 */
type Derived = { hay: string; due: string | null };
const derivedCache = new WeakMap<Task, Derived>();
function derivedOf(t: Task): Derived {
  let d = derivedCache.get(t);
  if (!d) {
    d = {
      hay: [t.title, t.description, t.address, t.projectName, t.clientName, t.assigneeName, t.teamName, t.creatorName].map((x) => (x ?? "").toLowerCase()).join("\n"),
      due: t.dueAt ? dateKeyOf(new Date(t.dueAt), TZ) : null,
    };
    derivedCache.set(t, d);
  }
  return d;
}

const nowMs = () => Date.now();
/** Cât timp o modificare locală „bate" lista completă sosită de pe server (care ar fi putut fi construită înainte ca modificarea să se salveze). */
const LOCAL_WINS_MS = 20_000;
type Touched = Map<string, { at: number; gone: boolean }>;

/** Lista completă tocmai sosită + rândurile modificate / create / șterse local în ultimele secunde (ele rămân așa cum le vede utilizatorul). */
function mergeLocal(incoming: Task[], cur: Task[], touched: Touched): Task[] {
  const now = nowMs();
  const live = [...touched].filter(([, v]) => now - v.at < LOCAL_WINS_MS);
  if (live.length === 0) return incoming;
  const curById = new Map(cur.map((r) => [r.id, r]));
  const inIncoming = new Set(incoming.map((r) => r.id));
  const keep = new Map(live);
  const out: Task[] = [];
  for (const r of incoming) {
    const t = keep.get(r.id);
    if (!t) out.push(r);
    else if (!t.gone) out.push(curById.get(r.id) ?? r);
  }
  const added = live.filter(([id, v]) => !v.gone && !inIncoming.has(id) && curById.has(id)).map(([id]) => curById.get(id)!);
  return added.length ? [...added, ...out] : out;
}

const iconBtn =
  "tap grid size-5 cursor-pointer place-items-center rounded border border-[var(--color-line)] hover:bg-brand-soft";
const topBtn =
  "tap inline-flex h-7 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]";
const dmy = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });

/**
 * Task-uri / Tickete — tabel dens cu filtre locale (ca la Plătitori): toate task-urile din „scope" vin o dată, iar
 * filtrarea/sortarea/paginarea rulează în browser. Click pe rând = popup cu detalii, atașamente, istoric și comentarii.
 */
export default function TasksTable({
  items,
  scope,
  users,
  teams,
  projects,
  clients = [],
  categories = [],
  canCreate,
  canDelete,
  canExport = true,
  canImport = true,
  canEdit = false,
  userId,
  userTeamIds = [],
  canCreateProject = false,
  quietHoursEnabled = false,
  uploadsEnabled = false,
  initialCreate,
  initialProjectId,
  initialClientId,
  initialTitle,
  initialAddress,
  initialDescription,
  initialTemplateId,
  initialCallPhone,
  initialCallAt,
  initialOpenId,
  scopeOptions,
  basePath = "/tasks",
  createLabel,
  ticketMode = false,
  presetValues,
  dataset,
  templates = [],
  canAssign = false,
  canClose = false,
}: {
  items: Task[];
  scope: string;
  users: Opt[];
  teams: Opt[];
  projects: Opt[];
  clients?: Opt[];
  categories?: CategoryLite[];
  canCreate: boolean;
  canDelete: boolean;
  /** Permisiunile „Export” / „Import” ale paginii (separate de Vizualizare / Creare). */
  canExport?: boolean;
  canImport?: boolean;
  canEdit?: boolean;
  userId?: string;
  /** Echipele utilizatorului: cine e într-o echipă asignată poate lucra pe task (status, progres). */
  userTeamIds?: string[];
  canCreateProject?: boolean;
  quietHoursEnabled?: boolean;
  uploadsEnabled?: boolean;
  initialCreate?: "TASK" | "TICKET" | "WORK_ORDER";
  initialProjectId?: string;
  initialClientId?: string;
  initialTitle?: string;
  /** Adresa plătitorului din apel: completează câmpul „Adresă” la creare. */
  initialAddress?: string;
  initialDescription?: string;
  /** Pornit din pop-up-ul „Apel primit”: șablonul ales, telefonul și momentul apelului (variabilele de plătitor se completează din plătitorul apelului). */
  initialTemplateId?: string;
  initialCallPhone?: string;
  initialCallAt?: string;
  initialOpenId?: string;
  scopeOptions?: { key: string; label: string }[];
  basePath?: "/tasks" | "/tickets";
  createLabel?: string;
  ticketMode?: boolean;
  presetValues?: Record<string, string | undefined>;
  /** Lista e mare: `items` conține doar cele mai noi rânduri, iar restul vine din /api/tasks/dataset (vezi useTaskDataset). `total` = câte sunt în total. */
  dataset?: { total: number };
  /** Șabloanele acestui tip (task-uri sau tichete) și dacă utilizatorul poate seta responsabili în ele. */
  templates?: TaskTemplate[];
  canAssign?: boolean;
  /** „Închidere / finalizare": poate finaliza / anula chiar și task-uri la care nu lucrează. */
  canClose?: boolean;
}) {
  const tr = useT();
  const locale = useLocale();
  const toast = useToast();
  const m = useMessages();
  const [rows, setRows] = useState(items);
  // Câte acțiuni sunt în curs: răspunsul de reîmprospătare al unui rând se aplică doar când nu mai așteaptă nimic (altfel ar anula o modificare mai nouă).
  const inflight = useRef(0);
  const touched = useRef<Touched>(new Map());
  const touch = (id: string, gone = false) => { touched.current.set(id, { at: nowMs(), gone }); };
  // Listă nouă de pe server (ex. după o reîncărcare) → o preluăm; fără efect, direct la randare (modelul recomandat de React).
  const [seenItems, setSeenItems] = useState(items);
  // Lista completă (când pagina a primit doar primele rânduri): înlocuiește rândurile din HTML imediat ce e gata.
  const router = useRouter();
  const ds = useTaskDataset({ enabled: !!dataset, kind: ticketMode ? "TICKET" : "TASK", scope, userId });
  const [seenDs, setSeenDs] = useState<typeof ds.rows>(null);
  if (ds.rows && ds.rows !== seenDs) {
    const incoming = ds.rows as Task[];
    setSeenDs(ds.rows);
    setRows((cur) => mergeLocal(incoming, cur, touched.current));
  }
  if (items !== seenItems) { setSeenItems(items); if (!(dataset && ds.rows)) setRows(items); }
  // ── Șabloane: listă locală, meniul „Șabloane”, fereastra de gestionare și șablonul aplicat în fereastra de creare ──
  const proof = useProofPrompt();
  const [tpls, setTpls] = useState(templates);
  const [tplMenu, setTplMenu] = useState(false);
  const [tplManage, setTplManage] = useState(false);
  const [prefill, setPrefill] = useState<TemplatePrefill | null>(null);
  const prefillCreated = useRef(false);
  async function startFromTemplate(id: string, pickedClientId?: string) {
    setTplMenu(false);
    setTplManage(false);
    if (prefill && !prefillCreated.current) {
      // schimb șablonul în fereastra deschisă: numărul rezervat de cel vechi se eliberează înainte
      const old = prefill;
      await releaseTaskTemplateCounterAction(old.templateId, old.reserved).catch(() => {});
      setTpls((cur) => cur.map((t) => (t.id === old.templateId && t.counter === old.reserved + 1 ? { ...t, counter: old.reserved } : t)));
    }
    const res = await applyTaskTemplateAction(id, { clientId: pickedClientId || initialClientId || undefined, phone: initialCallPhone, callAt: initialCallAt }).catch(() => null);
    if (!res || !res.ok) return toast.error(res && !res.ok ? res.error : m.common.error);
    prefillCreated.current = false;
    setPrefill(res.prefill);
    // numărul din {contor} s-a mărit în șablon: lista locală îl arată corect fără reîncărcare
    setTpls((cur) => cur.map((t) => (t.id === id ? { ...t, counter: res.prefill.reserved + 1 } : t)));
    setCreateType(ticketMode ? "TICKET" : "TASK");
  }
  /** „Fără șablon" în fereastra de creare: formularul revine gol, numărul rezervat se eliberează. */
  async function clearTemplate() {
    if (!prefill) return;
    const old = prefill;
    setPrefill(null);
    if (!prefillCreated.current) {
      await releaseTaskTemplateCounterAction(old.templateId, old.reserved).catch(() => {});
      setTpls((cur) => cur.map((t) => (t.id === old.templateId && t.counter === old.reserved + 1 ? { ...t, counter: old.reserved } : t)));
    }
  }
  function closeCreate() {
    setCreateType(null);
    if (prefill && !prefillCreated.current) {
      // am renunțat: numărul rezervat se eliberează (dacă nimeni n-a mai luat altul între timp)
      void releaseTaskTemplateCounterAction(prefill.templateId, prefill.reserved);
      setTpls((cur) => cur.map((t) => (t.id === prefill.templateId && t.counter === prefill.reserved + 1 ? { ...t, counter: prefill.reserved } : t)));
    }
    setPrefill(null);
  }
  // pornit dintr-un apel cu șablon ales: aplică șablonul o singură dată, cu datele plătitorului
  const templateAutoStarted = useRef(false);
  useEffect(() => {
    if (!initialTemplateId || templateAutoStarted.current) return;
    templateAutoStarted.current = true;
    void startFromTemplate(initialTemplateId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [openId, setOpenId] = useState<string | null>(initialOpenId ?? null);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [createType, setCreateType] = useState<"TASK" | "TICKET" | "WORK_ORDER" | null>(initialCreate ?? null);
  const [statusPending, setStatusPending] = useState<string | null>(null);

  /**
   * Preia de pe server DOAR rândul modificat/creat (câmpuri derivate: clientul proiectului, numele noi etc.), în loc să reîncarce toată lista.
   * Dacă rândul nu mai aparține listei (alt responsabil, alt scop), dispare din tabel — la fel ca după o reîncărcare completă.
   */
  function reconcile(id: string) {
    getTaskRowAction(id, scope, ticketMode ? "TICKET" : "TASK")
      .then((row) => {
        if (row === undefined || inflight.current > 0) return;
        touch(id, !row);
        setRows((cur) => {
          const has = cur.some((x) => x.id === id);
          if (!row) return has ? cur.filter((x) => x.id !== id) : cur;
          return has ? cur.map((x) => (x.id === id ? row : x)) : [row, ...cur];
        });
      })
      .catch(() => {});
  }

  // Editarea câmpurilor: doar cu „Editare". Statusul și progresul: și cei implicați în task (creator, responsabil, echipă) — aceeași regulă ca pe server.
  const CLOSE_ONLY: Status[] = ["DONE", "CANCELLED"];
  const canEditRow = (_t: Task) => canEdit;
  const canWorkRow = (t: Task) =>
    canEdit ||
    (!!userId &&
      (t.creatorId === userId || t.assigneeId === userId || t.extraAssigneeIds.includes(userId) ||
        (!!t.teamId && userTeamIds.includes(t.teamId)) || t.extraTeamIds.some((x) => userTeamIds.includes(x))));

  function changeStatus(id: string, next: Status) {
    const prev = rows;
    if (prev.find((t) => t.id === id)?.status === next) return;
    setStatusPending(id);
    inflight.current++;
    touch(id);
    setRows((cur) => cur.map((t) => (t.id === id ? { ...t, status: next } : t))); // optimist
    setTaskStatus(id, next)
      .then((res) => {
        if (res?.error) {
          setRows(prev);
          // Finalizarea cere o poză / un fișier: o cerem chiar acum, iar după trimitere finalizarea se reia singură.
          if (res.needsProof) proof.ask(id, () => changeStatus(id, next), prev.find((t) => t.id === id)?.projectName);
          else toast.error(tr(res.error));
        } else toast.success(`Status: ${m.status[next]}`);
      })
      .catch(() => { setRows(prev); toast.error(tr(m.common.error)); })
      .finally(() => { inflight.current--; setStatusPending((cur) => (cur === id ? null : cur)); });
  }

  function changeProgress(id: string, progress: number) {
    const prev = rows;
    inflight.current++;
    touch(id);
    setRows((cur) => cur.map((t) => (t.id === id ? { ...t, progress } : t)));
    setTaskProgress(id, progress)
      .then((res) => {
        if (res?.error) { setRows(prev); toast.error(tr(res.error)); }
        else toast.success(`Progres: ${progress}%`);
      })
      .catch(() => { setRows(prev); toast.error(tr(m.common.error)); })
      .finally(() => { inflight.current--; });
  }

  function remove(id: string) {
    if (!confirm(m.tasks.deleteConfirm)) return;
    const prev = rows;
    touch(id, true);
    setRows((cur) => cur.filter((t) => t.id !== id));
    setOpenId((o) => (o === id ? null : o));
    deleteTask(id).then(() => toast.success(m.tasks.deleted)).catch(() => { setRows(prev); toast.error(m.tasks.deleteFailed); });
  }

  /** Editare dintr-un câmp: se schimbă imediat în tabel (optimist), serverul confirmă; la eșec revenim + mesaj. */
  function patchTask(t: Task, patch: TaskFieldPatch, optimistic: Partial<Task>) {
    const prev = rows;
    inflight.current++;
    touch(t.id);
    setRows((cur) => cur.map((x) => (x.id === t.id ? { ...x, ...optimistic } : x)));
    updateTaskFieldAction(t.id, patch)
      .then((res) => {
        if (res?.error) { setRows(prev); toast.error(tr(res.error)); }
        else { inflight.current--; reconcile(t.id); inflight.current++; } // reconciliază câmpurile derivate (ex. clientul proiectului) doar pe acest rând
      })
      .catch(() => { setRows(prev); toast.error(tr(m.common.error)); })
      .finally(() => { inflight.current--; });
  }

  const nameIn = (list: Opt[], id: string) => list.find((o) => o.id === id)?.name ?? null;
  const dash = <span className="text-ink-soft/60">—</span>;
  const now = new Date();
  const overdue = (t: Task) => !!t.dueAt && new Date(t.dueAt) < now && t.status !== "DONE" && t.status !== "CANCELLED";

  /** Culoarea rândului: se salvează în baza de date (se vede la toți, rămâne la reîncărcare); optimist în listă. */
  function setColor(t: Task, color: string | null) {
    const prev = rows;
    setRows((cur) => cur.map((x) => (x.id === t.id ? { ...x, color } : x)));
    setTaskColorAction(t.id, color)
      .then((res) => { if (res?.error) { setRows(prev); toast.error(tr(res.error)); } })
      .catch(() => { setRows(prev); toast.error(tr(m.common.error)); });
  }

  const columns: Col<Task>[] = [
    ...(canEdit ? [{ key: "rc", label: "", minW: 28, render: (t: Task) => <div onClick={(e) => e.stopPropagation()}><RowColorPicker value={t.color ?? null} onChange={(c) => setColor(t, c)} /></div> } satisfies Col<Task>] : []),
    {
      key: "seq", label: "#", minW: 45, sort: (t) => t.seq,
      render: (t) => (
        <button type="button" onClick={() => setOpenId(t.id)} title={tr("Deschide detaliile")} className="dt-ctl cursor-pointer rounded px-0.5 font-mono font-semibold text-brand hover:underline">
          {t.seq != null ? `#${t.seq}` : "↗"}
        </button>
      ),
    },
    {
      key: "title", label: "Titlu", minW: 240, maxW: 340, sticky: true, sort: (t) => t.title,
      render: (t) => (
        <EditableText value={t.title} disabled={!canEditRow(t)} onSave={(v) => patchTask(t, { title: v }, { title: v })} display={<span title={t.title}>{t.title}</span>} />
      ),
    },
    {
      key: "status", label: "Status", minW: 95, sort: (t) => STATUSES.indexOf(t.status),
      render: (t) => (
        <div className="origin-left scale-90" onClick={(e) => e.stopPropagation()}>
          <StatusDropdown status={t.status} pending={statusPending === t.id} disabled={!canWorkRow(t) && !canClose} allowed={canWorkRow(t) ? undefined : CLOSE_ONLY} onChange={(s) => changeStatus(t.id, s)} />
        </div>
      ),
    },
    {
      key: "prio", label: "Prioritate", minW: 80, sort: (t) => PRIO_RANK[t.priority],
      render: (t) => (
        <EditableSelect
          value={t.priority}
          emptyLabel={null}
          disabled={!canEditRow(t)}
          options={(["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map((p) => ({ value: p, label: m.priority[p] }))}
          onChange={(v) => patchTask(t, { priority: v }, { priority: v as Task["priority"] })}
          display={<span className={PRIO_CLS[t.priority]}>{m.priority[t.priority]}</span>}
        />
      ),
    },
    {
      key: "project", label: "Proiect", minW: 130, maxW: 180, sort: (t) => t.projectName,
      render: (t) => (
        <EditableSelect
          value={t.projectId ?? ""}
          disabled={!canEditRow(t)}
          options={projects.map((o) => ({ value: o.id, label: o.name }))}
          onChange={(v) => patchTask(t, { projectId: v || null }, { projectId: v || null, projectName: nameIn(projects, v) })}
          display={t.projectName ?? dash}
        />
      ),
    },
    {
      key: "address", label: "Adresă", minW: 150, maxW: 220, sort: (t) => t.address,
      render: (t) => (
        <EditableText value={t.address ?? ""} allowEmpty disabled={!canEditRow(t)} onSave={(v) => patchTask(t, { address: v || null }, { address: v || null })} display={t.address ? <span title={t.address}>{t.address}</span> : undefined} />
      ),
    },
    {
      key: "client", label: "Client", minW: 130, maxW: 180, sort: (t) => t.clientName,
      render: (t) => (
        <EditableSelect
          value={t.clientId ?? ""}
          disabled={!canEditRow(t)}
          options={clients.map((o) => ({ value: o.id, label: o.name }))}
          onChange={(v) => patchTask(t, { clientId: v || null }, { clientId: v || null, clientName: nameIn(clients, v) })}
          display={t.clientName ?? nameIn(clients, t.clientId ?? "") ?? dash}
        />
      ),
    },
    {
      key: "assignee", label: "Responsabili", minW: 120, maxW: 170, sort: (t) => t.assigneeName ?? t.teamName,
      render: (t) => {
        const names = [t.assigneeName ?? t.teamName, ...t.extraAssigneeIds.map((id) => nameIn(users, id)), ...t.extraTeamIds.map((id) => nameIn(teams, id))].filter(Boolean);
        const display = names.length ? <span title={names.join(", ")}>{names.join(", ")}</span> : dash;
        const selected = [...(t.assigneeId ? [t.assigneeId] : []), ...t.extraAssigneeIds, ...(t.teamId ? [t.teamId] : []), ...t.extraTeamIds];
        return (
          <PopEditor display={display} disabled={!canEditRow(t) || !canAssign} width={260}>
            {(close) => (
              <MultiPick
                groups={[{ label: "Persoane", items: users }, { label: "Echipe", items: teams }]}
                selected={selected}
                onCancel={close}
                onSave={(picked) => {
                  close();
                  const u = picked["Persoane"] ?? [];
                  const tm = picked["Echipe"] ?? [];
                  patchTask(t, { assigneeIds: u, teamIds: tm }, {
                    assigneeId: u[0] ?? null, extraAssigneeIds: u.slice(1), assigneeName: u[0] ? nameIn(users, u[0]) : null,
                    teamId: tm[0] ?? null, extraTeamIds: tm.slice(1), teamName: tm[0] ? nameIn(teams, tm[0]) : null,
                  });
                }}
              />
            )}
          </PopEditor>
        );
      },
    },
    {
      key: "due", label: "Termen", minW: 120, sort: (t) => (t.dueAt ? new Date(t.dueAt).getTime() : null),
      render: (t) => {
        const display = t.dueAt ? <span className={overdue(t) ? "font-semibold text-st-cancelled" : ""} title={overdue(t) ? tr("Termen depășit") : undefined}>{fmtDue(t.dueAt)}</span> : dash;
        const dueDate = t.dueAt ? dateKeyOf(new Date(t.dueAt), TZ) : "";
        const rawTime = t.dueAt ? formatTime(new Date(t.dueAt), TZ) : "";
        return (
          <PopEditor display={display} disabled={!canEditRow(t)} width={240}>
            {(close) => (
              <DateTimePick
                date={dueDate}
                time={rawTime !== "00:00" ? rawTime : ""}
                onCancel={close}
                onSave={(d, tm) => {
                  close();
                  patchTask(t, { dueDate: d || null, dueTime: tm || null }, { dueAt: d ? zonedToUtc(d, tm || "00:00", TZ).toISOString() : null });
                }}
              />
            )}
          </PopEditor>
        );
      },
    },
    {
      key: "progress", label: "%", minW: 50, right: true, sort: (t) => t.progress,
      render: (t) => (
        <div onClick={(e) => e.stopPropagation()}>
          <select value={t.progress} disabled={!canWorkRow(t)} onChange={(e) => changeProgress(t.id, Number(e.target.value))} className="dt-ctl h-4 w-12 cursor-pointer rounded border-0 bg-transparent text-[11px] outline-none disabled:cursor-not-allowed disabled:opacity-60" aria-label={tr("Progres")}>
            {[0, 25, 50, 75, 100].map((p) => <option key={p} value={p}>{p}%</option>)}
          </select>
        </div>
      ),
    },
    {
      key: "cat", label: "Categorie", minW: 110, sort: (t) => t.categoryName,
      render: (t) => (
        <EditableSelect
          value={t.categoryId ?? ""}
          disabled={!canEditRow(t) || categories.length === 0}
          options={categories.map((o) => ({ value: o.id, label: o.name }))}
          onChange={(v) => {
            const c = categories.find((x) => x.id === v);
            patchTask(t, { categoryId: v || null }, { categoryId: v || null, categoryName: c?.name ?? null, categoryColor: c?.color ?? null });
          }}
          display={t.categoryName ? <span className="inline-flex items-center gap-1"><span className="size-1.5 rounded-full" style={{ background: t.categoryColor ?? "#6366f1" }} />{t.categoryName}</span> : dash}
        />
      ),
    },
    {
      key: "desc", label: "Descriere", minW: 240, maxW: 340, defaultHidden: true, sort: (t) => t.description,
      render: (t) => <EditableText value={t.description ?? ""} allowEmpty disabled={!canEditRow(t)} onSave={(v) => patchTask(t, { description: v || null }, { description: v || null })} display={t.description ? <span title={t.description}>{t.description}</span> : undefined} />,
    },
    { key: "type", label: "Tip", minW: 70, defaultHidden: true, sort: (t) => t.type, render: (t) => (t.type === "TICKET" ? m.tasks.typeTicket : m.tasks.typeTask) },
    {
      key: "remind", label: "Reamintire", minW: 90, defaultHidden: true, sort: (t) => t.reminderIntervalMinutes ?? (t.reminderSchedule ? Number.MAX_SAFE_INTEGER : null),
      render: (t) => {
        if (t.reminderSchedule) {
          let text = "";
          try {
            const sch = parseReminderSchedule(JSON.parse(t.reminderSchedule));
            text = sch ? describeSchedule(sch, tr, dateTag(locale)) : "";
          } catch {}
          return text ? <span title={text}>{text}</span> : dash;
        }
        const n = t.reminderIntervalMinutes;
        if (!n) return dash;
        return n >= 1440 ? tr("la {n} zile", { n: Math.round(n / 1440) }) : n >= 60 ? tr("la {n} h", { n: Math.round(n / 60) }) : tr("la {n} min", { n });
      },
    },
    {
      key: "left", label: "Zile până la termen", minW: 90, right: true, defaultHidden: true,
      sort: (t) => (t.dueAt ? Math.round((new Date(t.dueAt).getTime() - now.getTime()) / 86_400_000) : null),
      render: (t) => {
        if (!t.dueAt) return dash;
        const d = Math.round((new Date(t.dueAt).getTime() - now.getTime()) / 86_400_000);
        return <span className={d < 0 && t.status !== "DONE" && t.status !== "CANCELLED" ? "font-semibold text-st-cancelled" : ""}>{d}</span>;
      },
    },
    ...(ticketMode
      ? [{
          key: "chat", label: "💬", minW: 60, sort: (t: Task) => (t.chatUnread ? 1 : 0),
          render: (t: Task) => (t.chatUnread
            ? <button type="button" onClick={() => setOpenId(t.id)} className="cursor-pointer rounded-full bg-brand px-1.5 text-[10px] font-semibold text-white" title={tr("Clientul a scris — deschide conversația")}>{tr("● nou")}</button>
            : t.clientId ? <span className="text-ink-soft/60" title={tr("Cerere cu client: conversația se deschide din detalii")}>💬</span> : <span className="text-ink-soft/40">—</span>),
        } satisfies Col<Task>]
      : []),
    { key: "creator", label: "Creat de", minW: 100, maxW: 140, sort: (t) => t.creatorName, render: (t) => t.creatorName },
    { key: "created", label: "Creat la", minW: 80, sort: (t) => new Date(t.createdAt).getTime(), render: (t) => dmy(t.createdAt) },
    {
      key: "act", label: "", minW: 55,
      render: (t) => (
        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {canEditRow(t) && <button type="button" className={iconBtn} title={m.common.edit} onClick={() => setEditTask(t)}><IconPencil className="size-3" /></button>}
          {canDelete && <button type="button" className={`${iconBtn} text-st-cancelled`} title={m.common.delete} onClick={() => remove(t.id)}><IconTrash className="size-3" /></button>}
        </div>
      ),
    },
  ];

  const filters = useMemo<Filter<Task>[]>(() => {
    const today = todayKey(TZ);
    const dueKey = (t: Task) => derivedOf(t).due;
    return [
      {
        kind: "text", key: "q", label: "Caută", grow: true, placeholder: m.tasks.searchPlaceholder,
        test: (t, v) => {
          const seq = v.match(/^#?(\d+)$/);
          if (seq && t.seq === Number(seq[1])) return true;
          return derivedOf(t).hay.includes(v);
        },
      },
      {
        kind: "select", key: "status", label: m.tasks.filterStatus,
        options: [
          ...(ticketMode
            ? [{ value: "g:active", label: m.tickets.scopeActive }, { value: "g:new", label: m.tickets.scopeNew }, { value: "g:closed", label: m.tickets.scopeClosed }]
            : [{ value: "g:active", label: "Deschise (toate cele active)" }, { value: "g:closed", label: "Închise (finalizate/anulate)" }]),
          ...STATUSES.map((s) => ({ value: s, label: m.status[s] })),
        ],
        test: (t, v) => (v in GROUPS ? GROUPS[v].includes(t.status) : t.status === v),
      },
      {
        kind: "select", key: "prio", label: m.tasks.filterPriority,
        options: (["URGENT", "HIGH", "MEDIUM", "LOW"] as const).map((p) => ({ value: p, label: m.priority[p] })),
        test: (t, v) => t.priority === v,
      },
      {
        kind: "select", key: "assignee", label: m.tasks.filterPerson,
        options: users.map((u) => ({ value: u.id, label: u.name })),
        test: (t, v) => t.assigneeId === v || t.extraAssigneeIds.includes(v),
      },
      { kind: "select", key: "team", label: m.tasks.filterTeam, options: teams.map((x) => ({ value: x.id, label: x.name })), test: (t, v) => t.teamId === v || t.extraTeamIds.includes(v) },
      { kind: "select", key: "proj", label: m.tasks.filterProject, options: projects.map((x) => ({ value: x.id, label: x.name })), test: (t, v) => t.projectId === v },
      ...(clients.length ? [{ kind: "select" as const, key: "client", label: m.tasks.filterClient, options: clients.map((x) => ({ value: x.id, label: x.name })), test: (t: Task, v: string) => t.clientId === v }] : []),
      ...(categories.length ? [{ kind: "select" as const, key: "category", label: m.tasks.filterCategory, options: categories.map((x) => ({ value: x.id, label: x.name })), test: (t: Task, v: string) => t.categoryId === v }] : []),
      {
        kind: "select", key: "due", label: m.tasks.filterDue,
        options: [
          { value: "overdue", label: m.tasks.filterDueOverdue },
          { value: "today", label: m.tasks.filterDueToday },
          { value: "tomorrow", label: m.tasks.filterDueTomorrow },
          { value: "week", label: m.tasks.filterDueWeek },
          { value: "month", label: m.tasks.filterDueMonth },
          { value: "none", label: "Fără termen" },
        ],
        test: (t, v) => {
          const k = dueKey(t);
          if (v === "none") return k == null;
          if (k == null) return false;
          if (v === "overdue") return k < today && t.status !== "DONE" && t.status !== "CANCELLED";
          if (v === "today") return k === today;
          if (v === "tomorrow") return k === addDaysToKey(today, 1, TZ);
          if (v === "week") return k >= today && k <= addDaysToKey(today, 6, TZ);
          return k >= today && k <= addDaysToKey(today, 30, TZ);
        },
      },
      { kind: "date", key: "from", label: "Termen de la", test: (t, v) => { const k = dueKey(t); return !!k && k >= v; } },
      { kind: "date", key: "to", label: "Termen până la", test: (t, v) => { const k = dueKey(t); return !!k && k <= v; } },
    ];
  }, [m, users, teams, projects, clients, categories, ticketMode]);

  const current = openId ? rows.find((t) => t.id === openId) ?? null : null;

  return (
    <>
      {scopeOptions && scopeOptions.length > 0 && (
        <div className="mb-2 flex gap-1.5 overflow-x-auto pb-1">
          {scopeOptions.map((s) => (
            <Link
              key={s.key}
              href={`${basePath}${s.key === "mine" ? "" : `?scope=${s.key}`}`}
              className={`tap shrink-0 cursor-pointer rounded-full px-3 py-1 text-xs font-medium ${scope === s.key ? "bg-brand text-white" : "card text-ink-soft"}`}
            >
              {tr(s.label)}
            </Link>
          ))}
        </div>
      )}
      {dataset && ds.error && !ds.rows && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-st-cancelled/40 bg-st-cancelled/5 px-3 py-1.5 text-xs">
          <span>{tr("Nu am putut încărca toată lista ({v1}); se văd doar cele mai noi rânduri.", { v1: dataset.total.toLocaleString("ro-RO") })}</span>
          <button type="button" onClick={() => window.location.reload()} className="cursor-pointer rounded border border-[var(--color-line)] px-2 py-0.5 font-semibold hover:bg-[var(--color-surface-2)]">{tr("Reîncarcă")}</button>
        </div>
      )}
      <DataTable
        storageKey={`tasks:${basePath}:${scope}`}
        rowColor={(t) => t.color}
        // fără „Editare” rândul nu se poate modifica pe loc: click pe el deschide pagina sarcinii / cererii
        onRowClick={canEdit ? undefined : (t) => router.push(`${t.type === "TICKET" ? "/tickets" : "/tasks"}/${t.id}`)}
        rowClickSkipsControls
        rows={rows}
        columns={columns}
        filters={filters}
        defaultSort={{ key: "created", dir: "desc" }}
        presetValues={presetValues}
        pending={dataset && !ds.rows && !ds.error ? { total: dataset.total } : undefined}
        noun={ticketMode ? tr("cereri") : tr("sarcini")}
        emptyText={m.tasks.noTasks}
        rowClassName={(t) => (overdue(t) ? "bg-st-cancelled/5" : "")}
        toolbar={(view) => (
          <>
            {canExport && <ExportButton entity={ticketMode ? "tickets" : "tasks"} params={{ scope }} filtered={view.filtered} getIds={view.getIds} count={view.count} className={topBtn} />}
            {canImport && canCreate && <ImportButton entity={ticketMode ? "tickets" : "tasks"} className={topBtn} />}
            {canCreate && (
              <div className="relative">
                <button type="button" onClick={() => setTplMenu((o) => !o)} aria-expanded={tplMenu} className={topBtn} title={tr("Creează dintr-un șablon")}>
                  {tr("📋 Șabloane ▾")}
                </button>
                {tplMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setTplMenu(false)} aria-hidden />
                    <div className="absolute right-0 top-full z-50 mt-1 w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] p-1 shadow-xl">
                      <div className="max-h-72 overflow-auto">
                        {tpls.length === 0 && <p className="px-3 py-2 text-xs text-ink-soft">{tr("Niciun șablon încă.")}</p>}
                        {tpls.map((t) => (
                          <button key={t.id} type="button" onClick={() => void startFromTemplate(t.id)} className="flex w-full cursor-pointer flex-col rounded-lg px-3 py-1.5 text-left hover:bg-[var(--color-surface-2)]">
                            <span className="truncate text-xs font-semibold">{t.name}</span>
                            <span className="truncate text-[11px] text-ink-soft">{t.title}</span>
                          </button>
                        ))}
                      </div>
                      <button type="button" onClick={() => { setTplMenu(false); setTplManage(true); }} className="mt-1 w-full cursor-pointer rounded-lg border-t border-[var(--color-line)] px-3 py-1.5 text-left text-xs font-medium text-brand hover:bg-brand-soft">
                        {tr("⚙ Gestionează șabloanele…")}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            {canCreate && (
              <button type="button" onClick={() => { setPrefill(null); setCreateType(ticketMode ? "TICKET" : "TASK"); }} className="tap h-7 cursor-pointer rounded-lg bg-brand px-3 text-[11px] font-semibold text-white hover:bg-brand-strong">
                {createLabel ?? m.tasks.newButton}
              </button>
            )}
          </>
        )}
      />

      {current && (
        <TaskDetailDialog
          task={current}
          basePath={basePath}
          canEdit={canEditRow(current)}
          canDelete={canDelete}
          statusPending={statusPending === current.id}
          canWork={canWorkRow(current)}
          canClose={canClose}
          onStatus={(s) => changeStatus(current.id, s)}
          onProgress={(p) => changeProgress(current.id, p)}
          onEdit={() => { setEditTask(current); }}
          onDelete={() => remove(current.id)}
          onClose={() => setOpenId(null)}
        />
      )}

      {proof.node}
      {tplManage && (
        <TaskTemplatesDialog
          type={ticketMode ? "TICKET" : "TASK"}
          templates={tpls}
          onChange={setTpls}
          users={users}
          teams={teams}
          projects={projects}
          clients={clients}
          categories={categories}
          canAssign={canAssign}
          onUse={(id) => void startFromTemplate(id)}
          onClose={() => setTplManage(false)}
        />
      )}
      {createType && (
        <CreateDialog
          key={prefill ? `${prefill.templateId}:${prefill.reserved}` : "nou"}
          prefill={prefill ?? undefined}
          templates={tpls}
          onPickTemplate={(id, clientId) => void startFromTemplate(id, clientId)}
          onClearTemplate={() => void clearTemplate()}
          initialType={createType}
          users={users}
          teams={teams}
          projects={projects}
          clients={clients}
          categories={categories}
          canCreateProject={canCreateProject}
          canAssign={canAssign}
          quietHoursEnabled={quietHoursEnabled}
          uploadsEnabled={uploadsEnabled}
          initialProjectId={initialProjectId}
          initialClientId={initialClientId}
          initialTitle={initialTitle}
          initialAddress={initialAddress}
          initialDescription={initialDescription}
          onClose={closeCreate}
          onCreated={(id) => {
            prefillCreated.current = true;
            reconcile(id); // noul task apare în tabel (doar rândul lui, nu toată lista)
            setOpenId(id); // și se deschide direct (se afișează când sosește în listă)
          }}
        />
      )}
      {editTask && (
        <EditDialog
          task={editTask}
          users={users}
          teams={teams}
          projects={projects}
          clients={clients}
          categories={categories}
          quietHoursEnabled={quietHoursEnabled}
          canAssign={canAssign}
          onClose={() => setEditTask(null)}
          onSaved={(updated) => {
            touch(updated.id);
            setRows((cur) => cur.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)));
            setEditTask(null);
            reconcile(updated.id);
          }}
        />
      )}
    </>
  );
}

function TaskDetailDialog({
  task: t,
  basePath,
  canEdit,
  canDelete,
  statusPending,
  canWork,
  canClose,
  onStatus,
  onProgress,
  onEdit,
  onDelete,
  onClose,
}: {
  task: Task;
  basePath: "/tasks" | "/tickets";
  canEdit: boolean;
  canDelete: boolean;
  statusPending: boolean;
  canWork: boolean;
  canClose: boolean;
  onStatus: (s: Status) => void;
  onProgress: (p: number) => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const tr = useT();
  const m = useMessages();
  const toast = useToast();
  const [history, setHistory] = useState<HistoryRow[] | undefined>(undefined);
  const [comments, setComments] = useState<CommentRow[] | undefined>(undefined);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let alive = true;
    withRetry(() => getTaskHistory(t.id)).then((r) => alive && setHistory(r as HistoryRow[])).catch(() => alive && setHistory([]));
    withRetry(() => getTaskComments(t.id)).then((r) => alive && setComments(r as CommentRow[])).catch(() => alive && setComments([]));
    return () => { alive = false; };
  }, [t.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function post() {
    const body = draft.trim();
    if (!body) return;
    setPosting(true);
    addTaskCommentAction(t.id, body)
      .then((res) => {
        if (res?.error) { toast.error(tr(res.error)); return; }
        setDraft("");
        getTaskComments(t.id).then((rows) => setComments(rows as CommentRow[]));
        toast.success(m.tasks.commentAdded);
      })
      .finally(() => setPosting(false));
  }

  const miniBtn = "tap inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft";
  const late = !!t.dueAt && new Date(t.dueAt) < new Date() && t.status !== "DONE" && t.status !== "CANCELLED";
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[94dvh] w-full max-w-2xl overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">
              {t.seq != null && <span className="mr-1.5 rounded bg-brand/10 px-1.5 font-mono text-xs font-semibold text-brand">#{t.seq}</span>}
              {t.title}
            </h2>
            <p className="mt-0.5 text-xs text-ink-soft">
              {tr("{v1} · creat de {creatorName} · {v2}", { v1: t.type === "TICKET" ? m.tasks.typeTicket : m.tasks.typeTask, creatorName: t.creatorName, v2: dmy(t.createdAt) })}
            </p>
          </div>
          <button onClick={onClose} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={m.common.close}>
            <IconX className="size-4" />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-1.5 border-y border-[var(--color-line)] py-2">
          <Link href={`${t.type === "TICKET" ? "/tickets" : "/tasks"}/${t.id}`} className="tap inline-flex h-8 cursor-pointer items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">
            {basePath === "/tickets" ? tr("Pagina cererii →") : tr("Pagina sarcinii →")}</Link>
          {canEdit && <button type="button" onClick={onEdit} className={miniBtn}>✎ {m.common.edit}</button>}
          {canDelete && <button type="button" onClick={onDelete} className={`${miniBtn} text-st-cancelled`}>🗑 {m.common.delete}</button>}
          <span className="ml-auto flex items-center gap-2">
            <StatusDropdown status={t.status} pending={statusPending} disabled={!canWork && !canClose} allowed={canWork ? undefined : ["DONE", "CANCELLED"]} onChange={onStatus} />
            <select value={t.progress} disabled={!canWork} onChange={(e) => onProgress(Number(e.target.value))} className="h-7 cursor-pointer rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-1 text-[11px]" aria-label={tr("Progres")}>
              {[0, 25, 50, 75, 100].map((p) => <option key={p} value={p}>{p}%</option>)}
            </select>
          </span>
        </div>

        <Box title={tr("Detalii")}>
          <Item label={tr("Prioritate")} value={<span className={PRIO_CLS[t.priority]}>{m.priority[t.priority]}</span>} />
          <Item label={tr("Termen")} value={t.dueAt ? <span className={late ? "font-semibold text-st-cancelled" : ""}>{fmtDue(t.dueAt)}{late ? tr("· depășit") : ""}</span> : null} />
          <Item label={tr("Responsabil")} value={t.assigneeName ?? t.teamName} />
          <Item label={tr("Proiect")} value={t.projectName} />
          <Item label={tr("Client")} value={t.clientName} />
          <Item label={tr("Adresă")} value={t.address} />
          <Item label={tr("Categorie")} value={t.categoryName ? <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: t.categoryColor ?? "#6366f1" }} />{t.categoryName}</span> : null} />
          {t.description && <div className="px-2.5 py-1.5"><p className="mb-0.5 text-[11px] text-ink-soft">{m.tasks.descriptionLabel}</p><p className="whitespace-pre-wrap text-[13px]">{t.description}</p></div>}
        </Box>

        {t.type === "TICKET" && t.clientId && (
          <Box title={tr("💬 Conversație cu clientul")}>
            <div className="p-2">
              <TicketChat ticketId={t.id} viewer="staff" heightClass="h-72" />
            </div>
          </Box>
        )}

        {t.projectLat != null && t.projectLng != null && (
          <Box title={m.tasks.locationLabel}>
            <div className="flex flex-wrap gap-1.5 p-2">
              <a className={miniBtn} target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${t.projectLat},${t.projectLng}`}>{tr("🗺 Google Maps")}</a>
              <a className={miniBtn} target="_blank" rel="noreferrer" href={`https://waze.com/ul?ll=${t.projectLat},${t.projectLng}&navigate=yes`}>{tr("🚗 Waze")}</a>
              <a className={miniBtn} target="_blank" rel="noreferrer" href={`https://maps.apple.com/?ll=${t.projectLat},${t.projectLng}`}>{tr("🍎 Apple Maps")}</a>
            </div>
          </Box>
        )}

        <Box title={m.tasks.attachmentsTitle}>
          <TaskAttachmentsPanel taskId={t.id} projectName={t.projectName} />
        </Box>

        <Box title={tr("Istoric")}>
          <Timeline rows={history} loading={history === undefined} createdAt={t.createdAt} creatorName={t.creatorName} />
        </Box>

        <Box title={m.tasks.commentSection}>
          <Comments rows={comments} draft={draft} posting={posting} onDraftChange={setDraft} onSubmit={post} />
        </Box>
      </div>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-2.5 overflow-hidden rounded-lg border border-[var(--color-line)]">
      <h3 className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</h3>
      <div className="divide-y divide-[var(--color-line)]">{children}</div>
    </section>
  );
}

function Item({ label, value }: { label: string; value: React.ReactNode }) {
  const empty = value == null || value === "";
  return (
    <div className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
      <span className="shrink-0 text-[11px] text-ink-soft">{label}</span>
      <span className="min-w-0 break-words text-right text-[13px]">{empty ? <span className="text-ink-soft/60">—</span> : value}</span>
    </div>
  );
}
