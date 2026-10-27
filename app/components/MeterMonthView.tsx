"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { MeterMonth } from "@/lib/queries/meters";
import { enumLabel } from "@/lib/meters";
import { mapsUrl, shiftPeriod, FAR_METERS, type ReadingDto } from "@/lib/meter-readings";
import { INVOICE_STATUS, type InvoiceStatusKey } from "./invoice-meta";
import InvoiceViewButton from "./InvoiceViewButton";
import { Item, Section } from "./MeterBits";
import { useLocale, useT } from "@/lib/i18n/context";
import { dateTag } from "@/lib/i18n/t";

export type InvoiceLite = {
  id: string;
  number: string;
  status: string;
  total: number;
  currency: string;
  /** ISO */
  issueDate: string;
  dueDate: string | null;
  token: string;
  label: string | null;
};

const btn = "tap inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-[var(--color-line)] px-2.5 text-xs font-medium hover:bg-brand-soft disabled:cursor-default disabled:opacity-40";

/**
 * „Date pe lună": luna curentă implicit, cu trecere la luna anterioară (și mai departe) — tot din datele deja încărcate pe pagină, deci schimbarea
 * lunii e instantanee. Arată citirea lunii (din 1C), citirea din teren (cu locație și poză), calculul pe apă/canal și factura documentului.
 */
