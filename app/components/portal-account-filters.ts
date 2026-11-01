import type { Filter } from "./DataTable";
import type { PortalAccountRow } from "@/lib/portal-accounts";

/**
 * Filtrele listelor de conturi de portal (Setări → Conturi portal clienți și Simulare → Portal clienți): aceleași criterii în ambele locuri, ca un plătitor să se găsească la fel de ușor.
 * `withStatus`: filtrul Activat / Neactivat (în Simulare lista conține oricum doar conturile activate).
 */
const TZ = "Europe/Chisinau";
const dayKey = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE", { timeZone: TZ }) : "");
const daysAgo = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Infinity);

export function portalAccountFilters(withStatus: boolean): Filter<PortalAccountRow>[] {
  return [
    {
      kind: "text", key: "q", label: "Caută", grow: true, placeholder: "Caută nume, cont, contract, email…",
      test: (r, v) => [r.name, r.account, r.contract, r.email].some((x) => (x ?? "").toLowerCase().includes(v)),
    },
    ...(withStatus
      ? ([
          {
            kind: "select", key: "status", label: "Status: toate",
            options: [{ value: "on", label: "Activate" }, { value: "off", label: "Neactivate" }],
            test: (r: PortalAccountRow, v: string) => (v === "on" ? r.activated : !r.activated),
          },
        ] as Filter<PortalAccountRow>[])
      : []),
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
  ];
}
