"use server";

import { revalidatePath, updateTag } from "next/cache";
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
  // Logo: data URL (base64), stocat direct în documentul CompanySettings din MongoDB.
  // MongoDB are o limită dură de 16MB per document, deci nu poate fi "fără limită" —
  // 7MB de text base64 (~5MB fișier original) lasă loc suficient pentru restul câmpurilor.
  if (logo && logo.length > 7_000_000) {
    return { error: "Logo prea mare (max ~5MB). Alege o imagine mai mică." };
  }
  const apaCanalLogo = String(formData.get("apaCanalLogo") ?? "");
  if (apaCanalLogo && apaCanalLogo.length > 7_000_000) {
    return { error: "Logo Apă-Canal prea mare (max ~5MB). Alege o imagine mai mică." };
  }

  const reqText = (key: string, fallback: string) => String(formData.get(key) ?? "").trim() || fallback;

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
    apaCanalLogo: apaCanalLogo || null,
    apaCanalCompanyLine: reqText("apaCanalCompanyLine", "S.A. Apa-Canal Cahul"),
    apaCanalAddress: reqText("apaCanalAddress", "mun.Cahul, str.31 August 1989 nr.1"),
    apaCanalEmail: reqText("apaCanalEmail", "apacanalmega@gmail.com"),
    apaCanalCodFiscal: reqText("apaCanalCodFiscal", "Cod fiscal 1002603000859"),
    apaCanalContactName: reqText("apaCanalContactName", "Corneliu"),
    apaCanalContactsText: reqText("apaCanalContactsText", ""),
    apaCanalAtentieText: reqText("apaCanalAtentieText", ""),
    apaCanalAnuntText: reqText("apaCanalAnuntText", ""),
    apaCanalTarifApa: Number(formData.get("apaCanalTarifApa")) || 0,
    apaCanalTarifCanal: Number(formData.get("apaCanalTarifCanal")) || 0,
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
  updateTag("company");
  return { ok: true };
}
