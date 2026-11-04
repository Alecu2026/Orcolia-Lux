"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useT } from "@/lib/i18n/context";

type Opt = { id: string; name: string };

export type ReportFilterValues = {
  kind: "tickets" | "tasks";
  from: string;
  to: string;
  sec: string;
  team: string;
  who: string;
  status: string;
  svc: string;
  cons: string;
  orig: string;
};

const sel = (on: boolean) =>
  `h-8 appearance-none sel-arrow rounded-lg border pl-2 pr-7 text-xs outline-none focus:border-brand ${on ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`;
const inp = (on: boolean) =>
  `h-8 rounded-lg border px-2 text-xs outline-none focus:border-brand ${on ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] bg-[var(--color-surface)]"}`;

const STATUS_OPTS: [string, string][] = [["NEW", "Nou"], ["ASSIGNED", "Asignat"], ["READ", "Citit"], ["IN_PROGRESS", "În lucru"], ["ON_HOLD", "În așteptare"], ["REVIEW", "Verificare"], ["DONE", "Finalizat"], ["CANCELLED", "Anulat"]];
const SVC_OPTS: [string, string][] = [["WATER", "Apă"], ["SEWER", "Canalizare"], ["BOTH", "Apă + canalizare"], ["NONE", "Tip serviciu: nespecificat"]];
const CONS_OPTS: [string, string][] = [["HOUSEHOLD", "Casnic"], ["NON_HOUSEHOLD", "Non casnic"], ["NONE", "Tip consumator: nespecificat"]];
const ORIG_OPTS: [string, string][] = [["PORTAL", "Portal clienți"], ["INTERNAL", "Creată de noi (CRM)"], ["EMAIL", "Email"]];

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Filtrele paginii Rapoarte: orice schimbare reîncarcă raportul cu filtrele noi (adresa se actualizează, deci raportul și descărcările PDF / Excel rămân la aceleași filtre).
 */
export default function ReportFilters({
  value,
  kinds,
  sections,
  teams,
  users,
}: {
  value: ReportFilterValues;
  kinds: { tickets: boolean; tasks: boolean };
  sections: Opt[];
  teams: Opt[];
  users: Opt[];
}) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const [pending, startTransition] = useTransition();
  const [v, setV] = useState(value);

  function apply(next: Partial<ReportFilterValues>) {
    const n = { ...v, ...next };
    setV(n);
    const sp = new URLSearchParams();
    for (const [k, val] of Object.entries(n)) if (val) sp.set(k, val);
    sp.set("f", "1"); // filtre alese de utilizator (fără asta se aplică luna curentă)
    startTransition(() => router.replace(`${path}?${sp}`));
  }

  const now = new Date();
  const presets: [string, string, string][] = [
    [t("Luna aceasta"), dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), dayKey(now)],
    [t("Luna trecută"), dayKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)), dayKey(new Date(now.getFullYear(), now.getMonth(), 0))],
    [t("Trimestrul curent"), dayKey(new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)), dayKey(now)],
    [t("Anul acesta"), dayKey(new Date(now.getFullYear(), 0, 1)), dayKey(now)],
    [t("Toată perioada"), "", ""],
  ];
  const any = !!(v.from || v.to || v.sec || v.team || v.who || v.status || v.svc || v.cons || v.orig);

  return (
    <div className={`mb-3 flex flex-col gap-2 transition-opacity ${pending ? "opacity-60" : ""}`} data-report-filters="">
      <div className="flex flex-wrap items-center gap-1.5">
        {(["tickets", "tasks"] as const).filter((k) => kinds[k]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => apply({ kind: k })}
            aria-pressed={v.kind === k}
            className={`tap h-8 cursor-pointer rounded-lg border px-3 text-xs font-semibold ${v.kind === k ? "border-brand bg-brand text-white" : "border-[var(--color-line)] bg-[var(--color-surface)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}
          >
            {k === "tickets" ? t("Cereri") : t("Sarcini")}
          </button>
        ))}
        <span className="mx-1 text-xs text-ink-soft">{t("Perioada creării:")}</span>
        <input type="date" value={v.from} onChange={(e) => apply({ from: e.target.value })} aria-label={t("de la")} className={inp(!!v.from)} />
        –
        <input type="date" value={v.to} onChange={(e) => apply({ to: e.target.value })} aria-label={t("până la")} className={inp(!!v.to)} />
        {presets.map(([label, f, to]) => (
          <button key={label} type="button" onClick={() => apply({ from: f, to })} className={`tap h-8 cursor-pointer rounded-lg border px-2 text-[11px] ${v.from === f && v.to === to ? "border-brand bg-brand/10 font-semibold text-brand" : "border-[var(--color-line)] text-ink-soft hover:bg-[var(--color-surface-2)]"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {sections.length > 0 && (
          <select value={v.sec} onChange={(e) => apply({ sec: e.target.value })} className={sel(!!v.sec)} aria-label={t("Secție")}>
            <option value="">{t("Secție: toate")}</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {teams.length > 0 && (
          <select value={v.team} onChange={(e) => apply({ team: e.target.value })} className={sel(!!v.team)} aria-label={t("Echipă")}>
            <option value="">{t("Echipă: toate")}</option>
            {teams.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        <select value={v.who} onChange={(e) => apply({ who: e.target.value })} className={sel(!!v.who)} aria-label={t("Responsabil")}>
          <option value="">{t("Responsabil: toți")}</option>
          {users.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={v.status} onChange={(e) => apply({ status: e.target.value })} className={sel(!!v.status)} aria-label={t("Status")}>
          <option value="">{t("Status: toate")}</option>
          {STATUS_OPTS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </select>
        <select value={v.svc} onChange={(e) => apply({ svc: e.target.value })} className={sel(!!v.svc)} aria-label={t("Tip serviciu")}>
          <option value="">{t("Tip serviciu: toate")}</option>
          {SVC_OPTS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </select>
        <select value={v.cons} onChange={(e) => apply({ cons: e.target.value })} className={sel(!!v.cons)} aria-label={t("Tip consumator")}>
          <option value="">{t("Tip consumator: toate")}</option>
          {CONS_OPTS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </select>
        <select value={v.orig} onChange={(e) => apply({ orig: e.target.value })} className={sel(!!v.orig)} aria-label={t("Origine")}>
          <option value="">{t("Origine: toate")}</option>
          {ORIG_OPTS.map(([k, l]) => <option key={k} value={k}>{t(l)}</option>)}
        </select>
        {any && (
          <button type="button" onClick={() => apply({ from: "", to: "", sec: "", team: "", who: "", status: "", svc: "", cons: "", orig: "" })} className="tap h-8 cursor-pointer rounded-lg border border-[var(--color-line)] px-2 text-[11px] text-ink-soft hover:bg-[var(--color-surface-2)]">
            {t("Resetează filtrele")}
          </button>
        )}
        {pending && <span className="text-xs text-ink-soft">{t("se încarcă…")}</span>}
      </div>
    </div>
  );
}
