/** Filtre de bază anti-spam pentru emailuri inbound. */

const BLOCKED_SENDERS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply",
  "mailer-daemon", "postmaster", "bounce", "bounces",
  "notifications", "notification", "auto-reply",
]);

const SPAM_SUBJECTS = [
  /\bviagra\b/i, /\bcasino\b/i, /\blottery\b/i, /\bcrypto.?investment\b/i,
  /\bunsubscribe\b/i, /\bclick here\b/i, /make money fast/i,
];

const SPAM_BODY_PATTERNS = [
  /\bclick here to unsubscribe\b/i,
  /\bthis is an automated message\b/i,
  /auto-generated/i,
];

/** Returnează motivul de spam sau null dacă emailul pare legitim. */
export function detectSpam(from: string, subject: string, body: string): string | null {
  const localPart = from.split("@")[0]?.toLowerCase() ?? "";
  if (BLOCKED_SENDERS.has(localPart)) return `expeditor blocat: ${localPart}`;

  for (const re of SPAM_SUBJECTS) {
    if (re.test(subject)) return `subiect spam: ${re.source}`;
  }
  for (const re of SPAM_BODY_PATTERNS) {
    if (re.test(body)) return `corp spam: ${re.source}`;
  }

  // Prea scurt sau gol
  if (body.trim().length < 5) return "mesaj prea scurt";

  return null;
}
