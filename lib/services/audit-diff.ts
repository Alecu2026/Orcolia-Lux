import "server-only";
import type { AuditChange } from "../audit-meta";

/**
 * Compară starea de dinainte cu cea de după și întoarce DOAR câmpurile care s-au schimbat, cu valorile deja formatate pentru citit
 * (datele în fusul firmei, da/nu, liste cu virgulă). Folosit de acțiunile de editare ca să rămână în Audit Logs ce anume s-a modificat.
 */
export type DiffSpec<T = unknown> = {
  key: string;
  label: string;
  /** Formatare specială (implicit: vezi fmtAuditValue). Întoarce null pentru „gol”. */
  fmt?: (v: T) => string | null;
};

const tzFmt = new Intl.DateTimeFormat("ro-RO", { timeZone: "Europe/Bucharest", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/** O valoare, ca text scurt pentru jurnal (null = gol). */
export function fmtAuditValue(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : tzFmt.format(v);
  if (typeof v === "boolean") return v ? "Da" : "Nu";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null;
  if (Array.isArray(v)) return v.length ? v.map((x) => fmtAuditValue(x) ?? "—").join(", ") : null;
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v).trim();
  return s ? s : null;
}

export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, spec: DiffSpec[]): AuditChange[] {
  const out: AuditChange[] = [];
  for (const sp of spec) {
    if (!(sp.key in after)) continue; // câmpul nu a fost trimis la editare
    const f = sp.fmt ?? fmtAuditValue;
    const a = f(before[sp.key]);
    const b = f(after[sp.key]);
    if (a !== b) out.push({ field: sp.key, label: sp.label, old: a, new: b });
  }
  return out;
}

/** Schimbările deja calculate în alt loc ({field, from, to}) → forma din jurnal. */
export function fromTaskChanges(list: { field: string; from: string | null; to: string | null }[] | undefined): AuditChange[] {
  return (list ?? []).map((c) => ({ field: c.field, label: c.field, old: c.from, new: c.to }));
}

import { prisma } from "../prisma";

export const CLIENT_SPEC: DiffSpec[] = [
  { key: "name", label: "Nume" },
  { key: "phone", label: "Telefon" },
  { key: "email", label: "Email" },
  { key: "telegramChatId", label: "Telegram (chat ID)" },
  { key: "notes", label: "Notițe" },
  { key: "contractExpiresAt", label: "Contract expiră la" },
];

export const PROJECT_SPEC: DiffSpec[] = [
  { key: "name", label: "Nume" },
  { key: "description", label: "Descriere" },
  { key: "status", label: "Status" },
  { key: "clientId", label: "Client" },
  { key: "assigneeId", label: "Responsabil" },
  { key: "teamId", label: "Echipă" },
  { key: "address", label: "Adresă" },
];

export const USER_SPEC: DiffSpec[] = [
  { key: "name", label: "Nume" },
  { key: "email", label: "Email" },
  { key: "role", label: "Rol" },
  { key: "isActive", label: "Cont activ" },
];

export const INVOICE_SPEC: DiffSpec[] = [
  { key: "status", label: "Status" },
  { key: "issueDate", label: "Data emiterii" },
  { key: "dueDate", label: "Scadența" },
  { key: "grandTotal", label: "Total" },
  { key: "client", label: "Client" },
  { key: "notes", label: "Note" },
];

export const COMPANY_SPEC: DiffSpec[] = [
  { key: "companyName", label: "Numele companiei" },
  { key: "phone", label: "Telefon" },
  { key: "email", label: "Email" },
  { key: "address", label: "Adresă" },
  { key: "taxId", label: "Cod fiscal" },
  { key: "vatNumber", label: "Cod TVA" },
  { key: "bankDetails", label: "Date bancare" },
  { key: "currency", label: "Monedă" },
  { key: "invoicePrefix", label: "Prefix facturi" },
  { key: "appointmentsLabel", label: "Eticheta „Programări”" },
  { key: "apaCanalCompanyLine", label: "Apă-Canal: firma" },
  { key: "apaCanalAddress", label: "Apă-Canal: adresa" },
  { key: "apaCanalEmail", label: "Apă-Canal: email" },
  { key: "apaCanalCodFiscal", label: "Apă-Canal: cod fiscal" },
  { key: "apaCanalContactName", label: "Apă-Canal: persoana de contact" },
  { key: "apaCanalContactsText", label: "Apă-Canal: contacte" },
  { key: "apaCanalAtentieText", label: "Apă-Canal: text „Atenție”" },
  { key: "apaCanalAnuntText", label: "Apă-Canal: anunț" },
  { key: "apaCanalTarifApa", label: "Tarif apă (lei/m³)" },
  { key: "apaCanalTarifCanal", label: "Tarif canalizare (lei/m³)" },
];

/** Numele pentru id-uri (utilizatori, clienți, echipe) — ca în jurnal să apară „Ana Pop”, nu un cod. Un id necunoscut rămâne neschimbat. */
export async function resolveIdNames(changes: AuditChange[], kinds: Record<string, "user" | "client" | "team">): Promise<AuditChange[]> {
  const want = { user: new Set<string>(), client: new Set<string>(), team: new Set<string>() };
  for (const c of changes) {
    const k = kinds[c.field];
    if (!k) continue;
    if (c.old) want[k].add(c.old);
    if (c.new) want[k].add(c.new);
  }
  const names = new Map<string, string>();
  try {
    const [users, clients, teams] = await Promise.all([
      want.user.size ? prisma.user.findMany({ where: { id: { in: [...want.user] } }, select: { id: true, name: true } }) : [],
      want.client.size ? prisma.client.findMany({ where: { id: { in: [...want.client] } }, select: { id: true, name: true } }) : [],
      want.team.size ? prisma.team.findMany({ where: { id: { in: [...want.team] } }, select: { id: true, name: true } }) : [],
    ]);
    for (const r of [...users, ...clients, ...teams]) names.set(r.id, r.name);
  } catch {
    // numele sunt doar pentru citire; fără ele rămân id-urile
  }
  return changes.map((c) => (kinds[c.field] ? { ...c, old: c.old ? (names.get(c.old) ?? c.old) : c.old, new: c.new ? (names.get(c.new) ?? c.new) : c.new } : c));
}
