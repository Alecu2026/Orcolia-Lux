"use client";

import { useState } from "react";
import type { SyncReport, SyncReportRow } from "@/lib/services/apa-canal-import";
import { useT } from "@/lib/i18n/context";

const nf = (n: number) => n.toLocaleString("ro-RO");
const mdl = (n: number | null) => (n === null ? "—" : `${n.toLocaleString("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MDL`);

function matches(r: SyncReportRow, q: string) {
  if (!q) return true;
  const s = q.toLowerCase();
  return (
    r.name.toLowerCase().includes(s) ||
    (r.contPersonal ?? "").includes(s) ||
    (r.contract ?? "").includes(s) ||
    (r.number ?? "").toLowerCase().includes(s)
  );
}

function Section({
  title,
  hint,
  total,
  rows,
  limit,
  tone,
  open,
  render,
}: {
  title: string;
  hint: string;
  total: number;
  rows: SyncReportRow[];
  limit: number;
  tone: string;
  open?: boolean;
  render: (r: SyncReportRow) => React.ReactNode;
}) {
  const t = useT();
  return (
    <details open={open} className="rounded-xl border border-[var(--color-line)]">
      <summary className={`tap flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-semibold ${tone}`}>
        <span>{title}</span>
        <span className="tabular-nums">{nf(total)}</span>
      </summary>
      <div className="border-t border-[var(--color-line)] px-3 py-2">
        <p className="mb-2 text-[11px] text-ink-soft">{hint}</p>
        {total === 0 ? (
          <p className="text-xs text-ink-soft">{t("Niciunul.")}</p>
        ) : (
          <>
            <ul className="flex max-h-72 flex-col divide-y divide-[var(--color-line)] overflow-auto text-xs">
              {rows.map((r, i) => (
                <li key={`${r.number ?? r.name}-${i}`} className="py-1.5">
                  {render(r)}
                </li>
              ))}
              {rows.length === 0 && <li className="py-1.5 text-ink-soft">{t("Nimic nu corespunde căutării.")}</li>}
            </ul>
            {total > limit && (
              <p className="mt-1 text-[11px] text-ink-soft">
                {t("Afișate primele {v1} din {v2}.", { v1: nf(limit), v2: nf(total) })}</p>
            )}
          </>
        )}
      </div>
    </details>
  );
}

function Who({ r }: { r: SyncReportRow }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="font-medium">{r.name || "(fără nume)"}</span>
      <span className="text-ink-soft">
        {r.contPersonal ? `cont ${r.contPersonal}` : r.contract ? `contract ${r.contract} (firmă, fără cont)` : "fără cont"}
        {r.period ? ` · ${r.period}` : ""}
        {r.deAchitat !== null ? ` · ${mdl(r.deAchitat)}` : ""}
      </span>
    </div>
  );
}

/**
 * Raportul detaliat al unei sincronizări: ce a venit din API (câte rânduri în fiecare tabel, la fel ca în
 * Node-RED), apoi, pentru fiecare document, dacă e o factură nouă, una deja existentă identică, una deja
 * existentă dar cu alte valori (și care), sau un document sărit (și de ce).
 */
