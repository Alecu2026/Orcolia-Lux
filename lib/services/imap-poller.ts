import "server-only";
import { createHash } from "node:crypto";
import { ImapFlow } from "imapflow";
import { env } from "../env";
import { prisma } from "../prisma";
import { processInboundEmail } from "./email-ticket";
import { detectSpam, detectAutomated } from "../spam-filter";
import { isRateLimited } from "../rate-limit";
import { htmlToText, stripQuotedReply } from "../email-body";
import { simpleParser, type ParsedMail } from "mailparser";

const LAST_UID_KEY = "imap-last-uid";
const VALIDITY_KEY = "imap-uid-validity";
const LOCK_KEY = "imap-lock";
const FAIL_PREFIX = "imap-fail-";

/** Cel mult atâtea mesaje pe rulare (restul rămân pentru rularea următoare): funcția cron are limită de timp. */
const MAX_PER_POLL = 60;
/** După atâta timp de lucru oprim rularea (progresul e deja salvat; continuă la următoarea). */
const MAX_POLL_MS = 22_000;
/** Un mesaj care dă eroare e reîncercat de atâtea ori înainte să fie sărit (ca să nu blocheze căsuța pentru totdeauna). */
const MAX_ATTEMPTS = 3;
const LOCK_SECONDS = 150;

/** Valoare care încape în Int-ul din baza de date (UIDVALIDITY e pe 32 de biți fără semn). */
const validityKey = (v: unknown): number => {
  try {
    return Number(BigInt(v as bigint | number | string) % 2_000_000_000n);
  } catch {
    return 0;
  }
};

/** O singură rulare pe rând, între toate instanțele / cron-urile: altfel două rulări simultane ar citi același UID și ar crea cereri duble. */
async function acquireLock(): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const upd = await prisma.counter.updateMany({ where: { name: LOCK_KEY, value: { lt: now } }, data: { value: now + LOCK_SECONDS } });
  if (upd.count > 0) return true;
  if (await prisma.counter.findUnique({ where: { name: LOCK_KEY } })) return false; // ținut de altă rulare
  try {
    await prisma.counter.create({ data: { name: LOCK_KEY, value: now + LOCK_SECONDS } });
    return true;
  } catch {
    return false; // altă rulare l-a creat între timp
  }
}
const releaseLock = () => prisma.counter.updateMany({ where: { name: LOCK_KEY }, data: { value: 0 } }).catch(() => {});

const saveUid = (value: number) =>
  prisma.counter.upsert({ where: { name: LAST_UID_KEY }, create: { name: LAST_UID_KEY, value }, update: { value } });

/**
 * Procesează emailurile noi din INBOX și le convertește în tichete.
 *  • UID-ul ultimului mesaj procesat se salvează după FIECARE mesaj (o rulare întreruptă nu reia ce a terminat).
 *  • Prima rulare (sau după schimbarea UIDVALIDITY — căsuță recreată / migrată) NU transformă tot istoricul în cereri și confirmări: se iau doar mesajele din ultimele
 *    `IMAP_BACKFILL_DAYS` zile (implicit 2), iar restul se consideră deja văzut.
 *  • Un mesaj care dă eroare (bază de date, conexiune căzută) se reîncearcă la rularea următoare, nu se pierde; după 3 încercări e sărit.
 *  • Răspunsurile automate (Auto-Submitted, Precedence: bulk, liste, rapoarte de livrare) nu devin cereri și nu primesc confirmare — altfel două sisteme automate și-ar răspunde la nesfârșit.
 */
export async function pollInbox(): Promise<{ processed: number; errors: number; skipped?: string }> {
  if (!env.imap.enabled) return { processed: 0, errors: 0 };
  if (!(await acquireLock())) return { processed: 0, errors: 0, skipped: "o altă rulare e în curs" };
  try {
    return await pollLocked();
  } finally {
    await releaseLock();
  }
}

