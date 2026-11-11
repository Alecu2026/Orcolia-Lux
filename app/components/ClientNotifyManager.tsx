"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listClientTargetsAction, type ClientTargetRow } from "@/app/actions/notify-schedules";
import { createPayerTemplateAction } from "@/app/actions/payer-templates";
import { buildVars, type PayerTemplate, type PayerTemplateDraft } from "@/lib/payer-notify";
import { useT } from "@/lib/i18n/context";
import PayerNotifyDialog, { type Recipient } from "./PayerNotifyDialog";
import { useToast } from "./toast";

/**
 * Notificări către CLIENȚI (cei obișnuiți din CRM, fără plătitorii din 1C): căutare după nume / telefon / email, filtru pe datele de contact, bifare (sau „toți din filtru”),
 * apoi același formular de trimitere ca la plătitori — email / SMS / apel, acum sau PROGRAMAT (o dată, zilnic, săptămânal, lunar, la interval). Mesajele apar în Jurnalul de notificări.
 */

const PER_PAGE = 50;
const SAMPLE = buildVars({ name: "Ion Popescu", account: null, amount: null, currency: null, invoiceNumber: null, dueDate: null, address: "str. Exemplu 1" });

const fld = "h-9 rounded-lg border border-[var(--color-line)] bg-[var(--color-surface)] px-2 text-sm outline-none focus:border-brand";

