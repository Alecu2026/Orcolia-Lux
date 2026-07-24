"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveInvoice, type InvoicePayload } from "@/app/actions/invoices";
import { quickCreateClient } from "@/app/actions/clients";
import { money, INVOICE_STATUS, type InvoiceStatusKey } from "./invoice-meta";
import { useToast } from "./toast";
import { IconPlus, IconCheck, IconX } from "./icons";

type Opt = { id: string; name: string };
type ConsumPoint = { label: string; value: string };

export type ApaCanalInitial = {
  id: string;
  status: string;
  issueDate: string;
  dueDate: string;
  clientId: string | null;
  currency: string;
  contPersonal: string;
  sectorNr: string;
  consumAddress: string;
  consumerName: string;
  meterNumber: string;
  meterPrevReading: string;
  meterCurrReading: string;
  isEstimatedVolume: boolean;
  billingPeriodLabel: string;
  apaVolum: string;
  apaTarif: string;
  canalVolum: string;
  canalTarif: string;
  recalculari: string;
  penalitati: string;
  datoriiAvans: string;
  monthlyConsumption: ConsumPoint[];
};

const input =
  "h-11 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand";
const label = "mb-1.5 block text-xs font-semibold text-ink-soft";
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (s: string) => Number(s) || 0;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function ApaCanalInvoiceForm({
  clients,
  currency,
  initial,
  canCreateClient = false,
  defaultTarifApa = 0,
  defaultTarifCanal = 0,
}: {
  clients: Opt[];
  currency: string;
  initial?: ApaCanalInitial;
  canCreateClient?: boolean;
  defaultTarifApa?: number;
  defaultTarifCanal?: number;
}) {
  const router = useRouter();
  const toast = useToast();
  const [clientList, setClientList] = useState<Opt[]>(clients);
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [addingClient, setAddingClient] = useState(false);
  const [newClient, setNewClient] = useState("");
  const [busy, setBusy] = useState(false);

  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? todayStr());
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? "");
  const [contPersonal, setContPersonal] = useState(initial?.contPersonal ?? "");
  const [sectorNr, setSectorNr] = useState(initial?.sectorNr ?? "");
  const [consumAddress, setConsumAddress] = useState(initial?.consumAddress ?? "");
  const [consumerName, setConsumerName] = useState(initial?.consumerName ?? "");
  const [meterNumber, setMeterNumber] = useState(initial?.meterNumber ?? "");
  const [meterPrevReading, setMeterPrevReading] = useState(initial?.meterPrevReading ?? "");
  const [meterCurrReading, setMeterCurrReading] = useState(initial?.meterCurrReading ?? "");
  const [isEstimatedVolume, setIsEstimatedVolume] = useState(initial?.isEstimatedVolume ?? false);
  const [billingPeriodLabel, setBillingPeriodLabel] = useState(initial?.billingPeriodLabel ?? "");

  const [apaVolum, setApaVolum] = useState(initial?.apaVolum ?? "");
  const [apaTarif, setApaTarif] = useState(initial?.apaTarif ?? (defaultTarifApa ? String(defaultTarifApa) : ""));
  const [canalVolum, setCanalVolum] = useState(initial?.canalVolum ?? "");
  const [canalTarif, setCanalTarif] = useState(initial?.canalTarif ?? (defaultTarifCanal ? String(defaultTarifCanal) : ""));

  const [recalculari, setRecalculari] = useState(initial?.recalculari ?? "0");
  const [penalitati, setPenalitati] = useState(initial?.penalitati ?? "0");
  const [datoriiAvans, setDatoriiAvans] = useState(initial?.datoriiAvans ?? "0");

  // Grilă fixă de 12 luni (calculate din data emiterii), ca să fie greu de ratat —
  // în loc de o listă la care trebuie să adaugi manual fiecare lună.
  const monthLabels = useMemo(() => {
    const d = new Date(issueDate || todayStr());
    if (Number.isNaN(d.getTime())) return Array.from({ length: 12 }, (_, i) => String(i + 1));
    return Array.from({ length: 12 }, (_, i) => {
      const dt = new Date(d.getFullYear(), d.getMonth() - (11 - i), 1);
      return String(dt.getMonth() + 1);
    });
  }, [issueDate]);

  const [consumValues, setConsumValues] = useState<string[]>(() => {
    if (initial?.monthlyConsumption?.length) {
      const byLabel = new Map(initial.monthlyConsumption.map((p) => [p.label, p.value]));
      return monthLabels.map((l) => byLabel.get(l) ?? "");
    }
    return Array(12).fill("");
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const lockedStatus: InvoiceStatusKey | null =
    initial && !["DRAFT", "SENT"].includes(initial.status)
      ? (initial.status as InvoiceStatusKey)
      : null;

  async function createClientInline() {
    const n = newClient.trim();
    if (!n) return;
    setBusy(true);
    const res = await quickCreateClient(n);
    setBusy(false);
    if (res.ok) {
      setClientList((l) => [{ id: res.id, name: res.name }, ...l]);
      setClientId(res.id);
      setNewClient("");
      setAddingClient(false);
      toast.success("Client creat");
    } else toast.error(res.error);
  }

  const totals = useMemo(() => {
    const apaSuma = round2(num(apaVolum) * num(apaTarif));
    const canalSuma = round2(num(canalVolum) * num(canalTarif));
    const sumaCalculata = round2(apaSuma + canalSuma);
    const sumaSprePlata = round2(sumaCalculata + num(recalculari) + num(penalitati) + num(datoriiAvans));
    return { apaSuma, canalSuma, sumaCalculata, sumaSprePlata };
  }, [apaVolum, apaTarif, canalVolum, canalTarif, recalculari, penalitati, datoriiAvans]);

  function setConsumValue(i: number, v: string) {
    setConsumValues((prev) => prev.map((x, idx) => (idx === i ? v : x)));
  }

  async function submit(status: "DRAFT" | "SENT" | "PAID" | "CANCELLED" | "OVERDUE") {
    setError("");
    if (!clientId) {
      setError("Alege un client.");
      return;
    }
    setSaving(true);
    const payload: InvoicePayload = {
      id: initial?.id,
      status: lockedStatus ?? status,
      kind: "APA_CANAL",
      issueDate,
      dueDate: dueDate || null,
      clientId: clientId || null,
      projectId: null,
      taskIds: [],
      notes: "",
      terms: "",
      items: [
        { description: "Serviciul de alimentare cu apa", quantity: num(apaVolum), unitPrice: num(apaTarif), taxRate: 0 },
        { description: "Serviciul de canalizare", quantity: num(canalVolum), unitPrice: num(canalTarif), taxRate: 0 },
      ],
      apaCanal: {
        contPersonal,
        sectorNr,
        consumAddress,
        consumerName,
        meterNumber,
        meterPrevReading,
        meterCurrReading,
        isEstimatedVolume,
        billingPeriodLabel,
        recalculari: num(recalculari),
        penalitati: num(penalitati),
        datoriiAvans: num(datoriiAvans),
        monthlyConsumption: monthLabels.map((l, i) => ({ label: l, value: num(consumValues[i]) })),
      },
    };
    const res = await saveInvoice(payload);
    setSaving(false);
    if (!res.ok) {
      setError(res.error ?? "Eroare");
      return;
    }
    router.push("/invoices");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="card flex flex-col gap-4 p-5">
        <h2 className="text-base font-bold">Client și date factură</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Data emiterii</label>
            <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Data limită de achitare</label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={input} />
          </div>
        </div>

        <div>
          <label className={label}>Client</label>
          <div className="flex gap-2">
            <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={input}>
              <option value="">—</option>
              {clientList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {canCreateClient && !addingClient && (
              <button type="button" onClick={() => setAddingClient(true)} className="tap grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--color-line)] text-brand hover:bg-brand-soft" title="Adaugă client">
                <IconPlus className="size-4" />
              </button>
            )}
          </div>
          {addingClient && (
            <div className="mt-2 flex gap-2">
              <input autoFocus value={newClient} onChange={(e) => setNewClient(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createClientInline(); } if (e.key === "Escape") { setAddingClient(false); setNewClient(""); } }}
                placeholder="Nume client…" className={input} />
              <button type="button" disabled={busy || !newClient.trim()} onClick={createClientInline} className="tap grid size-11 shrink-0 place-items-center rounded-xl bg-brand text-white hover:bg-brand-strong disabled:opacity-50"><IconCheck className="size-4" /></button>
              <button type="button" onClick={() => { setAddingClient(false); setNewClient(""); }} className="tap grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"><IconX className="size-4" /></button>
            </div>
          )}
        </div>

        <div>
          <label className={label}>Nume consumator (dacă diferă de numele clientului)</label>
          <input value={consumerName} onChange={(e) => setConsumerName(e.target.value)} placeholder="ex. ANTONIU GHEORGHE TEODOR" className={input} />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Cont personal</label>
            <input value={contPersonal} onChange={(e) => setContPersonal(e.target.value)} placeholder="900616" className={input} />
          </div>
          <div>
            <label className={label}>Sector nr.</label>
            <input value={sectorNr} onChange={(e) => setSectorNr(e.target.value)} placeholder="5sp" className={input} />
          </div>
        </div>

        <div>
          <label className={label}>Adresa locului de consum</label>
          <input value={consumAddress} onChange={(e) => setConsumAddress(e.target.value)} placeholder="or.Cahul, STROESCU, 31" className={input} />
        </div>
      </div>

      <div className="card flex flex-col gap-4 p-5">
        <h2 className="text-base font-bold">Contor și perioadă</h2>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={label}>Numărul contorului</label>
            <input value={meterNumber} onChange={(e) => setMeterNumber(e.target.value)} placeholder="294170" className={input} />
          </div>
          <div>
            <label className={label}>Indicii precedenți</label>
            <input value={meterPrevReading} onChange={(e) => setMeterPrevReading(e.target.value)} placeholder="00647" className={input} />
          </div>
          <div>
            <label className={label}>Indicii actuali</label>
            <input value={meterCurrReading} onChange={(e) => setMeterCurrReading(e.target.value)} placeholder="00660" className={input} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isEstimatedVolume} onChange={(e) => setIsEstimatedVolume(e.target.checked)} className="size-4 accent-[var(--color-brand)]" />
          Volum estimativ
        </label>
        <div>
          <label className={label}>Perioada de calcul</label>
          <input value={billingPeriodLabel} onChange={(e) => setBillingPeriodLabel(e.target.value)} placeholder="IULIE 2026" className={input} />
        </div>
      </div>

      <div className="card flex flex-col gap-4 p-5">
        <h2 className="text-base font-bold">Servicii</h2>
        <div className="rounded-xl border border-[var(--color-line)] p-3">
          <p className="mb-2 text-sm font-semibold">Serviciul de alimentare cu apă</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Volumul, m³</label>
              <input type="number" inputMode="decimal" step="any" value={apaVolum} onChange={(e) => setApaVolum(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Tariful, lei/m³</label>
              <input type="number" inputMode="decimal" step="any" value={apaTarif} onChange={(e) => setApaTarif(e.target.value)} className={input} />
            </div>
          </div>
          <p className="mt-2 text-right text-sm text-ink-soft">Sumă: <strong>{money(totals.apaSuma, currency)}</strong></p>
        </div>
        <div className="rounded-xl border border-[var(--color-line)] p-3">
          <p className="mb-2 text-sm font-semibold">Serviciul de canalizare</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Volumul, m³</label>
              <input type="number" inputMode="decimal" step="any" value={canalVolum} onChange={(e) => setCanalVolum(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Tariful, lei/m³</label>
              <input type="number" inputMode="decimal" step="any" value={canalTarif} onChange={(e) => setCanalTarif(e.target.value)} className={input} />
            </div>
          </div>
          <p className="mt-2 text-right text-sm text-ink-soft">Sumă: <strong>{money(totals.canalSuma, currency)}</strong></p>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={label}>Recalculări</label>
            <input type="number" inputMode="decimal" step="any" value={recalculari} onChange={(e) => setRecalculari(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Penalitate</label>
            <input type="number" inputMode="decimal" step="any" value={penalitati} onChange={(e) => setPenalitati(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Datorii(+)/avans(-)</label>
            <input type="number" inputMode="decimal" step="any" value={datoriiAvans} onChange={(e) => setDatoriiAvans(e.target.value)} className={input} />
          </div>
        </div>

        <div className="flex flex-col items-end gap-1 border-t border-[var(--color-line)] pt-4 text-sm">
          <div className="flex w-64 justify-between text-ink-soft">
            <span>Suma calculată</span>
            <span className="tabular-nums">{money(totals.sumaCalculata, currency)}</span>
          </div>
          <div className="flex w-64 justify-between text-base font-bold">
            <span>Suma spre plată</span>
            <span className="tabular-nums">{money(totals.sumaSprePlata, currency)}</span>
          </div>
        </div>
      </div>

      <div className="card flex flex-col gap-3 p-5">
        <h2 className="text-base font-bold">Consum lunar (grafic pe factură)</h2>
        <p className="-mt-2 text-xs text-ink-soft">
          Volumul (m³) pentru fiecare din ultimele 12 luni, calculate automat de la data emiterii. Lasă gol dacă nu ai date pentru o lună — bara rămâne 0.
        </p>
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
          {monthLabels.map((l, i) => (
            <div key={i}>
              <label className="mb-1 block text-[10px] font-semibold text-ink-soft">Luna {l}</label>
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={consumValues[i]}
                onChange={(e) => setConsumValue(i, e.target.value)}
                placeholder="m³"
                className={input}
              />
            </div>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-st-cancelled">{error}</p>}

      <div className="flex flex-wrap gap-3">
        {lockedStatus ? (
          <button onClick={() => submit(lockedStatus)} disabled={saving} className="tap h-12 flex-1 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
            {saving ? "Se salvează…" : "Salvează"}
          </button>
        ) : (
          <>
            <button onClick={() => submit("DRAFT")} disabled={saving} className="tap h-12 flex-1 rounded-xl border border-[var(--color-line)] font-semibold hover:bg-[var(--color-surface-2)] disabled:opacity-60">
              {saving ? "Se salvează…" : "Salvează ciornă"}
            </button>
            <button onClick={() => submit("SENT")} disabled={saving} className="tap h-12 flex-1 rounded-xl bg-brand font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
              {saving ? "Se salvează…" : "Generează factura"}
            </button>
          </>
        )}
      </div>
      {lockedStatus && (
        <p className="text-center text-xs text-ink-soft">
          Această factură are statusul „{INVOICE_STATUS[lockedStatus].label}" — salvarea modificărilor nu îi schimbă statusul.
        </p>
      )}
    </div>
  );
}
