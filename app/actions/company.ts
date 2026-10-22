"use server";

import { revalidatePath, updateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { DEMO } from "@/lib/demo";
import { logAudit } from "@/lib/services/audit";
import { sanitizeApaCanalLayout, type ApaCanalLayout } from "@/lib/apa-canal-layout";

export type CompanyState = { ok?: boolean; error?: string; message?: string } | undefined;

/** Ultima linie a unei erori (mesajele Prisma sunt lungi, cu bucăți de cod): destul cât să se vadă cauza în ecran. */
function errLine(e: unknown): string {
  const lines = String(e instanceof Error ? e.message : e).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return (lines[lines.length - 1] ?? "eroare necunoscută").slice(0, 220);
}

/**
 * Salvează rândul unic de setări fără `upsert`: pe MongoDB, Prisma îl poate executa ca tranzacție, iar un MongoDB fără „replica set"
 * (frecvent la un server propriu) o refuză. Citire + update/create sunt operații simple, fără tranzacție.
 */
async function saveCompanyRow(update: Record<string, unknown>, createExtra: Record<string, unknown> = {}) {
  const existing = await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { id: true } });
  if (existing) await prisma.companySettings.update({ where: { id: existing.id }, data: update });
  else await prisma.companySettings.create({ data: { singleton: "main", ...createExtra, ...update } as never });
}

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

  // Tarifele: acceptă și virgulă ca separator zecimal („5,50"); o valoare negativă sau ne-numerică e respinsă (nu o salvăm ca 0 pe tăcute).
  const tariff = (key: string): number | null => {
    const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
    if (raw === "") return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  const tarifApa = tariff("apaCanalTarifApa");
  const tarifCanal = tariff("apaCanalTarifCanal");
  if (tarifApa === null || tarifCanal === null) return { error: "Tarifele trebuie să fie numere pozitive (ex. 12,50)." };

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
    apaCanalTarifApa: tarifApa,
    apaCanalTarifCanal: tarifCanal,
  };

  try {
    await saveCompanyRow(data);
  } catch (e) {
    console.error("[company] salvarea setărilor a eșuat:", e);
    return { error: `Nu s-a putut salva în baza de date: ${errLine(e)}` };
  }

  await logAudit(
    { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    { action: "settings.update", module: "Settings", objectName: companyName },
  );

  revalidatePath("/settings");
  updateTag("company");
  const fmt = (n: number) => n.toLocaleString("ro-RO", { maximumFractionDigits: 4 });
  return { ok: true, message: `Salvat. Tarife implicite: apă ${fmt(tarifApa)} lei/m³, canalizare ${fmt(tarifCanal)} lei/m³.` };
}

export type LayoutState = { ok?: boolean; error?: string; layout?: ApaCanalLayout; savedAt?: string } | undefined;

/**
 * Salvează șablonul (poziții/mărimi/texte) din editorul vizual al facturii Apă-Canal. Intrarea trece prin curățare
 * (doar valori valide, în pagină), iar după scriere citim ÎNAPOI din baza de date: dacă ce s-a stocat nu e ce am trimis,
 * spunem asta în loc să afișăm „Salvat” degeaba. Răspunsul conține șablonul stocat — editorul se aliniază la el.
 */
export async function updateApaCanalLayout(layout: ApaCanalLayout): Promise<LayoutState> {
  const user = await requireUser();
  if (!can(user, "admin")) return { error: "Doar administratorul poate edita șablonul facturii." };
  if (DEMO) return { error: "Mod demo: conectează o bază de date." };
  if (!layout || typeof layout !== "object" || Array.isArray(layout)) return { error: "Șablon invalid." };

  const clean = sanitizeApaCanalLayout(layout);
  if (JSON.stringify(clean).length > 12_000_000) {
    return { error: "Șablonul e prea mare (fotografiile adăugate). Șterge sau micșorează o fotografie." };
  }

  try {
    await saveCompanyRow({ apaCanalLayout: clean }, { companyName: "Compania" });
  } catch (e) {
    console.error("[company] salvarea șablonului a eșuat:", e);
    return { error: `Nu s-a putut salva în baza de date: ${errLine(e)}` };
  }

  let stored: ApaCanalLayout = {};
  try {
    const row = await prisma.companySettings.findUnique({ where: { singleton: "main" }, select: { apaCanalLayout: true } });
    stored = sanitizeApaCanalLayout(row?.apaCanalLayout);
  } catch (e) {
    console.error("[company] citirea șablonului după salvare a eșuat:", e);
    return { error: `Șablonul s-a trimis, dar nu am putut verifica salvarea: ${errLine(e)}` };
  }
  if (JSON.stringify(stored) !== JSON.stringify(clean)) {
    console.error("[company] șablonul citit înapoi diferă de cel trimis");
    return { error: "Salvarea nu a ajuns în baza de date acestui site (valoarea citită înapoi e alta). Reîncarcă pagina și încearcă din nou." };
  }

  await logAudit(
    { id: user.id, name: user.name, role: user.role, isSuperAdmin: user.isSuperAdmin },
    { action: "settings.update", module: "Settings", objectName: "Șablon factură Apă-Canal" },
  );

  revalidatePath("/settings/apa-canal-layout");
  // Facturile (pagina publică, PDF-ul, fereastra din aplicație și portalul) citesc același șablon: le reîmprospătăm pe toate.
  revalidatePath("/invoice/public/[token]", "page");
  revalidatePath("/portal", "layout");
  updateTag("company");
  return { ok: true, layout: stored, savedAt: new Date().toISOString() };
}