export default function MeterMonthView({
  meterId,
  months,
  field,
  invoices,
  currentPeriod,
  canEditInvoices,
  canRead,
}: {
  meterId: string;
  months: MeterMonth[];
  field: ReadingDto[];
  invoices: InvoiceLite[];
  currentPeriod: string;
  canEditInvoices: boolean;
  /** Are „Citiri contoare": poate introduce citirea din teren. */
  canRead: boolean;
}) {
  const t = useT();
  const tag = dateTag(useLocale());
  const fmt = useMemo(() => {
    const n = new Intl.NumberFormat(tag, { maximumFractionDigits: 3 });
    const m = new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return { num: (x: number) => n.format(x), money: (x: number, cur = "MDL") => `${m.format(x)} ${cur}` };
  }, [tag]);
  const dmy = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join(".") : null);
  const monthLabel = (p: string) => {
    const s = new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1).toLocaleDateString(tag, { month: "long", year: "numeric" });
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  // Lunile disponibile: cele cu date (1C / teren) + luna curentă, cele mai noi primele.
  const keys = useMemo(() => {
    const set = new Set<string>([currentPeriod]);
    for (const m of months) set.add(m.month);
    for (const f of field) set.add(f.period);
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [months, field, currentPeriod]);
  const [sel, setSel] = useState(currentPeriod);
  const idx = Math.max(0, keys.indexOf(sel));
  const m = months.find((x) => x.month === sel) ?? null;
  const before = months.find((x) => x.month === shiftPeriod(sel, 1)) ?? null;
  const f = field.find((x) => x.period === sel) ?? null;
  const docMonth = m?.docDate?.slice(0, 7) ?? null;
  const inv = docMonth ? invoices.filter((i) => i.issueDate.slice(0, 7) === docMonth) : [];
  const calcTotal = m && m.lines.length ? m.lines.reduce((s, l) => s + l.suma, 0) : null;
  const delta = m?.consum != null && before?.consum != null ? m.consum - before.consum : null;

  return (
    <Section title={t("Date pe lună")}>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        <button type="button" className={btn} disabled={idx >= keys.length - 1} onClick={() => setSel(keys[idx + 1])} aria-label={t("Luna anterioară")} title={t("Luna anterioară")}>
          ‹
        </button>
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          aria-label={t("Alege luna")}
          className="h-8 min-w-44 appearance-none sel-arrow rounded-lg border border-brand bg-brand/10 pl-2 pr-7 text-sm font-semibold text-brand outline-none"
        >
          {keys.map((k) => (
            <option key={k} value={k}>
              {monthLabel(k)}
              {k === currentPeriod ? ` (${t("luna aceasta")})` : ""}
            </option>
          ))}
        </select>
        <button type="button" className={btn} disabled={idx <= 0} onClick={() => setSel(keys[idx - 1])} aria-label={t("Luna următoare")} title={t("Luna următoare")}>
          ›
        </button>
        {sel !== currentPeriod && (
          <button type="button" className={btn} onClick={() => setSel(currentPeriod)}>
            {t("Luna aceasta")}
          </button>
        )}
        {canRead && sel === currentPeriod && (
          <Link href={`/contoare/citiri?meter=${encodeURIComponent(meterId)}`} className="tap ml-auto inline-flex h-8 items-center rounded-lg bg-brand px-3 text-xs font-semibold text-white hover:bg-brand-strong">
            {f ? t("Corectează citirea din teren") : t("Introdu citirea din teren")}
          </Link>
        )}
      </div>

      {/* indicatori ai lunii */}
      <div className="grid grid-cols-2 gap-px bg-[var(--color-line)] lg:grid-cols-4">
        <Tile label={t("Citire curentă")} value={m?.curr != null ? `${fmt.num(m.curr)} m³` : f ? `${fmt.num(f.value)} m³` : null} sub={m?.currDate ? dmy(m.currDate) : f ? dmy(f.readAt) : null} />
        <Tile
          label={t("Consum (m³)")}
          value={m?.consum != null ? `${fmt.num(m.consum)} m³` : f && f.prevValue != null ? `${fmt.num(f.value - f.prevValue)} m³` : null}
          sub={delta != null ? t("{v} m³ față de luna anterioară", { v: `${delta > 0 ? "+" : ""}${fmt.num(delta)}` }) : null}
        />
        <Tile label={t("Calcul apă + canal")} value={calcTotal != null ? fmt.money(calcTotal) : null} sub={m?.lines.length ? t("{n} servicii", { n: m.lines.length }) : null} />
        <Tile
          label={t("Factura lunii")}
          value={inv[0] ? fmt.money(inv[0].total, inv[0].currency) : null}
          sub={inv[0] ? (INVOICE_STATUS[inv[0].status as InvoiceStatusKey] ? t(INVOICE_STATUS[inv[0].status as InvoiceStatusKey].label) : inv[0].status) : null}
        />
      </div>

      <div className="grid gap-px bg-[var(--color-line)] lg:grid-cols-3">
        <div className="bg-[var(--color-surface)]">
          <h3 className="border-b border-[var(--color-line)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{t("Citirea lunii (1C)")}</h3>
          {m && (m.curr != null || m.prev != null) ? (
            <div className="divide-y divide-[var(--color-line)]">
              <Item label={t("Citire anterioară")} value={m.prev != null ? `${fmt.num(m.prev)} m³${m.prevDate ? ` · ${dmy(m.prevDate)}` : ""}` : null} />
              <Item label={t("Citire curentă")} value={m.curr != null ? <b>{`${fmt.num(m.curr)} m³${m.currDate ? ` · ${dmy(m.currDate)}` : ""}`}</b> : null} />
              <Item label={t("Consum (m³)")} value={m.consum != null ? <b>{fmt.num(m.consum)} m³</b> : null} />
              <Item label={t("Sursa citirii")} value={enumLabel(m.sursa, t)} />
              <Item label={t("Document 1C")} value={dmy(m.docDate)} />
            </div>
          ) : (
            <p className="px-3 py-3 text-sm text-ink-soft">{t("Nicio citire din 1C pentru această lună.")}</p>
          )}
        </div>

        <div className="bg-[var(--color-surface)]">
          <h3 className="border-b border-[var(--color-line)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{t("Citire din teren")}</h3>
          {f ? (
            <div className="divide-y divide-[var(--color-line)]">
              <Item label={t("Index (m³)")} value={<b>{fmt.num(f.value)} m³</b>} />
              <Item label={t("Consum față de citirea anterioară")} value={f.prevValue != null ? `${fmt.num(f.value - f.prevValue)} m³` : null} />
              <Item label={t("Citit de")} value={`${f.userName} · ${new Date(f.readAt).toLocaleString(tag, { dateStyle: "short", timeStyle: "short" })}`} />
              <Item
                label={t("Locație")}
                value={
                  f.lat != null && f.lng != null ? (
                    <span>
                      <a href={mapsUrl(f.lat, f.lng)} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                        {f.lat.toFixed(5)}, {f.lng.toFixed(5)}
                      </a>
                      {f.accuracy != null && <span className="text-ink-soft"> ±{f.accuracy} m</span>}
                      {f.distanceM != null && f.distanceM > FAR_METERS && (
                        <span className="block text-[11px] text-st-progress">{t("La {n} m de locația citirii anterioare", { n: f.distanceM })}</span>
                      )}
                    </span>
                  ) : (
                    t("fără locație")
                  )
                }
              />
              <div className="px-3 py-2.5">
                {f.photoUrl ? (
                  <a href={f.photoUrl} target="_blank" rel="noreferrer" title={t("Deschide poza")}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.photoUrl} alt={t("Poza contorului")} loading="lazy" className="max-h-56 w-full rounded-lg border border-[var(--color-line)] object-cover" />
                  </a>
                ) : (
                  <p className="text-sm text-ink-soft">{t("Fără poză.")}</p>
                )}
              </div>
            </div>
          ) : (
            <p className="px-3 py-3 text-sm text-ink-soft">{sel === currentPeriod ? t("Încă nu s-a citit luna aceasta.") : t("Nicio citire din teren pentru această lună.")}</p>
          )}
        </div>

        <div className="bg-[var(--color-surface)]">
          <h3 className="border-b border-[var(--color-line)] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">{t("Calcul și factură")}</h3>
          {m && m.lines.length > 0 ? (
            <ul className="divide-y divide-[var(--color-line)] text-[13px]">
              {m.lines.map((l, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block">{enumLabel(l.serviciu, t)}</span>
                    <span className="block text-[11px] text-ink-soft">
                      {fmt.num(l.volum)} m³ × {fmt.money(l.tarif)}/m³
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{fmt.money(l.suma)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-3 text-sm text-ink-soft">{t("Niciun calcul pentru această lună.")}</p>
          )}
          {inv.length > 0 && (
            <ul className="divide-y divide-[var(--color-line)] border-t border-[var(--color-line)] text-sm">
              {inv.map((i) => {
                const s = INVOICE_STATUS[i.status as InvoiceStatusKey];
                return (
                  <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{i.number}</span>
                      <span className="block text-[11px] text-ink-soft">
                        {t("emisă")} {dmy(i.issueDate)}
                        {i.dueDate && <> · {t("scadentă")} {dmy(i.dueDate)}</>}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="text-right">
                        <span className="block tabular-nums">{fmt.money(i.total, i.currency)}</span>
                        {s && <span className={`inline-block rounded-full px-1.5 text-[10px] font-medium ${s.cls}`}>{t(s.label)}</span>}
                      </span>
                      <InvoiceViewButton token={i.token} title={`${i.label ?? i.number} · ${i.number}`} className="tap inline-flex h-8 cursor-pointer items-center rounded-lg border border-[var(--color-line)] px-2.5 text-xs font-medium hover:bg-brand-soft" />
                      {canEditInvoices && (
                        <Link href={`/invoices/${i.id}/edit`} className={btn}>
                          {t("Editează")}
                        </Link>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </Section>
  );
}

function Tile({ label, value, sub }: { label: string; value: string | null; sub?: string | null }) {
  return (
    <div className="bg-[var(--color-surface)] px-3 py-2.5">
      <p className="text-[11px] text-ink-soft">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value ?? <span className="text-ink-soft/50">—</span>}</p>
      {sub && <p className="text-[11px] text-ink-soft">{sub}</p>}
    </div>
  );
}
