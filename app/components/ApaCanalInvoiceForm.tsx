"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveInvoice, type InvoicePayload } from "@/app/actions/invoices";
import { quickCreateClient } from "@/app/actions/clients";
import { money, INVOICE_STATUS, type InvoiceStatusKey } from "./invoice-meta";
import { useToast } from "./toast";
import { apaCanalDueKey } from "@/lib/apa-canal-due";
import { IconPlus, IconCheck, IconX } from "./icons";
import { useT } from "@/lib/i18n/context";

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

// Formular compact: inputuri joase, spații mici și carduri pe 2–3 coloane, ca să se vadă toată factura deodată.
const input =
  "h-8 w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-surface-2)] px-2 text-[13px] outline-none focus:border-brand";
const label = "mb-0.5 block text-[11px] font-semibold text-ink-soft";
const cardCls = "card flex flex-col gap-2 p-3";
const h2Cls = "text-sm font-bold";
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
  prefilled,
  defaultTarifApa = 0,
  defaultTarifCanal = 0,
}: {
  clients: Opt[];
  currency: string;
  initial?: ApaCanalInitial;
  canCreateClient?: boolean;
  /** Câmpuri completate din fișa plătitorului (factura le avea goale) — arătăm o mențiune lângă ele. */
  prefilled?: { contPersonal?: boolean; consumAddress?: boolean };
  defaultTarifApa?: number;
  defaultTarifCanal?: number;
}) {
  const t = useT();
  const router = useRouter();
  const toast = useToast();
  const [clientList, setClientList] = useState<Opt[]>(clients);
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [addingClient, setAddingClient] = useState(false);
  const [newClient, setNewClient] = useState("");
  const [busy, setBusy] = useState(false);

  const [issueDate, setIssueDate] = useState(initial?.issueDate ?? todayStr());
  // Scadența e mereu ziua de 25 a lunii facturii (nu se alege): se recalculează din data emiterii.
  const dueDate = apaCanalDueKey(issueDate) ?? "";
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
      toast.success(t("Client creat"));
    } else toast.error(t(res.error));
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
      setError(t("Alege un client."));
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
    <div className="flex flex-col gap-2.5">
      <div className="grid items-start gap-2.5 lg:grid-cols-2 xl:grid-cols-3">
        <div className={cardCls}>
          <h2 className={h2Cls}>{t("Client și date factură")}</h2>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label}>{t("Data emiterii")}</label>
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>{t("Data limită de achitare")}</label>
              <input type="date" value={dueDate} readOnly tabIndex={-1} title={t("Scadența este mereu ziua de 25 a lunii facturii")} className={`${input} cursor-not-allowed opacity-80`} />
            </div>
          </div>

          <div>
            <label className={label}>{t("Client")}</label>
            <div className="flex gap-1.5">
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={input}>
                <option value="">—</option>
                {clientList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {canCreateClient && !addingClient && (
                <button type="button" onClick={() => setAddingClient(true)} className="tap grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--color-line)] text-brand hover:bg-brand-soft" title={t("Adaugă client")}>
                  <IconPlus className="size-4" />
                </button>
              )}
            </div>
            {addingClient && (
              <div className="mt-1.5 flex gap-1.5">
                <input autoFocus value={newClient} onChange={(e) => setNewClient(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createClientInline(); } if (e.key === "Escape") { setAddingClient(false); setNewClient(""); } }}
                  placeholder={t("Nume client…")} className={input} />
                <button type="button" disabled={busy || !newClient.trim()} onClick={createClientInline} className="tap grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-white hover:bg-brand-strong disabled:opacity-50"><IconCheck className="size-4" /></button>
                <button type="button" onClick={() => { setAddingClient(false); setNewClient(""); }} className="tap grid size-8 shrink-0 place-items-center rounded-lg border border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"><IconX className="size-4" /></button>
              </div>
            )}
          </div>

          <div>
            <label className={label}>{t("Nume consumator (dacă diferă de client)")}</label>
            <input value={consumerName} onChange={(e) => setConsumerName(e.target.value)} placeholder={t("ex. ANTONIU GHEORGHE TEODOR")} className={input} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={label}>{t("Cont personal")}{prefilled?.contPersonal && <span className="font-normal text-brand"> {t("· din fișa plătitorului")}</span>}</label>
              <input value={contPersonal} onChange={(e) => setContPersonal(e.target.value)} placeholder="900616" className={input} />
            </div>
            <div>
              <label className={label}>{t("Sector nr.")}</label>
              <input value={sectorNr} onChange={(e) => setSectorNr(e.target.value)} placeholder="5sp" className={input} />
            </div>
          </div>

          <div>
            <label className={label}>{t("Adresa locului de consum")}{prefilled?.consumAddress && <span className="font-normal text-brand"> {t("· din fișa plătitorului")}</span>}</label>
            <input value={consumAddress} onChange={(e) => setConsumAddress(e.target.value)} placeholder={t("or.Cahul, STROESCU, 31")} className={input} />
          </div>
        </div>

        <div className={cardCls}>
          <h2 className={h2Cls}>{t("Contor și perioadă")}</h2>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={label}>{t("Nr. contor")}</label>
              <input value={meterNumber} onChange={(e) => setMeterNumber(e.target.value)} placeholder="294170" className={input} />
            </div>
            <div>
              <label className={label}>{t("Indici preced.")}</label>
              <input value={meterPrevReading} onChange={(e) => setMeterPrevReading(e.target.value)} placeholder="00647" className={input} />
            </div>
            <div>
              <label className={label}>{t("Indici actuali")}</label>
              <input value={meterCurrReading} onChange={(e) => setMeterCurrReading(e.target.value)} placeholder="00660" className={input} />
            </div>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <div>
              <label className={label}>{t("Perioada de calcul")}</label>
              <input value={billingPeriodLabel} onChange={(e) => setBillingPeriodLabel(e.target.value)} placeholder={t("IULIE 2026")} className={input} />
            </div>
            <label className="flex h-8 items-center gap-1.5 text-xs">
              <input type="checkbox" checked={isEstimatedVolume} onChange={(e) => setIsEstimatedVolume(e.target.checked)} className="size-3.5 accent-[var(--color-brand)]" />
              {t("Volum estimativ")}
            </label>
          </div>
        </div>

        <div className={cardCls}>
          <h2 className={h2Cls}>{t("Servicii")}</h2>
          <div className="rounded-lg border border-[var(--color-line)] p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">{t("Alimentare cu apă")}</p>
              <p className="text-xs text-ink-soft">{t("Sumă:")} <strong>{money(totals.apaSuma, currency)}</strong></p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>{t("Volum, m³")}</label>
                <input type="number" inputMode="decimal" step="any" value={apaVolum} onChange={(e) => setApaVolum(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>{t("Tarif, lei/m³")}</label>
                <input type="number" inputMode="decimal" step="any" value={apaTarif} onChange={(e) => setApaTarif(e.target.value)} className={input} />
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--color-line)] p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold">{t("Canalizare")}</p>
              <p className="text-xs text-ink-soft">{t("Sumă:")} <strong>{money(totals.canalSuma, currency)}</strong></p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={label}>{t("Volum, m³")}</label>
                <input type="number" inputMode="decimal" step="any" value={canalVolum} onChange={(e) => setCanalVolum(e.target.value)} className={input} />
              </div>
              <div>
                <label className={label}>{t("Tarif, lei/m³")}</label>
                <input type="number" inputMode="decimal" step="any" value={canalTarif} onChange={(e) => setCanalTarif(e.target.value)} className={input} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className={label}>{t("Recalculări")}</label>
              <input type="number" inputMode="decimal" step="any" value={recalculari} onChange={(e) => setRecalculari(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>{t("Penalitate")}</label>
              <input type="number" inputMode="decimal" step="any" value={penalitati} onChange={(e) => setPenalitati(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>{t("Datorii(+)/avans(-)")}</label>
              <input type="number" inputMode="decimal" step="any" value={datoriiAvans} onChange={(e) => setDatoriiAvans(e.target.value)} className={input} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-[var(--color-line)] pt-2 text-sm">
            <span className="text-xs text-ink-soft">{t("Calculată:")} <span className="tabular-nums">{money(totals.sumaCalculata, currency)}</span></span>
            <span className="font-bold">{t("Spre plată:")} <span className="tabular-nums">{money(totals.sumaSprePlata, currency)}</span></span>
          </div>
        </div>

        <div className={`${cardCls} lg:col-span-2 xl:col-span-3`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h2 className={h2Cls}>{t("Consum lunar (grafic pe factură)")}</h2>
            <p className="text-[11px] text-ink-soft">{t("m³ pe ultimele 12 luni (de la data emiterii) · gol = bara rămâne 0")}</p>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-12">
            {monthLabels.map((l, i) => (
              <div key={i}>
                <label className="mb-0.5 block text-[10px] font-semibold text-ink-soft">{t("Luna {l}", { l })}</label>
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
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {error && <p className="text-sm text-st-cancelled">{t(error)}</p>}
        {lockedStatus && (
          <p className="text-xs text-ink-soft">
            {t("Statusul rămâne „{label}” — salvarea nu îl schimbă.", { label: t(INVOICE_STATUS[lockedStatus].label) })}</p>
        )}
        <div className="ml-auto flex gap-2">
          {lockedStatus ? (
            <button onClick={() => submit(lockedStatus)} disabled={saving} className="tap h-9 rounded-lg bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
              {saving ? t("Se salvează…") : t("Salvează")}
            </button>
          ) : (
            <>
              <button onClick={() => submit("DRAFT")} disabled={saving} className="tap h-9 rounded-lg border border-[var(--color-line)] px-4 text-sm font-semibold hover:bg-[var(--color-surface-2)] disabled:opacity-60">
                {saving ? t("Se salvează…") : t("Salvează ciornă")}
              </button>
              <button onClick={() => submit("SENT")} disabled={saving} className="tap h-9 rounded-lg bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-strong disabled:opacity-60">
                {saving ? t("Se salvează…") : t("Generează factura")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
