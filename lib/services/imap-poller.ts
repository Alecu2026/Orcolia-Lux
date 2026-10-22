import "server-only";
import { ImapFlow } from "imapflow";
import { env } from "../env";
import { prisma } from "../prisma";
import { processInboundEmail } from "./email-ticket";
import { detectSpam } from "../spam-filter";
import { isRateLimited } from "../rate-limit";
import { htmlToText, stripQuotedReply } from "../email-body";
import { simpleParser } from "mailparser";

const LAST_UID_KEY = "imap-last-uid";

/** Procesează emailurile noi din INBOX și le convertește în tichete. */
export async function pollInbox(): Promise<{ processed: number; errors: number }> {
  if (!env.imap.enabled) return { processed: 0, errors: 0 };

  // Citim ultimul UID procesat din DB — nu mai depindem de flag-ul SEEN
  const lastUidRecord = await prisma.counter.findUnique({ where: { name: LAST_UID_KEY } });
  const lastUid = lastUidRecord?.value ?? 0;

  const client = new ImapFlow({
    host: env.imap.host,
    port: env.imap.port,
    secure: env.imap.secure,
    auth: { user: env.imap.user, pass: env.imap.pass },
    logger: false,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 60000,
  });

  client.on("error", (err: Error) => {
    console.error("[imap] client error (absorbed):", err.message);
  });

  let processed = 0;
  let errors = 0;
  let maxUid = lastUid;

  try {
    await client.connect();

    const lock = await client.getMailboxLock(env.imap.mailbox);
    try {
      // Căutăm toate emailurile cu UID mai mare decât ultimul procesat
      const uids = (await client.search({ uid: `${lastUid + 1}:*` }, { uid: true }) as number[])
        .filter((u) => u > lastUid)
        .sort((a, b) => a - b);

      if (!uids || uids.length === 0) return { processed: 0, errors: 0 };
      console.log(`[imap] emailuri noi (UID>${lastUid}): ${uids.join(", ")}`);

      // Procesăm câte un email pe rând — unele servere taie conexiunea
      // dacă facem fetch bulk cu source:true pe multe mesaje simultan
      for (const uid of uids) {
        try {
          let msg: import("imapflow").FetchMessageObject | null = null;
          for await (const m of client.fetch([uid], {
            uid: true,
            envelope: true,
            bodyStructure: true,
            source: true,
          }, { uid: true })) {
            msg = m as import("imapflow").FetchMessageObject;
          }
          if (!msg) {
            // UID nu există (posibil șters) — îl marcăm ca procesat oricum
            if (uid > maxUid) maxUid = uid;
            continue;
          }

          const parsed = await parseMessage(msg);
          if (!parsed) {
            if (uid > maxUid) maxUid = uid;
            continue;
          }

          const fromEmail = parsed.fromEmail.toLowerCase().trim();
          if (!fromEmail || fromEmail === env.imap.user.toLowerCase()) {
            if (uid > maxUid) maxUid = uid;
            continue;
          }

          if (isRateLimited(fromEmail, 10, 60 * 60 * 1000)) {
            if (uid > maxUid) maxUid = uid;
            continue;
          }

          const spamReason = detectSpam(fromEmail, parsed.subject, parsed.bodyText);
          if (spamReason) {
            console.log(`[imap] spam blocat: ${fromEmail} — ${spamReason}`);
            if (uid > maxUid) maxUid = uid;
            continue;
          }

          await processInboundEmail(parsed);
          processed++;
          if (uid > maxUid) maxUid = uid;
        } catch (err) {
          console.error("[imap] eroare la procesarea mesajului uid=" + uid + ":", (err as Error).message);
          errors++;
          // Avansăm UID-ul chiar și la eroare — nu blocăm pentru totdeauna
          if (uid > maxUid) maxUid = uid;
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.error("[imap] conectare eșuată:", msg);
    await client.logout().catch(() => {});
    return { processed: 0, errors: 1 };
  } finally {
    await client.logout().catch(() => {});
  }

  // Salvăm noul last UID dacă am avansat
  if (maxUid > lastUid) {
    await prisma.counter.upsert({
      where: { name: LAST_UID_KEY },
      create: { name: LAST_UID_KEY, value: maxUid },
      update: { value: maxUid },
    });
    console.log(`[imap] last UID avansat: ${lastUid} → ${maxUid}`);
  }

  return { processed, errors };
}

// ── Parser mesaj ─────────────────────────────────────────────────────────────
// MIME complet (multipart imbricat, base64 / quoted-printable, charset-uri, capete cu LF sau CRLF) prin mailparser.
async function parseMessage(msg: import("imapflow").FetchMessageObject) {
  if (!msg?.source) return null;

  const mail = await simpleParser(msg.source);
  const from = mail.from?.value?.[0];
  const fromEmail = (from?.address ?? msg.envelope?.from?.[0]?.address ?? "").toLowerCase().trim();
  if (!fromEmail) return null;

  const fromName = (from?.name ?? msg.envelope?.from?.[0]?.name ?? "").trim();
  const subject = (mail.subject ?? msg.envelope?.subject ?? "").trim() || "(fără subiect)";
  const messageId = cleanId(mail.messageId ?? "");
  const inReplyTo = cleanId(mail.inReplyTo ?? "");
  const references = Array.isArray(mail.references) ? mail.references.join(" ") : (mail.references ?? "");

  // Corp: text/plain, iar dacă lipsește, HTML curățat; apoi fără citatul răspunsului anterior.
  const rawBody = (mail.text ?? "").trim() || htmlToText(typeof mail.html === "string" ? mail.html : "");
  const bodyText = stripQuotedReply(rawBody);

  return { fromEmail, fromName, subject, bodyText, messageId, inReplyTo, references };
}

function cleanId(id: string): string {
  return id.replace(/^<|>$/g, "").trim();
}
