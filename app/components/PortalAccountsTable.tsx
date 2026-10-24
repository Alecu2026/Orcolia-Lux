"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import DataTable, { type Col, type Filter } from "./DataTable";
import { useT } from "@/lib/i18n/context";

export type PortalAccountRow = {
  id: string;
  name: string;
  /** Contul personal (meterSeries), dacă are. */
  account: string | null;
  contract: string | null;
  email: string | null;
  activated: boolean;
  activatedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
};

const TZ = "Europe/Chisinau";
const dmy = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("ro-RO", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" }) : null;
const dayKey = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ }) : "");
const dash = <span className="text-ink-soft/60">—</span>;
const daysAgo = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Infinity);

/** Conturile din portalul clienților: toate odată, filtrate/sortate/paginate în browser, cu orice număr de rânduri pe pagină. */
export default function PortalAccountsTable({ rows }: { rows: PortalAccountRow[] }) {
  const t = useT();
  const router = useRouter();

  const columns: Col<PortalAccountRow>[] = useMemo(
    () => [
      {
        key: "name", label: "Nume", minW: 200, maxW: 300, sticky: true, sort: (r) => r.name,
        render: (r) => (
          <Link href={`/platitori/${r.id}`} onClick={(e) => e.stopPropagation()} className="cursor-pointer font-medium text-brand-strong hover:underline" title={r.name}>
            {r.name}
          </Link>
        ),
      },
      { key: "acc", label: "Cont / contract", minW: 120, sort: (r) => r.account ?? r.contract, render: (r) => <span className="tabular-nums">{r.account ?? r.contract ?? dash}</span> },
      { key: "email", label: "Email", minW: 180, maxW: 260, sort: (r) => r.email, render: (r) => (r.email ? <span title={r.email}>{r.email}</span> : dash) },
      {
        key: "status", label: "Status", minW: 90, sort: (r) => (r.activated ? 1 : 0),
        render: (r) =>
          r.activated ? (
            <span className="inline-block rounded-full bg-brand-soft px-2 text-[10px] font-medium leading-[14px] text-brand-strong">{t("Activat")}</span>
          ) : (
            <span className="inline-block rounded-full bg-[var(--color-surface-2)] px-2 text-[10px] font-medium leading-[14px] text-ink-soft">{t("Neactivat")}</span>
          ),
      },
      { key: "act", label: "Activat la", minW: 90, sort: (r) => r.activatedAt, render: (r) => dmy(r.activatedAt) ?? dash },
      { key: "login", label: "Ultima logare", minW: 100, sort: (r) => r.lastLoginAt, render: (r) => dmy(r.lastLoginAt) ?? dash },
      { key: "kind", label: "Identificare", minW: 110, defaultHidden: true, sort: (r) => (r.account ? "cont" : "contract"), render: (r) => (r.account ? "Cont personal" : "Contract") },
      { key: "contract", label: "Contract", minW: 110, defaultHidden: true, sort: (r) => r.contract, render: (r) => r.contract ?? dash },
      { key: "created", label: "Creat la", minW: 90, defaultHidden: true, sort: (r) => r.createdAt, render: (r) => dmy(r.createdAt) ?? dash },
    ],
    [],
  );

  const filters = useMemo<Filter<PortalAccountRow>[]>(
    () => [
      {
        kind: "text", key: "q", label: "Caută", grow: true, placeholder: "Caută nume, cont, contract, email…",
        test: (r, v) => [r.name, r.account, r.contract, r.email].some((x) => (x ?? "").toLowerCase().includes(v)),
      },
      {
        kind: "select", key: "status", label: "Status: toate",
        options: [{ value: "on", label: "Activate" }, { value: "off", label: "Neactivate" }],
        test: (r, v) => (v === "on" ? r.activated : !r.activated),
      },
      {
        kind: "select", key: "email", label: "Email: toate",
        options: [{ value: "yes", label: "Cu email" }, { value: "no", label: "Fără email" }],
        test: (r, v) => (v === "yes" ? !!r.email : !r.email),
      },
      {
        kind: "select", key: "mail", label: "Furnizor email: toți",
        options: [{ value: "gmail", label: "Gmail" }, { value: "yahoo", label: "Yahoo" }, { value: "mail.ru", label: "Mail.ru" }, { value: "other", label: "Altul" }],
        test: (r, v) => {
          const d = (r.email ?? "").split("@")[1]?.toLowerCase() ?? "";
          if (!d) return false;
          return v === "other" ? !/gmail|yahoo|mail\.ru/.test(d) : d.includes(v);
        },
      },
      {
        kind: "select", key: "kind", label: "Identificare: toate",
        options: [{ value: "account", label: "Cu cont personal" }, { value: "contract", label: "Doar contract" }, { value: "both", label: "Și cont, și contract" }],
        test: (r, v) => (v === "account" ? !!r.account : v === "contract" ? !r.account && !!r.contract : !!r.account && !!r.contract),
      },
      {
        kind: "select", key: "login", label: "Ultima logare: toate",
        options: [
          { value: "never", label: "Niciodată" },
          { value: "7", label: "În ultimele 7 zile" },
          { value: "30", label: "În ultimele 30 de zile" },
          { value: "old", label: "Mai veche de 90 de zile" },
        ],
        test: (r, v) => (v === "never" ? !r.lastLoginAt : v === "old" ? !!r.lastLoginAt && daysAgo(r.lastLoginAt) > 90 : !!r.lastLoginAt && daysAgo(r.lastLoginAt) <= Number(v)),
      },
      {
        kind: "select", key: "actp", label: "Activat: oricând",
        options: [{ value: "7", label: "În ultimele 7 zile" }, { value: "30", label: "În ultimele 30 de zile" }, { value: "90", label: "În ultimele 90 de zile" }],
        test: (r, v) => !!r.activatedAt && daysAgo(r.activatedAt) <= Number(v),
      },
      { kind: "date", key: "actFrom", label: "Activat de la", test: (r, v) => !!r.activatedAt && dayKey(r.activatedAt) >= v },
      { kind: "date", key: "actTo", label: "Activat până la", test: (r, v) => !!r.activatedAt && dayKey(r.activatedAt) <= v },
      { kind: "date", key: "loginFrom", label: "Logat de la", test: (r, v) => !!r.lastLoginAt && dayKey(r.lastLoginAt) >= v },
      { kind: "date", key: "loginTo", label: "Logat până la", test: (r, v) => !!r.lastLoginAt && dayKey(r.lastLoginAt) <= v },
    ],
    [],
  );

  const activated = rows.filter((r) => r.activated).length;

  return (
    <DataTable
      storageKey="portal-accounts"
      rows={rows}
      columns={columns}
      filters={filters}
      defaultSort={{ key: "name", dir: "asc" }}
      noun="conturi"
      emptyText={t("Niciun cont găsit.")}
      onRowClick={(r) => router.push(`/platitori/${r.id}`)}
      summaryExtra={(f) => (
        <span className="text-ink-soft">
          {t("· activate:")} <b className="text-ink">{f.filter((r) => r.activated).length.toLocaleString("ro-RO")}</b> {t("din")} {f.length.toLocaleString("ro-RO")} ({t("în total")} {activated.toLocaleString("ro-RO")} {t("din")} {rows.length.toLocaleString("ro-RO")})
        </span>
      )}
    />
  );
}
