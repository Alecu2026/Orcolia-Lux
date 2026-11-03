import "server-only";
import { after } from "next/server";
import { prisma } from "../prisma";
import { env } from "../env";
import { sendReadingVerificationEmail } from "../email";
import { signPendingToken, signReadingToken } from "../reading-verify-token";
import { isRateLimited } from "../rate-limit";
import { getCompanySettings } from "../queries/company";

/**
 * Emailul de verificare a citirii (cerință din caietul de sarcini: „dacă o citire se introduce pe web, se trimite automat un email către adresa titularului, cerând verificarea”):
 *  - la o citire NOUĂ trimisă de plătitor din portal;
 *  - la o MODIFICARE a unei citiri (corectată de plătitor în portal, sau de un angajat peste una trimisă de plătitor) — doar dacă indexul s-a schimbat.
 * Adresa e emailul titularului din fișa de la companie (cea pe care a fost activat contul), nu una scrisă în formular. Emailul pleacă în fundal (nu încetinește citirea),
 * cu cel mult 10 pe oră per plătitor. Citirile făcute de cititori din teren peste citiri făcute tot de personal nu trimit nimic.
 */

export type OwnerNotice = {
  readingId: string;
  clientId: string;
  contor: string;
  address: string | null;
  period: string;
  value: number;
  prevValue: number | null;
  /** indexul dinaintea modificării; null = citire nouă */
  oldValue: number | null;
  readAt: Date;
  /** cine a făcut modificarea: plătitorul din portal sau un angajat */
  byClient: boolean;
};

export const maskEmail = (e: string): string => {
  const [u, d] = e.split("@");
  return d ? `${u.slice(0, 1)}${"*".repeat(Math.max(2, Math.min(5, u.length - 1)))}@${d}` : e;
};

export const validEmail = (e: string | null | undefined): string | null => {
  const v = (e ?? "").trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) ? v : null;
};

async function send(n: OwnerNotice, client: { name: string }, to: string): Promise<void> {
  const company = await getCompanySettings().catch(() => null);
  const url = `${env.appUrl.replace(/\/$/, "")}/citire/verifica?t=${encodeURIComponent(signReadingToken({ readingId: n.readingId, value: n.value }))}`;
  await sendReadingVerificationEmail({
    to,
    name: client.name,
    contor: n.contor,
    address: n.address,
    period: n.period,
    value: n.value,
    prevValue: n.prevValue,
    consum: n.prevValue != null ? Math.round((n.value - n.prevValue) * 1000) / 1000 : null,
    oldValue: n.oldValue,
    when: new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Chisinau" }).format(n.readAt),
    byClient: n.byClient,
    url,
    company: company?.companyName || "Apă-Canal",
  });
}

/**
 * Pune emailul în coadă (se trimite în fundal, după răspuns) și întoarce adresa mascată la care pleacă — sau null dacă titularul nu are un email valid la companie ori a depășit limita.
 * Adresa se citește din baza de date (nu din sesiunea plătitorului, care poate fi în urmă). Nu aruncă niciodată: citirea e deja salvată.
 */
export async function queueReadingVerification(n: OwnerNotice): Promise<string | null> {
  try {
    const client = await prisma.client.findUnique({ where: { id: n.clientId }, select: { name: true, email: true } });
    const to = validEmail(client?.email);
    if (!client || !to) return null;
    if (isRateLimited(`reading-verify:${n.clientId}`, 10, 3_600_000)) return null;
    const run = () => send(n, client, to).catch((e) => console.error("[reading-verify] emailul nu a plecat:", String((e as Error)?.message ?? e).slice(0, 200)));
    try {
      after(run);
    } catch {
      void run(); // în afara unei cereri (script, test): pornește direct
    }
    return maskEmail(to);
  } catch (e) {
    console.error("[reading-verify] pregătirea emailului:", String((e as Error)?.message ?? e).slice(0, 200));
    return null;
  }
}

export type PendingNotice = {
  pendingId: string;
  clientId: string;
  contor: string;
  address: string | null;
  period: string;
  value: number;
  submittedAt: Date;
};

/**
 * Emailul „Confirmă citirea” pentru o citire trimisă din portal și încă neînregistrată (vezi PortalReadingPending): linkul duce la /citire/confirma, iar citirea contează abia după confirmare.
 * Pleacă în fundal; întoarce adresa mascată, sau null dacă titularul nu are un email valid la companie. Limita de trimiteri o ține apelantul.
 */
export async function queuePendingConfirmation(n: PendingNotice): Promise<string | null> {
  try {
    const client = await prisma.client.findUnique({ where: { id: n.clientId }, select: { name: true, email: true } });
    const to = validEmail(client?.email);
    if (!client || !to) return null;
    const run = async () => {
      const company = await getCompanySettings().catch(() => null);
      await sendReadingVerificationEmail({
        to,
        name: client.name,
        contor: n.contor,
        address: n.address,
        period: n.period,
        value: n.value,
        prevValue: null,
        consum: null,
        oldValue: null,
        when: new Intl.DateTimeFormat("ro-RO", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Chisinau" }).format(n.submittedAt),
        byClient: true,
        url: `${env.appUrl.replace(/\/$/, "")}/citire/confirma?t=${encodeURIComponent(signPendingToken(n.pendingId))}`,
        company: company?.companyName || "Apă-Canal",
        pending: true,
      });
    };
    const safe = () => run().catch((e) => console.error("[reading-verify] emailul de confirmare nu a plecat:", String((e as Error)?.message ?? e).slice(0, 200)));
    try {
      after(safe);
    } catch {
      void safe();
    }
    return maskEmail(to);
  } catch (e) {
    console.error("[reading-verify] pregătirea emailului de confirmare:", String((e as Error)?.message ?? e).slice(0, 200));
    return null;
  }
}