export default function ApaCanalSyncReport({ report, committed }: { report: SyncReport; committed: boolean }) {
  const tr = useT();
  const [q, setQ] = useState("");
  const { counts } = report;
  const f = (rows: SyncReportRow[]) => rows.filter((r) => matches(r, q.trim()));

  return (
    <div className="mt-3 flex flex-col gap-3 text-sm">
      <div className="rounded-xl border border-[var(--color-line)] p-3">
        <p className="mb-2 font-semibold">{tr("Ce a venit din API")}</p>
        <table className="w-full text-xs">
          <tbody>
            {report.tabele.map((t) => (
              <tr key={t.nume} className="border-b border-[var(--color-line)] last:border-0">
                <td className="py-1 pr-2">
                  {t.ro} <span className="text-ink-soft">({t.nume})</span>
                </td>
                <td className="py-1 text-right font-semibold tabular-nums">{nf(t.randuri)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-ink-soft">
          {tr("Un document = chitanța unui abonat pe o lună. Contoarele, citirile și liniile de calcul sunt mai multe pentru că un abonat poate avea mai multe contoare și mai multe servicii (apă, canal).{v1}", { v1: report.documenteRepetate > 0 ? tr(" Atenție: {n} documente au un UID repetat — se folosește doar ultimul.", { n: nf(report.documenteRepetate) }) : "" })}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-brand-soft p-2 text-center">
          <p className="text-lg font-bold tabular-nums text-brand-strong">{nf(counts.noi)}</p>
          <p className="text-[11px]">{committed ? "Facturi noi scrise" : "Facturi noi (s-ar scrie)"}</p>
        </div>
        <div className="rounded-xl bg-[var(--color-surface-2)] p-2 text-center">
          <p className="text-lg font-bold tabular-nums">{nf(counts.identice)}</p>
          <p className="text-[11px]">{tr("Existente, identice")}</p>
        </div>
        <div className={`rounded-xl p-2 text-center ${counts.diferite ? "bg-st-progress/15" : "bg-[var(--color-surface-2)]"}`}>
          <p className={`text-lg font-bold tabular-nums ${counts.diferite ? "text-st-progress" : ""}`}>{nf(counts.diferite)}</p>
          <p className="text-[11px]">{committed ? "Existente, actualizate" : "Existente, de actualizat"}</p>
        </div>
        <div className={`rounded-xl p-2 text-center ${counts.sarite ? "bg-st-cancelled/10" : "bg-[var(--color-surface-2)]"}`}>
          <p className={`text-lg font-bold tabular-nums ${counts.sarite ? "text-st-cancelled" : ""}`}>{nf(counts.sarite)}</p>
          <p className="text-[11px]">{tr("Sărite")}</p>
        </div>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={tr("Caută după nume, cont personal, contract sau nr. factură…")}
        className="h-10 w-full rounded-xl border border-[var(--color-line)] bg-[var(--color-surface-2)] px-3 text-sm outline-none focus:border-brand"
      />

      <Section
        title={committed ? "Existente, actualizate cu datele din 1C" : "Existente, cu alte valori — se vor actualiza"}
        hint={
          committed
            ? "Factura acestei luni exista deja; valorile ei au fost înlocuite cu cele din 1C (contor, citiri, sume)."
            : "Factura acestei luni există deja, dar 1C trimite acum alte valori. La „Extrage din API” factura se actualizează cu valorile din 1C."
        }
        total={counts.diferite}
        rows={f(report.diferite)}
        limit={report.limita}
        tone="text-st-progress"
        open={counts.diferite > 0}
        render={(r) => (
          <>
            <Who r={r} />
            <table className="mt-1 w-full text-[11px]">
              <thead className="text-ink-soft">
                <tr>
                  <th className="text-left font-normal">{tr("Câmp")}</th>
                  <th className="text-right font-normal">{tr("În API")}</th>
                  <th className="text-right font-normal">{tr("În aplicație")}</th>
                </tr>
              </thead>
              <tbody>
                {r.diffs?.map((d) => (
                  <tr key={d.camp}>
                    <td>{d.camp}</td>
                    <td className="text-right font-semibold tabular-nums">{d.api}</td>
                    <td className="text-right tabular-nums">{d.aplicatie}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      />
      <Section
        title={committed ? "Facturi noi (scrise acum)" : "Facturi noi (s-ar scrie)"}
        hint={tr("Documente pentru care aplicația nu avea încă factură în luna respectivă.")}
        total={counts.noi}
        rows={f(report.noi)}
        limit={report.limita}
        tone="text-brand-strong"
        open={counts.noi > 0 && counts.diferite === 0}
        render={(r) => (
          <>
            <Who r={r} />
            {r.clientNou && <p className="text-[11px] text-brand-strong">{tr("Plătitor nou — nu exista în aplicație.")}</p>}
          </>
        )}
      />
      <Section
        title={tr("Existente și identice")}
        hint={tr("Factura există deja în aplicație pentru aceeași lună, cu aceleași sume și citiri. Nu se schimbă nimic.")}
        total={counts.identice}
        rows={f(report.identice)}
        limit={report.limita}
        tone=""
        render={(r) => <Who r={r} />}
      />
      <Section
        title={tr("Sărite")}
        hint={tr("Documente din API care nu pot deveni factură.")}
        total={counts.sarite}
        rows={f(report.sarite)}
        limit={report.limita}
        tone="text-st-cancelled"
        open={counts.sarite > 0 && counts.diferite === 0 && counts.noi === 0}
        render={(r) => (
          <>
            <Who r={r} />
            <p className="text-[11px] text-st-cancelled">{r.motiv}</p>
          </>
        )}
      />
    </div>
  );
}
