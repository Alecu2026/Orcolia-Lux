"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { canManageMeterIssues } from "@/lib/meter-issue-access";
import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";
import { getIssueRules, teamNameMap, updateIssue } from "@/lib/services/meter-issues";
import { ISSUE_KINDS, sanitizeIssueRules, type IssueDto, type IssueRules } from "@/lib/meter-issues";

type Team = { id: string; name: string };

/** Secțiile (echipele) din care se alege cine răspunde de o neregulă. */
export async function getIssueTeamsAction(): Promise<Team[]> {
  await requireUser();
  return [...(await teamNameMap())].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "ro"));
}

/** Biroul corectează cine remediază, secția responsabilă și termenul unei nereguli (drept: administrarea contoarelor). */
export async function updateIssueAction(
  id: string,
  patch: { responsible: string | null; teamId: string | null; dueAt: string | null },
): Promise<{ ok: true; issue: IssueDto } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!canManageMeterIssues(user)) return { ok: false, error: "Fără permisiune." };
  if (typeof id !== "string" || !patch || typeof patch !== "object") return { ok: false, error: "Date invalide." };
  const responsible = patch.responsible === "CLIENT" || patch.responsible === "COMPANY" ? patch.responsible : null;
  const res = await updateIssue(user, id, {
    responsible,
    teamId: typeof patch.teamId === "string" && patch.teamId ? patch.teamId : null,
    dueAt: typeof patch.dueAt === "string" ? patch.dueAt : null,
  });
  if (res.ok) revalidatePath("/contoare/nereguli");
  return res;
}

/** Regulile pe tipuri de neregulă (cine remediază, în câte zile, ce secție) — Setări, doar administratorii. */
export async function saveMeterIssueRulesAction(rules: unknown): Promise<{ ok?: boolean; error?: string }> {
  const user = await requireUser();
  if (!can(user, "admin")) return { error: "Doar administratorii pot modifica regulile neregulilor." };
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };
  const clean = sanitizeIssueRules(rules);
  // secțiile inexistente se elimină
  const teams = await teamNameMap();
  for (const k of ISSUE_KINDS) if (clean[k].teamId && !teams.has(clean[k].teamId)) clean[k].teamId = "";
  const old = await getIssueRules();
  await prisma.companySettings.upsert({
    where: { singleton: "main" },
    create: { singleton: "main", meterIssueRules: clean as unknown as object },
    update: { meterIssueRules: clean as unknown as object },
  });
  await logAudit(
    { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    {
      action: "meter.issue_update",
      module: "Meters",
      objectName: "Reguli nereguli contoare",
      details: {
        changes: ISSUE_KINDS.flatMap((k) =>
          (["responsible", "days", "teamId"] as const)
            .filter((f) => old[k][f] !== clean[k][f])
            .map((f) => ({ field: `${k}.${f}`, label: `${k}: ${f === "responsible" ? "responsabil" : f === "days" ? "zile" : "secție"}`, old: String(old[k][f] || "—"), new: String(clean[k][f] || "—") })),
        ),
      },
    },
  );
  revalidatePath("/settings");
  return { ok: true };
}

export type { IssueRules };