async function pollLocked(): Promise<{ processed: number; errors: number }> {
  const startedAt = Date.now();
  const lastUidRecord = await prisma.counter.findUnique({ where: { name: LAST_UID_KEY } });
  const validityRecord = await prisma.counter.findUnique({ where: { name: VALIDITY_KEY } });
  let lastUid = lastUidRecord?.value ?? 0;

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
      const validity = validityKey(client.mailbox && client.mailbox.uidValidity);
      const highest = Math.max(0, Number(client.mailbox && client.mailbox.uidNext ? client.mailbox.uidNext : 1) - 1);
      // referință nouă: nu avem UID salvat, sau căsuța are alt UIDVALIDITY (UID-urile repornesc, cele vechi nu mai sunt valabile).
      // Un UIDVALIDITY nesalvat încă (instalare existentă care trece la această versiune) NU înseamnă schimbare: doar îl memorăm.
      const baseline = !lastUidRecord || (!!validityRecord && validityRecord.value !== validity && validity !== 0);
      const saveValidity = async () => {
        if (validity !== 0 && validityRecord?.value !== validity) {
          await prisma.counter.upsert({ where: { name: VALIDITY_KEY }, create: { name: VALIDITY_KEY, value: validity }, update: { value: validity } });
        }
      };
      if (baseline) {
        console.log(`[imap] ${lastUidRecord ? `UIDVALIDITY schimbat (${validityRecord?.value} → ${validity})` : "prima rulare"}: se iau doar mesajele din ultimele ${env.imap.backfillDays} zile; restul se consideră văzute`);
        lastUid = 0;
        maxUid = 0;
      }

      // Căutăm mesajele cu UID mai mare decât ultimul procesat (n:* întoarce mereu cel puțin ultimul mesaj, deci filtrăm)
      let uids: number[] = [];
      if (!baseline || env.imap.backfillDays > 0) {
        const query: { uid: string; since?: Date } = { uid: `${lastUid + 1}:*` };
        if (baseline) query.since = new Date(Date.now() - env.imap.backfillDays * 86_400_000);
        const found = (await client.search(query, { uid: true })) as number[] | false;
        uids = (found || []).filter((u) => u > lastUid).sort((a, b) => a - b);
      }
      // În modul „referință” progresul pe mesaj NU se salvează (altfel mesajele vechi, de sub UID-ul salvat, ar fi luate la rularea următoare): la final UID-ul sare la capătul căsuței.
      const baselineTop = baseline ? Math.max(highest, uids.length ? uids[uids.length - 1] : 0) : 0;
      if (uids.length === 0) {
        if (baseline) {
          await saveUid(baselineTop);
          console.log(`[imap] referință stabilită: UID ${baselineTop} (niciun mesaj recent de preluat)`);
        }
        await saveValidity();
        return { processed: 0, errors: 0 };
      }
      console.log(`[imap] emailuri noi (UID>${lastUid}): ${uids.length > 20 ? `${uids.slice(0, 20).join(", ")}… (${uids.length})` : uids.join(", ")}`);
      const progress = async () => {
        if (!baseline) await saveUid(maxUid);
      };

      let handled = 0;
      let handledOk = 0;
      for (const uid of uids) {
        if (handled >= MAX_PER_POLL || Date.now() - startedAt > MAX_POLL_MS) {
          console.log(`[imap] limită pe rulare atinsă: ${handled} mesaje; continuă la următoarea`);
          break;
        }
        handled++;
        const failKey = FAIL_PREFIX + uid;
        try {
          let msg: import("imapflow").FetchMessageObject | null = null;
          for await (const m of client.fetch([uid], { uid: true, envelope: true, bodyStructure: true, source: true }, { uid: true })) {
            msg = m as import("imapflow").FetchMessageObject;
          }
          if (!msg) {
            // conexiunea a căzut în timpul citirii: nu e „mesaj șters”, ci o eroare trecătoare — mesajul se reia la rularea următoare
            if (!client.usable) throw new Error("conexiunea s-a întrerupt în timpul citirii");
            // UID inexistent (șters din căsuță între căutare și citire): îl marcăm ca procesat
            maxUid = Math.max(maxUid, uid);
            handledOk++;
            await progress();
            continue;
          }

          const parsed = await parseMessage(msg);
          if (!parsed) {
            maxUid = Math.max(maxUid, uid);
            handledOk++;
            await progress();
            continue;
          }

          const fromEmail = parsed.fromEmail.toLowerCase().trim();
          let skipReason: string | null = null;
          if (!fromEmail || fromEmail === env.imap.user.toLowerCase()) skipReason = "expeditor propriu / fără adresă";
          else if (parsed.automated) skipReason = `răspuns automat (${parsed.automated})`;
          else if (isRateLimited(fromEmail, 10, 60 * 60 * 1000)) skipReason = "prea multe mesaje de la același expeditor într-o oră";
          else {
            const spamReason = detectSpam(fromEmail, parsed.subject, parsed.bodyText);
            if (spamReason) skipReason = `spam: ${spamReason}`;
          }
          if (skipReason) {
            console.log(`[imap] ignorat uid=${uid} (${fromEmail || "?"}): ${skipReason}`);
          } else {
            await processInboundEmail(parsed);
            processed++;
          }
          maxUid = Math.max(maxUid, uid);
          handledOk++;
          await progress();
          await prisma.counter.deleteMany({ where: { name: failKey } });
        } catch (err) {
          errors++;
          console.error("[imap] eroare la procesarea mesajului uid=" + uid + ":", (err as Error).message);
          // reîncercăm la rularea următoare (fără să trecem peste el); după MAX_ATTEMPTS încercări îl sărim, ca să nu blocheze căsuța
          const rec = await prisma.counter.upsert({ where: { name: failKey }, create: { name: failKey, value: 1 }, update: { value: { increment: 1 } } }).catch(() => null);
          if (rec && rec.value >= MAX_ATTEMPTS) {
            console.error(`[imap] uid=${uid} sărit după ${MAX_ATTEMPTS} încercări eșuate`);
            maxUid = Math.max(maxUid, uid);
            handledOk++;
            await progress();
            await prisma.counter.deleteMany({ where: { name: failKey } });
            continue;
          }
          break;
        }
      }
      // prima rulare / după schimbarea UIDVALIDITY: mesajele mai vechi decât fereastra rămân „văzute”
      if (baseline && handled >= uids.length && uids.length === handledOk) {
        await saveUid(Math.max(baselineTop, maxUid));
        await saveValidity();
      } else if (!baseline) {
        await saveValidity();
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    console.error("[imap] conectare eșuată:", msg);
    await client.logout().catch(() => {});
    return { processed, errors: errors + 1 };
  } finally {
    await client.logout().catch(() => {});
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
  const inReplyTo = cleanId(mail.inReplyTo ?? "");
  const references = Array.isArray(mail.references) ? mail.references.join(" ") : (mail.references ?? "");

  // Corp: text/plain, iar dacă lipsește, HTML curățat; apoi fără citatul răspunsului anterior.
  const rawBody = (mail.text ?? "").trim() || htmlToText(typeof mail.html === "string" ? mail.html : "");
  const bodyText = stripQuotedReply(rawBody);

  // Fără Message-ID nu putem recunoaște un mesaj retrimis / reluat (căsuță migrată): îi dăm un identificator stabil, din conținut.
  const messageId = cleanId(mail.messageId ?? "") || `noid-${createHash("sha1").update([fromEmail, subject, mail.date?.toISOString() ?? "", bodyText].join("\n")).digest("hex").slice(0, 32)}@imap.local`;

  return { fromEmail, fromName, subject, bodyText, messageId, inReplyTo, references, automated: automatedReason(mail) };
}

const headerText = (mail: ParsedMail, name: string): string => {
  const v = mail.headers.get(name) as unknown;
  if (v == null) return "";
  if (typeof v === "string") return v;
  const o = v as { text?: string; value?: unknown };
  return typeof o.text === "string" ? o.text : typeof o.value === "string" ? o.value : "";
};

/** Antetele care arată că mesajul e scris de un program (OOO, newsletter, raport de livrare), nu de un om — vezi detectAutomated. */
function automatedReason(mail: ParsedMail): string | null {
  const ct = mail.headers.get("content-type") as unknown as { value?: string } | undefined;
  return detectAutomated({
    "auto-submitted": headerText(mail, "auto-submitted"),
    precedence: headerText(mail, "precedence"),
    "x-autoreply": headerText(mail, "x-autoreply") || headerText(mail, "x-autorespond"),
    "list-id": headerText(mail, "list-id"),
    "list-unsubscribe": headerText(mail, "list-unsubscribe"),
    "return-path": headerText(mail, "return-path"),
    "x-failed-recipients": headerText(mail, "x-failed-recipients"),
    "content-type": typeof ct?.value === "string" ? ct.value : "",
  });
}

function cleanId(id: string): string {
  return id.replace(/^<|>$/g, "").trim();
}