export default function ClientNotifyManager({
  initialTemplates,
  canSend,
  emailEnabled,
  smsEnabled,
  callEnabled,
  userEmail,
}: {
  initialTemplates: PayerTemplate[];
  canSend: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  callEnabled: boolean;
  userEmail: string;
}) {
  const t = useT();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [contact, setContact] = useState<"" | "any" | "email" | "phone" | "both">("any");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<ClientTargetRow[]>([]);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Map<string, number>>(new Map());
  const [compose, setCompose] = useState<Recipient[] | null>(null);
  const [templates, setTemplates] = useState(initialTemplates);
  const token = useRef(0);

  const criteria = useMemo(() => ({ q: q.trim(), contact }), [q, contact]);

  // lista paginii: după o scurtă pauză de la ultima tastă
  useEffect(() => {
    const mine = ++token.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await listClientTargetsAction(criteria, page, PER_PAGE);
        if (mine !== token.current) return;
        if (r.ok) {
          setRows(r.rows);
          setTotal(r.total);
          setTruncated(r.truncated);
        } else {
          toast.error(t(r.error));
        }
      } catch {
        if (mine === token.current) toast.error(t("Nu am putut încărca lista. Încearcă din nou."));
      } finally {
        if (mine === token.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteria, page]);

  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(r: ClientTargetRow) {
    setSelected((cur) => {
      const n = new Map(cur);
      if (n.has(r.id)) n.delete(r.id);
      else n.set(r.id, r.flags);
      return n;
    });
  }

  function togglePage() {
    setSelected((cur) => {
      const n = new Map(cur);
      if (allOnPage) for (const r of rows) n.delete(r.id);
      else for (const r of rows) n.set(r.id, r.flags);
      return n;
    });
  }

  const selectAll = useCallback(async () => {
    setLoading(true);
    try {
      const r = await listClientTargetsAction(criteria, 1, 0);
      if (!r.ok) {
        toast.error(t(r.error));
        return;
      }
      setSelected(new Map(r.rows.map((x) => [x.id, x.flags] as [string, number])));
      toast.success(t("{n} clienți selectați.", { n: r.rows.length.toLocaleString("ro-RO") }));
    } catch {
      toast.error(t("Nu am putut selecta lista. Încearcă din nou."));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteria]);

  function createTemplate(d: PayerTemplateDraft) {
    const tmp = `tmp-${Date.now().toString(36)}`;
    setTemplates((ts) => [{ id: tmp, ...d }, ...ts]);
    createPayerTemplateAction(d)
      .then((res) => {
        if (res.ok) setTemplates((ts) => ts.map((x) => (x.id === tmp ? res.template : x)));
        else {
          setTemplates((ts) => ts.filter((x) => x.id !== tmp));
          toast.error(t(res.error));
        }
      })
      .catch(() => {
        setTemplates((ts) => ts.filter((x) => x.id !== tmp));
        toast.error(t("Nu am putut salva șablonul."));
      });
  }

  const selCount = selected.size;
  const chip = (flags: number) => (
    <span className="inline-flex gap-1 text-[10px]">
      <span className={flags & 1 ? "text-st-done" : "text-ink-soft/50"}>✉</span>
      <span className={flags & 2 ? "text-st-done" : "text-ink-soft/50"}>☎</span>
    </span>
  );

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder={t("Caută client (nume, telefon, email)…")}
          className={`${fld} min-w-52 flex-1`}
          aria-label={t("Căutare")}
        />
        <select
          value={contact}
          onChange={(e) => {
            setContact(e.target.value as typeof contact);
            setPage(1);
          }}
          className={fld}
          aria-label={t("Date de contact")}
        >
          <option value="">{t("Contact: toți")}</option>
          <option value="any">{t("Cu email sau telefon")}</option>
          <option value="email">{t("Cu email")}</option>
          <option value="phone">{t("Cu telefon")}</option>
          <option value="both">{t("Cu email și telefon")}</option>
        </select>
        <button type="button" onClick={() => void selectAll()} disabled={total === 0 || loading} className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-sm text-ink-soft hover:bg-[var(--color-surface-2)] disabled:opacity-40">
          {t("Selectează toți cei {n} din filtru", { n: total.toLocaleString("ro-RO") })}
        </button>
        {selCount > 0 && (
          <button type="button" onClick={() => setSelected(new Map())} className="tap h-9 rounded-lg border border-[var(--color-line)] px-3 text-sm text-ink-soft hover:bg-[var(--color-surface-2)]">
            {t("Deselectează ({n})", { n: selCount.toLocaleString("ro-RO") })}
          </button>
        )}
        {canSend && (
          <button
            type="button"
            disabled={selCount === 0}
            onClick={() => setCompose([...selected].map(([id, flags]) => ({ id, flags })))}
            className="tap h-9 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-40"
          >
            ✉ {t("Trimite notificare ({n})", { n: selCount.toLocaleString("ro-RO") })}
          </button>
        )}
      </div>

      <p className="mb-1 text-xs text-ink-soft">
        {t("{n} clienți (fără plătitorii din 1C)", { n: total.toLocaleString("ro-RO") })}
        {truncated ? ` · ${t("se arată primii 25.000")}` : ""}
        {loading ? ` · ${t("se încarcă…")}` : ""}
      </p>

      <div className="overflow-auto rounded-lg border border-[var(--color-line)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--color-surface-2)] text-[11px] text-ink-soft">
            <tr>
              <th className="w-9 px-2 py-1.5"><input type="checkbox" checked={allOnPage} onChange={togglePage} aria-label={t("Selectează pagina")} className="size-4 accent-[var(--color-brand)]" /></th>
              <th className="px-2 py-1.5 font-medium">{t("Client")}</th>
              <th className="px-2 py-1.5 font-medium">{t("Telefon")}</th>
              <th className="px-2 py-1.5 font-medium">{t("Email")}</th>
              <th className="px-2 py-1.5 font-medium">{t("Contact")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`border-t border-[var(--color-line)] ${selected.has(r.id) ? "bg-brand/5" : ""}`}>
                <td className="px-2 py-1"><input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r)} aria-label={r.name} className="size-4 accent-[var(--color-brand)]" /></td>
                <td className="px-2 py-1 font-medium">{r.name}</td>
                <td className="whitespace-nowrap px-2 py-1 text-ink-soft">{r.phone ?? "—"}</td>
                <td className="px-2 py-1 text-ink-soft">{r.email ?? "—"}</td>
                <td className="px-2 py-1">{chip(r.flags)}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-ink-soft">{t("Niciun client pentru filtrele alese.")}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-2 flex items-center justify-center gap-2 text-sm">
          <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="tap h-8 rounded-lg border border-[var(--color-line)] px-3 disabled:opacity-40">‹</button>
          <span className="text-ink-soft">{t("pagina {cur}/{pages}", { cur: page, pages })}</span>
          <button type="button" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="tap h-8 rounded-lg border border-[var(--color-line)] px-3 disabled:opacity-40">›</button>
        </div>
      )}

      {compose && (
        <PayerNotifyDialog
          audience="clients"
          recipients={compose}
          previewName={rows.find((r) => r.id === compose[0]?.id)?.name ?? t("Ion Popescu (exemplu)")}
          previewVars={SAMPLE}
          emailEnabled={emailEnabled}
          smsEnabled={smsEnabled}
          callEnabled={callEnabled}
          userEmail={userEmail}
          templates={templates}
          onSaveTemplate={createTemplate}
          // programarea: dacă sunt bifați TOȚI cei din filtru, se salvează filtrul (destinatarii se recalculează la fiecare rulare); altfel lista fixă de acum
          scheduleTarget={{ filters: total > 0 && compose.length === total ? criteria : null }}
          onClose={() => setCompose(null)}
          onSent={() => {}}
          onSelectFailed={(ids) => {
            const known = new Map(compose.map((r) => [r.id, r.flags]));
            setSelected(new Map(ids.map((id) => [id, known.get(id) ?? 3])));
            setCompose(null);
          }}
        />
      )}
    </div>
  );
}
