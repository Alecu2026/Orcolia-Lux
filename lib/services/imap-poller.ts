import "server-only";
import { ImapFlow } from "imapflow";
import { env } from "../env";
import { prisma } from "../prisma";
import { processInboundEmail } from "./email-ticket";
import { detectSpam } from "../spam-filter";
import { isRateLimited } from "../rate-limit";

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

      // Procesăm câte un email pe rând — serverul scada.md taie conexiunea
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
async function parseMessage(msg: import("imapflow").FetchMessageObject) {
  if (!msg?.source) return null;

  const raw = msg.source.toString("utf-8");

  // Extrage headers din sursa brută
  const headerEnd = raw.indexOf("\r\n\r\n");
  const headerSection = headerEnd > -1 ? raw.slice(0, headerEnd) : raw.slice(0, 2000);
  const body = headerEnd > -1 ? raw.slice(headerEnd + 4) : "";

  function getHeader(name: string): string {
    const re = new RegExp(`^${name}:\\s*(.+?)(?=\\r?\\n(?!\\s)|$)`, "ims");
    const m = headerSection.match(re);
    return m ? m[1].replace(/\r?\n\s+/g, " ").trim() : "";
  }

  const fromRaw = getHeader("From") || (msg.envelope?.from?.[0]
    ? `${msg.envelope.from[0].name ?? ""} <${msg.envelope.from[0].address ?? ""}>`.trim()
    : "");

  const fromEmail = extractEmail(fromRaw);
  const fromName = decodeWords(extractName(fromRaw) || msg.envelope?.from?.[0]?.name || "");
  const subject = decodeWords(getHeader("Subject") || msg.envelope?.subject || "(fără subiect)");
  const messageId = cleanId(getHeader("Message-ID") || getHeader("Message-Id") || "");
  const inReplyTo = cleanId(getHeader("In-Reply-To") || "");
  const references = getHeader("References") || "";

  // Body: încearcă text/plain, fallback la curățare HTML
  const rawBody = extractTextBody(raw) || body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const bodyText = stripQuoted(rawBody);

  if (!fromEmail) return null;

  return { fromEmail, fromName, subject, bodyText, messageId, inReplyTo, references };
}

function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const result: string[] = [];
  for (const line of lines) {
    // Stop at quoted reply block (lines starting with ">") or "On ... wrote:" separator
    if (/^>/.test(line)) break;
    if (/^(On .+wrote:|----+ ?Original Message ?----+)/i.test(line)) break;
    result.push(line);
  }
  return result.join("\n").trim();
}

function extractTextBody(raw: string): string {
  // Caută boundary multipart
  const boundaryMatch = raw.match(/Content-Type:\s*multipart\/\w+;\s*boundary="?([^"\r\n]+)"?/i);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim();
    const parts = raw.split(`--${boundary}`);
    for (const part of parts) {
      if (/Content-Type:\s*text\/plain/i.test(part)) {
        const bodyStart = part.indexOf("\r\n\r\n");
        if (bodyStart > -1) {
          const body = part.slice(bodyStart + 4).replace(/--$/, "").trim();
          const decoded = decodeQuotedPrintable(body);
          if (decoded.length > 5) return decoded;
        }
      }
    }
    // Fallback: prima parte text/html
    for (const part of parts) {
      if (/Content-Type:\s*text\/html/i.test(part)) {
        const bodyStart = part.indexOf("\r\n\r\n");
        if (bodyStart > -1) {
          return part.slice(bodyStart + 4).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }
      }
    }
  }

  // Single-part: verifică dacă există Content-Type text/plain
  if (/Content-Type:\s*text\/plain/i.test(raw)) {
    const start = raw.indexOf("\r\n\r\n");
    if (start > -1) return decodeQuotedPrintable(raw.slice(start + 4).trim());
  }

  return "";
}

function decodeQuotedPrintable(str: string): string {
  // Remove soft line breaks, then decode QP bytes as UTF-8 (not Latin-1)
  const unfolded = str.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  let i = 0;
  while (i < unfolded.length) {
    if (unfolded[i] === "=" && i + 2 < unfolded.length && /[0-9A-Fa-f]{2}/.test(unfolded.slice(i + 1, i + 3))) {
      bytes.push(parseInt(unfolded.slice(i + 1, i + 3), 16));
      i += 3;
    } else {
      const code = unfolded.charCodeAt(i);
      if (code < 0x80) { bytes.push(code); }
      else if (code < 0x800) { bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f)); }
      else { bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)); }
      i++;
    }
  }
  return Buffer.from(bytes).toString("utf-8");
}

function decodeWords(str: string): string {
  return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g, (_, charset, encoding, data) => {
    try {
      if (encoding.toUpperCase() === "B") {
        return Buffer.from(data, "base64").toString("utf-8");
      }
      return decodeQuotedPrintable(data.replace(/_/g, " "));
    } catch {
      return str;
    }
  });
}

function extractEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

function extractName(from: string): string {
  const m = from.match(/^(.+?)\s*</);
  return m ? m[1].replace(/^["']|["']$/g, "").trim() : "";
}

function cleanId(id: string): string {
  return id.replace(/^<|>$/g, "").trim();
}
