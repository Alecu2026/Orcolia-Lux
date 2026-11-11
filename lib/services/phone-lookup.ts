import "server-only";
import { prisma } from "../prisma";
import { getMeterSnap } from "./meter-cache";

/**
 * Datele cunoscute despre un număr de telefon, ca să se completeze singure la crearea unui client din apelul PBX: numele, adresa, emailul.
 * Căutarea se face după ultimele 8 cifre (formatele diferă: 069…, +373 69…, 37369…), în ordine:
 *  1. clienții din CRM (inclusiv plătitorii din 1C): dacă numărul există deja, nu se creează un duplicat — se arată clientul;
 *  2. contoarele / abonații din lista 1C-Axioma (au telefon și adresă și când clientul nu e încă în CRM).
 */

export type PhonePrefill = {
  /** telefonul pentru formular, în formă citibilă (+373…) */
  phone: string;
  name: string | null;
  address: string | null;
  email: string | null;
  /** de unde vin datele completate */
  source: "client" | "meter" | null;
  /** clientul din CRM cu acest număr (dacă există deja) */
  clientId: string | null;
};

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Numărul pentru formular: cu „+” când e în format internațional (373…), altfel așa cum a venit. */
export function displayPhone(raw: string): string {
  const s = raw.trim();
  const d = digits(s);
  if (!d) return "";
  if (s.startsWith("+")) return `+${d}`;
  if (d.startsWith("373") || d.length >= 11) return `+${d}`;
  return s.slice(0, 40);
}

export async function lookupPhonePrefill(raw: string): Promise<PhonePrefill> {
  const out: PhonePrefill = { phone: displayPhone(raw), name: null, address: null, email: null, source: null, clientId: null };
  const last8 = digits(raw).slice(-8);
  if (last8.length < 8) return out;

  const client = await prisma.client.findFirst({ where: { phone: { contains: last8 } }, select: { id: true, name: true, email: true, consumAddress: true, phone: true } }).catch(() => null);
  if (client) {
    return { ...out, name: client.name, address: client.consumAddress, email: client.email, source: "client", clientId: client.id };
  }

  try {
    const snap = await getMeterSnap();
    const hit = snap.rows.find((r) => r.phone && digits(r.phone).includes(last8));
    if (hit) return { ...out, name: hit.name || null, address: hit.address || null, email: hit.email || null, source: "meter", clientId: hit.clientId };
  } catch (e) {
    console.error("[phone-lookup] lista de contoare indisponibilă:", String((e as Error)?.message ?? e).slice(0, 160));
  }
  return out;
}

/** Leagă apelurile PBX fără client de clientul nou/existent: apelul de pe care s-a pornit și toate celelalte de la același număr (ultimele 8 cifre). */
export async function linkCallsToClient(clientId: string, name: string, phone: string | null, callId: string | null): Promise<number> {
  const last8 = digits(phone).slice(-8);
  const or: object[] = [];
  if (callId && callId.length <= 120) or.push({ callId });
  if (last8.length === 8) or.push({ phone: { contains: last8 } }, { phoneE164: { contains: last8 } });
  if (or.length === 0) return 0;
  // câmpul poate lipsi complet din document (nu doar să fie null) — de-aia și isSet:false
  const r = await prisma.pbxCall.updateMany({
    where: { OR: [{ clientId: null }, { clientId: { isSet: false } }], AND: [{ OR: or }] },
    data: { clientId, clientName: name },
  });
  return r.count;
}
