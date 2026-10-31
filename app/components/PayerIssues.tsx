import Link from "next/link";
import { ISSUE_LABELS, SERIOUS_ISSUES, type IssueRegisterRow } from "@/lib/meter-issues";
import { daysUntil } from "@/lib/contract-expiry";
import { getT } from "@/lib/i18n/server-t";

const dmy = (k: string | null) => (k ? k.slice(0, 10).split("-").reverse().join(".") : "—");

/** Neregulile contoarelor unui plătitor (în fișa lui): cele deschise primele, cu cine remediază, secția și termenul. Doar de citit; se editează în „Nereguli contoare”. */
export default async function PayerIssues({ issues, canManage }: { issues: IssueRegisterRow[]; canManage: boolean }) {
  const t = await getT();
  if (issues.length === 0) return <p className="px-3 py-3 text-sm text-ink-soft">{t("Nicio neregulă raportată la contoarele plătitorului.")}</p>;
  return (
    <ul className="divide-y divide-[var(--color-line)]" data-payer-issues="">
      {issues.map((i) => {
        const open = !i.resolvedAt;
        const d = i.dueAt ? daysUntil(i.dueAt) : null;
        const due = i.dueAt ? (open ? (d! < 0 ? t("depășit cu {n} zile", { n: -d! }) : d === 0 ? t("expiră azi") : d === 1 ? t("expiră mâine") : t("expiră în {n} zile", { n: d! })) : (i.resolvedAt!.slice(0, 10) > i.dueAt ? t("cu întârziere") : t("în termen"))) : null;
        return (
          <li key={i.id} className={`px-3 py-2 text-sm ${open ? "" : "text-ink-soft"}`}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className={`font-semibold ${open && SERIOUS_ISSUES.includes(i.kind) ? "text-st-cancelled" : ""}`}>{open ? "⚑" : "✓"} {t(ISSUE_LABELS[i.kind])}</span>
              <Link href={`/contoare/${encodeURIComponent(i.meterId)}`} className="font-mono text-xs hover:text-brand hover:underline">{i.contor}</Link>
              <span className="text-xs text-ink-soft">{dmy(i.reportedAt)}</span>
            </div>
            <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-ink-soft">
              <span>{t("Cine remediază")}: <b className="text-ink">{i.responsible === "CLIENT" ? t("Clientul") : i.responsible === "COMPANY" ? t("Compania") : t("De stabilit")}</b></span>
              {i.teamName && <span>{t("Secția")}: <b className="text-ink">{i.teamName}</b></span>}
              {i.dueAt && <span>{t("Termen")}: <b className={open && d! < 0 ? "text-st-cancelled" : open && d! <= 3 ? "text-st-progress" : "text-ink"}>{dmy(i.dueAt)} · {due}</b></span>}
            </p>
            {i.note && <p className="mt-0.5 text-[13px]">{i.note}</p>}
          </li>
        );
      })}
      {canManage && (
        <li className="px-3 py-2"><Link href="/contoare/nereguli" className="text-xs font-semibold text-brand hover:underline">{t("Gestionează în „Nereguli contoare” →")}</Link></li>
      )}
    </ul>
  );
}
