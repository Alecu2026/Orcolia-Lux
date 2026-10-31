"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";
import { getAutoNotify, getIssueMessages } from "@/lib/services/auto-notify";
import { AUTO_NOTIFY_KINDS, sanitizeAutoNotify, type AutoNotifySettings } from "@/lib/auto-notify";
import { diffFromDefaults, MSG_KEYS, MSG_LIMITS, MSG_STAGES, resolveIssueMessages, type IssueMessages } from "@/lib/issue-messages";

type Res = { ok?: boolean; error?: string };

const actor = (u: { id: string; name: string; role: string; isSuperAdmin?: boolean }) => ({ id: u.id, name: u.name, role: u.role, isSuperAdmin: u.isSuperAdmin });

/** Notificările automate către clienți: pornit / oprit și canalele (email / SMS) pentru fiecare tip. Doar administratorii. */
export async function saveAutoNotifyAction(settings: unknown): Promise<Res> {
  const user = await requireUser();
  if (!can(user, "admin")) return { error: "Doar administratorii pot modifica notificările automate." };
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };
  const clean = sanitizeAutoNotify(settings);
  const old = await getAutoNotify();
  await prisma.companySettings.upsert({
    where: { singleton: "main" },
    create: { singleton: "main", autoNotify: clean as unknown as object },
    update: { autoNotify: clean as unknown as object },
  });
  const changes = AUTO_NOTIFY_KINDS.flatMap((k) =>
    (["enabled", "email", "sms"] as const)
      .filter((f) => old[k][f] !== clean[k][f])
      .map((f) => ({ field: `${k}.${f}`, label: `${k}: ${f === "enabled" ? "trimitere automată" : f === "email" ? "email" : "SMS"}`, old: old[k][f] ? "da" : "nu", new: clean[k][f] ? "da" : "nu" })),
  );
  if (changes.length) await logAudit(actor(user), { action: "settings.auto_notify", module: "Settings", objectName: "Notificări automate către clienți", details: { changes } });
  revalidatePath("/settings");
  revalidatePath("/contoare/nereguli");
  return { ok: true };
}

/** Mesajele automate (SMS, subiect, email) pentru termenele neregulilor, pe tip și etapă. Se salvează doar ce diferă de textul implicit. Doar administratorii. */
export async function saveIssueMessagesAction(messages: unknown): Promise<Res> {
  const user = await requireUser();
  if (!can(user, "admin")) return { error: "Doar administratorii pot modifica mesajele automate." };
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };
  const clean = resolveIssueMessages(messages);
  // un mesaj golit sau depășit ca lungime nu se salvează tăcut
  const src = (messages && typeof messages === "object" ? messages : {}) as Record<string, Record<string, Record<string, unknown>> | undefined>;
  for (const k of MSG_KEYS) for (const st of MSG_STAGES) {
    const m = src[k]?.[st];
    if (!m) continue;
    for (const f of ["sms", "subject", "email"] as const) {
      const v = m[f];
      if (typeof v !== "string" || v.trim() === "") return { error: "Mesajul nu poate fi gol." };
      if (v.length > MSG_LIMITS[f]) return { error: "Mesajul este prea lung." };
    }
  }
  const old: IssueMessages = await getIssueMessages();
  const diff = diffFromDefaults(clean);
  await prisma.companySettings.upsert({
    where: { singleton: "main" },
    create: { singleton: "main", issueMessages: diff as unknown as object },
    update: { issueMessages: diff as unknown as object },
  });
  const changes = MSG_KEYS.flatMap((k) =>
    MSG_STAGES.flatMap((st) =>
      (["sms", "subject", "email"] as const)
        .filter((f) => old[k][st][f] !== clean[k][st][f])
        .map((f) => ({ field: `${k}.${st}.${f}`, label: `Mesaj ${k} · ${st === "before" ? "înainte de termen" : "termen depășit"} · ${f}`, old: old[k][st][f].slice(0, 200), new: clean[k][st][f].slice(0, 200) })),
    ),
  );
  if (changes.length) await logAudit(actor(user), { action: "settings.auto_notify", module: "Settings", objectName: "Mesaje automate: termene nereguli", details: { changes } });
  revalidatePath("/contoare/nereguli");
  return { ok: true };
}

export type { AutoNotifySettings };
