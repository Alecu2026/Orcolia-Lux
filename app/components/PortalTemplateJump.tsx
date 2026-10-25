"use client";

import { useRouter } from "next/navigation";
import type { PortalTemplate } from "@/lib/portal-template";
import { useT } from "@/lib/i18n/context";

/** Listă mică pe pagina cu facturi: alegi un șablon și ajungi la formularul de cerere deja completat. */
export default function PortalTemplateJump({ templates }: { templates: PortalTemplate[] }) {
  const t = useT();
  const router = useRouter();
  if (templates.length === 0) return null;
  return (
    <select
      value=""
      onChange={(e) => e.target.value && router.push(`/portal/cereri?sablon=${e.target.value}`)}
      aria-label={t("Cerere rapidă din șablon")}
      className="h-10 max-w-[12rem] cursor-pointer rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 text-sm text-ink-soft outline-none focus:border-brand"
    >
      <option value="">{t("📋 Cerere rapidă…")}</option>
      {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}</option>)}
    </select>
  );
}
