// Verifică inbox IMAP fără să proceseze nimic
import { ImapFlow } from "imapflow";

const host = process.env.IMAP_HOST;
const port = parseInt(process.env.IMAP_PORT || "993");
const secure = process.env.IMAP_SECURE !== "false";
const user = process.env.IMAP_USER;
const pass = process.env.IMAP_PASS;
const mailbox = process.env.IMAP_MAILBOX || "INBOX";

console.log(`Conectare la ${host}:${port} (secure=${secure}) ca ${user}...`);

const client = new ImapFlow({
  host, port, secure,
  auth: { user, pass },
  logger: false,
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 30000,
});

client.on("error", (err) => console.error("[imap] eroare:", err.message));

try {
  await client.connect();
  console.log("Conectat OK\n");

  const lock = await client.getMailboxLock(mailbox);
  try {
    const mb = client.mailbox;
    console.log(`Mailbox "${mailbox}": ${mb.exists} mesaje totale`);

    const unseenUids = await client.search({ seen: false }, { uid: true });
    const allUids = await client.search({ all: true }, { uid: true });
    console.log(`UNSEEN: ${unseenUids.length} | Total: ${allUids.length}\n`);

    const last15 = allUids.slice(-15);
    console.log("Ultimele 15 mesaje:");
    for (const uid of last15) {
      for await (const msg of client.fetch([uid], { uid: true, envelope: true, flags: true }, { uid: true })) {
        const seen = msg.flags?.has("\\Seen") ? "✓" : "○ UNSEEN";
        const from = msg.envelope?.from?.[0]?.address ?? "?";
        const subj = msg.envelope?.subject ?? "(fără subiect)";
        const date = msg.envelope?.date ? new Date(msg.envelope.date).toLocaleString("ro-RO") : "?";
        console.log(`  [${seen}] UID ${uid} | ${date} | ${from} | ${subj}`);
      }
    }
  } finally {
    lock.release();
  }
} catch (err) {
  console.error("Eroare conectare:", err.message);
} finally {
  await client.logout().catch(() => {});
}
