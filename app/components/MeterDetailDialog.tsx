"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { MeterDetailResponse } from "@/lib/queries/meters";
import InvoiceViewButton from "./InvoiceViewButton";
import { addressKey, enumLabel, type MeterRow, type MeterRowBase } from "@/lib/meters";
import { INVOICE_STATUS, type InvoiceStatusKey } from "./invoice-meta";
import { IconX } from "./icons";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";

const LIST_LIMIT = 40;

const miniBtn =
  "tap inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg border border-[var(--color-line)] px-3 text-xs font-medium hover:bg-brand-soft";

/**
 * Pop-up cu datele unui contor, deschis la click pe rând. Se afișează instant cu ce avem deja în tabel; restul (câmpurile brute din 1C, calculul,
 * consumatorul și istoricul citirilor din toate lunile) se încarcă din urmă și apare când vine. Din el se poate sări la celelalte contoare ale
 * aceluiași abonat și la cele de la aceeași adresă.
 */
export default function MeterDetailDialog({
  row,
  rows,
  canTask,
  canEditInvoices = false,
  taskHref,
  onSelect,
  onClose,
}: {
  row: MeterRowBase;
  /** Lista completă din browser (când e încărcată) — pentru „alte contoare ale abonatului / de la aceeași adresă". */
  rows: MeterRow[] | null;
  canTask: boolean;
  /** Poate edita facturi (invoices.edit) — „Editează” lângă „Vezi”. */
  canEditInvoices?: boolean;
  taskHref: (r: MeterRowBase) => string;
  onSelect: (r: MeterRowBase) => void;
  onClose: () => void;
}) {
  const t = useT();
  const tag = dateTag(useLocale());
  const nf = (n: number) => n.toLocaleString(tag, { maximumFractionDigits: 3 });
  const money = (n: number, cur = "MDL") => `${n.toLocaleString(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur}`;
  const dmy = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join(".") : null);

  // Răspunsul vine pentru un anumit rând; dacă între timp s-a ales alt contor din pop-up, răspunsul vechi se ignoră (state.id ≠ row.id).
  const [state, setState] = useState<{ id: string; detail: MeterDetailResponse | null; error: string | null } | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const invoiceNo = row.invoice?.number;
    fetch(`/api/contoare/detail?id=${encodeURIComponent(row.id)}${invoiceNo ? `&invoice=${encodeURIComponent(invoiceNo)}` : ""}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Eroare.");
        return j as MeterDetailResponse;
      })
      .then((detail) => setState({ id: row.id, detail, error: null }))
      .catch((e: Error) => {
        if (e.name !== "AbortError") setState({ id: row.id, detail: null, error: e.message });
      });
    return () => ctl.abort();
  }, [row.id, row.invoice?.number]);
  const cur = state?.id === row.id ? state : null;
  const detail = cur?.detail ?? null;
  const error = cur?.error ?? null;
  const pending = !cur;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Celelalte contoare ale aceluiași abonat (aceeași înregistrare 1C / același plătitor) și cele de la aceeași adresă.
  const { siblings, sameAddress } = useMemo(() => {
    if (!rows) return { siblings: null, sameAddress: null };
    // Id 1C: „<cheie abonat>~<nr. contor>~<k>” — contoarele aceluiași abonat au aceeași cheie (Axioma: „a:<idClient>”, fără frați).
    const rec = row.id.startsWith("a:") ? null : row.id.slice(0, row.id.lastIndexOf("~", row.id.lastIndexOf("~") - 1));
    const sib = rows.filter(
      (r) => r.id !== row.id && (row.clientId ? r.clientId === row.clientId : rec !== null && r.id.startsWith(`${rec}~`)),
    );
    const sibIds = new Set(sib.map((r) => r.id));
    const key = addressKey(row.address);
    const same = key ? rows.filter((r) => r._a === key && r.id !== row.id && !sibIds.has(r.id)) : [];
    return { siblings: sib, sameAddress: same };
  }, [rows, row]);

  const inv = row.invoice;
  const st = inv ? INVOICE_STATUS[inv.status as InvoiceStatusKey] : null;
  const m = detail?.meter ?? null;
  const rd = detail?.reading ?? null;
  const sub = detail?.subscriber ?? null;
  const cons = detail?.consumer ?? null;
  const hasSub = !!m && !!(m.subAbonat || m.subContract || m.subCont || m.subConsumator || m.subContor);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card max-h-[92dvh] w-full max-w-xl overflow-auto rounded-b-none rounded-t-2xl p-4 sm:rounded-2xl">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-bold">
              {t("Contor")} <span className="font-mono">{row.contor}</span>
            </h2>
            <p className="text-xs text-ink-soft">
              {row.name}
              {" · "}
              {row.account ? t("Cont personal {n}", { n: row.account }) : t("Contract {n}", { n: row.contract ?? "—" })}
              {" · "}
              {row.removedAt ? <span className="text-st-cancelled">{t("scos la {date}", { date: dmy(row.removedAt) ?? "" })}</span> : <span className="text-st-done">{t("activ")}</span>}
            </p>
          </div>
          <button onClick={onClose} className="tap grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg text-ink-soft hover:bg-[var(--color-surface-2)]" aria-label={t("Închide")}>
            <IconX className="size-4" />
          </button>
        </div>

        <div className="mb-3 flex flex-wrap gap-1.5 border-y border-[var(--color-line)] py-2">
          <Link href={`/contoare/${encodeURIComponent(row.id)}`} className="tap inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">
            {t("Pagina contorului →")}
          </Link>
          {row.clientId && (
            <Link href={`/platitori/${row.clientId}`} target="_blank" rel="noreferrer" className="tap inline-flex h-8 cursor-pointer items-center gap-1 rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">
              {t("Pagina plătitorului →")}
            </Link>
          )}
          {canTask && row.clientId && (
            <Link href={taskHref(row)} prefetch={false} className={miniBtn}>
              + {t("Sarcină")}
            </Link>
          )}
        </div>

        <Section title={t("Contor")}>
          <Item label={t("Nr. contor")} value={<span className="font-mono">{row.contor}</span>} />
          <Item label={t("Status")} value={row.removedAt ? <span className="text-st-cancelled">{t("Scos")}</span> : <span className="text-st-done">{t("Activ")}</span>} />
          <Item label={t("Instalat")} value={dmy(row.installedAt)} />
          <Item label={t("Scos la")} value={dmy(row.removedAt)} />
          <Item label={t("Nr. sigiliu")} value={row.sigiliu} />
          <Item label={t("Consumator")} value={row.consumator} />
          <Item label={t("IDNO")} value={row.inn} />
          <Item label={t("Perioada în registrul 1C")} value={dmy(m?.perioada)} loading={pending} />
          <Item label={t("Sursa datelor")} value={row.source === "axioma" ? "Axioma" : "1C"} />
        </Section>

        {hasSub && m && (
          <Section title={t("Sub-abonat / sub-contor (1C)")}>
            <Item label={t("Sub-abonat")} value={m.subAbonat} />
            <Item label={t("Sub-contract")} value={m.subContract} />
            <Item label={t("Sub-cont personal")} value={m.subCont} />
            <Item label={t("Sub-consumator")} value={m.subConsumator} />
            <Item label={t("Sub-contor")} value={m.subContor} />
          </Section>
        )}

        <Section title={t("Ultima citire")}>
          <Item label={t("Citire anterioară")} value={row.prev != null ? `${nf(row.prev)} m³${row.prevDate ? ` · ${dmy(row.prevDate)}` : ""}` : null} />
          <Item label={t("Citire curentă")} value={row.curr != null ? <b>{`${nf(row.curr)} m³${row.currDate ? ` · ${dmy(row.currDate)}` : ""}`}</b> : null} />
          <Item label={t("Consum (m³)")} value={row.consum != null ? <b>{nf(row.consum)} m³</b> : null} />
          <Item label={t("Consum mediu")} value={rd ? `${nf(rd.medie)} m³` : null} loading={pending} />
          <Item label={t("Consum sub-contoare")} value={rd && rd.consumSubcontoare ? `${nf(rd.consumSubcontoare)} m³` : null} loading={pending} />
          <Item label={t("Sursa citirii")} value={enumLabel(row.sursa, t)} />
        </Section>

        <Section title={t("Calcul (document 1C)")}>
          {detail && detail.lines.length > 0 ? (
            <ul className="divide-y divide-[var(--color-line)] text-[13px]">
              {detail.lines.map((l, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
                  <span className="min-w-0">
                    <span className="block">{enumLabel(l.serviciu, t)}</span>
                    <span className="block text-[11px] text-ink-soft">
                      {nf(l.volum)} m³ × {money(l.tarif, "MDL")}/m³
                      {l.data ? ` · ${dmy(l.data)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{money(l.suma, "MDL")}</span>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <Item label={t("Apă")} value={row.apaVol != null || row.apaSum != null ? `${row.apaVol != null ? nf(row.apaVol) : "—"} m³ · ${row.apaSum != null ? money(row.apaSum, "MDL") : "—"}` : null} loading={pending} />
              <Item label={t("Canal")} value={row.canalVol != null || row.canalSum != null ? `${row.canalVol != null ? nf(row.canalVol) : "—"} m³ · ${row.canalSum != null ? money(row.canalSum, "MDL") : "—"}` : null} loading={pending} />
            </>
          )}
        </Section>

        <Section title={t("Abonat")}>
          <Item label={t("Nume")} value={row.name} />
          <Item label={t("Cont personal")} value={row.account} />
          <Item label={t("Contract")} value={row.contract} />
          <Item label={t("Tip")} value={row.person ? t("Persoană fizică") : t("Firmă / instituție")} />
          <Item label={t("Sector")} value={enumLabel(row.sector, t)} />
          <Item label={t("Tip sector (1C)")} value={enumLabel(sub?.tipSector, t)} loading={pending} />
          <Item label={t("Adresă")} value={row.address} />
          <Item label={t("Telefon")} value={row.phone} />
          <Item label={t("Email")} value={row.email} />
          <Item label={t("Cont portal")} value={row.activated ? <span className="text-st-done">{t("activat")}</span> : t("neactivat")} />
          <Item label={t("Contoare active")} value={String(row.meterCount)} />
          <Item label={t("Document 1C")} value={dmy(sub?.dataDoc ?? row.docDate)} loading={pending && !row.docDate} />
          <Item label={t("Calculat (1C)")} value={sub?.calculat != null ? money(sub.calculat) : null} loading={pending} />
          <Item label={t("Datorie / avans (1C)")} value={sub?.datorieAvans != null ? money(sub.datorieAvans) : null} loading={pending} />
          <Item label={t("De achitat (1C)")} value={sub?.deAchitat != null ? <b>{money(sub.deAchitat)}</b> : null} loading={pending} />
        </Section>

        <Section title={t("Factura curentă")}>
          {inv ? (
            <>
              <Item label={t("Număr")} value={inv.number} />
              <Item label={t("Status")} value={st ? <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{t(st.label)}</span> : null} />
              <Item label={t("De achitat")} value={<b>{money(inv.grandTotal, inv.currency)}</b>} />
              <Item label={t("Scadență")} value={dmy(inv.dueDate)} />
              <Item
                label={t("Factura")}
                loading={pending}
                value={
                  detail?.invoice ? (
                    <span className="inline-flex items-center gap-1.5">
                      <InvoiceViewButton token={detail.invoice.publicToken} title={inv.number} className={miniBtn} />
                      {canEditInvoices && (
                        <Link href={`/invoices/${detail.invoice.id}/edit`} className={miniBtn}>{t("Editează")}</Link>
                      )}
                    </span>
                  ) : null
                }
              />
            </>
          ) : (
            <p className="px-2.5 py-2 text-sm text-ink-soft">{t("Nicio factură.")}</p>
          )}
        </Section>

        {(cons || pending) && (
          <Section title={t("Consumator (1C)")}>
            <Item label={t("Nume")} value={cons?.nume} loading={pending} />
            <Item label={t("Zonă presiune apă")} value={cons?.zona} loading={pending} />
            <Item label={t("Sector de deservire")} value={cons?.sector} loading={pending} />
            <Item label={t("Nr. persoane")} value={cons ? String(cons.nrPersoane) : null} loading={pending} />
            <Item label={t("Suprafață")} value={cons ? nf(cons.suprafata) : null} loading={pending} />
            <Item label={t("Început consum")} value={dmy(cons?.inceput)} loading={pending} />
            <Item label={t("Sfârșit consum")} value={dmy(cons?.sfarsit)} loading={pending} />
          </Section>
        )}

        <Section title={detail ? `${t("Istoric citiri")} (${detail.history.length})` : t("Istoric citiri")}>
          {error ? (
            <p className="px-2.5 py-2 text-sm text-st-cancelled">{t(error)}</p>
          ) : pending ? (
            <p className="px-2.5 py-2 text-sm text-ink-soft">{t("Se încarcă…")}</p>
          ) : !detail || detail.history.length === 0 ? (
            <p className="px-2.5 py-2 text-sm text-ink-soft">{t("Nicio citire în istoric.")}</p>
          ) : (
            <ul className="max-h-72 divide-y divide-[var(--color-line)] overflow-y-auto overscroll-contain text-[13px]">
              {detail.history.map((h, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
                  <span className="min-w-0">
                    <span className="block tabular-nums">
                      {nf(h.prev)} → <b>{nf(h.curr)}</b> m³
                    </span>
                    <span className="block text-[11px] text-ink-soft">
                      {dmy(h.currDate) ?? dmy(h.docDate) ?? "—"}
                      {h.sursa ? ` · ${enumLabel(h.sursa, t)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold tabular-nums">{nf(h.consum)} m³</span>
                    <span className="block text-[11px] text-ink-soft">{t("consum")}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {siblings && siblings.length > 0 && (
          <Section title={`${t("Alte contoare ale abonatului")} (${siblings.length})`}>
            <MeterList list={siblings} onSelect={onSelect} dmy={dmy} nf={nf} t={t} />
          </Section>
        )}

        {sameAddress && sameAddress.length > 0 && (
          <Section title={`${t("Alte contoare la aceeași adresă")} (${sameAddress.length})`}>
            <MeterList list={sameAddress} onSelect={onSelect} dmy={dmy} nf={nf} t={t} showName />
          </Section>
        )}
      </div>
    </div>
  );
}

function MeterList({
  list,
  onSelect,
  dmy,
  nf,
  t,
  showName = false,
}: {
  list: MeterRow[];
  onSelect: (r: MeterRowBase) => void;
  dmy: (s: string | null | undefined) => string | null;
  nf: (n: number) => string;
  t: (ro: string, v?: Record<string, string | number>) => string;
  showName?: boolean;
}) {
  return (
    <ul className="max-h-56 divide-y divide-[var(--color-line)] overflow-y-auto overscroll-contain text-[13px]">
      {list.slice(0, LIST_LIMIT).map((r) => (
        <li key={r.id}>
          <button type="button" onClick={() => onSelect(r)} className="flex w-full cursor-pointer items-baseline justify-between gap-3 px-2.5 py-1.5 text-left hover:bg-brand-soft/40">
            <span className="min-w-0">
              <span className="block font-mono font-medium">{r.contor}</span>
              <span className="block truncate text-[11px] text-ink-soft">{showName ? r.name : r.consumator || r.address || "—"}</span>
            </span>
            <span className="shrink-0 text-right text-[11px]">
              {r.removedAt ? <span className="text-st-cancelled">{t("scos la {date}", { date: dmy(r.removedAt) ?? "" })}</span> : <span className="text-st-done">{t("activ")}</span>}
              {r.consum != null && <span className="block text-ink-soft">{t("consum")} {nf(r.consum)}</span>}
            </span>
          </button>
        </li>
      ))}
      {list.length > LIST_LIMIT && <li className="px-2.5 py-1.5 text-[11px] text-ink-soft">{t("… și încă {n}", { n: list.length - LIST_LIMIT })}</li>}
    </ul>
  );
}

/** Casetă cu titlu pe fundal ușor și linie despărțitoare — ca informația să fie delimitată clar (același aspect ca fișa plătitorului). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-2.5 overflow-hidden rounded-lg border border-[var(--color-line)]">
      <h3 className="border-b border-[var(--color-line)] bg-[var(--color-surface-2)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{title}</h3>
      <div className="divide-y divide-[var(--color-line)]">{children}</div>
    </section>
  );
}

/** Un rând „etichetă — valoare", separat de următorul printr-o linie. */
function Item({ label, value, loading }: { label: string; value: React.ReactNode; loading?: boolean }) {
  const empty = value == null || value === "";
  return (
    <div className="flex items-baseline justify-between gap-3 px-2.5 py-1.5">
      <span className="shrink-0 text-[11px] text-ink-soft">{label}</span>
      <span className="min-w-0 break-words text-right text-[13px]">
        {loading ? <span className="text-ink-soft">…</span> : empty ? <span className="text-ink-soft/60">—</span> : value}
      </span>
    </div>
  );
}
