"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";

export type CompanyState = { ok?: boolean; error?: string } | undefined;

function s(formData: FormData, key: string): string | null {
  const v = String(formData.get(key) ?? "").trim();
  return v === "" ? null : v;
}

export async function updateCompanySettings(
  _prev: CompanyState,
  formData: FormData,
): Promise<CompanyState> {
  const user = await requireUser();
  if (!can(user, "admin")) return { error: "Doar administratorul poate edita datele companiei." };
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };

  const companyName = String(formData.get("companyName") ?? "").trim();
  if (!companyName) return { error: "Numele companiei e obligatoriu." };

  const logo = String(formData.get("logo") ?? "");
  // Logo: data URL (base64). Limităm la ~700KB ca să nu îngreunăm DB-ul.
  if (logo && logo.length > 950_000) {
    return { error: "Logo prea mare (max ~700KB). Alege o imagine mai mică." };
  }

  const data = {
    companyName,
    logo: logo || null,
    phone: s(formData, "phone"),
    email: s(formData, "email"),
    address: s(formData, "address"),
    taxId: s(formData, "taxId"),
    vatNumber: s(formData, "vatNumber"),
    bankDetails: s(formData, "bankDetails"),
    currency: String(formData.get("currency") ?? "MDL").trim() || "MDL",
    invoicePrefix: String(formData.get("invoicePrefix") ?? "INV").trim() || "INV",
    appointmentsLabel: String(formData.get("appointmentsLabel") ?? "").trim() || "Programări",
  };

  await prisma.companySettings.upsert({
    where: { singleton: "main" },
    create: { singleton: "main", ...data },
    update: data,
  });

  await logAudit(
    { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    { action: "settings.update", module: "Settings", objectName: companyName },
  );

  revalidatePath("/settings");
  revalidateTag("company", "max");
  return { ok: true };
}
