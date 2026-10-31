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

/**
 * Mesajul e scris de un program, nu de un om? (răspuns automat „în afara biroului”, newsletter / listă, raport de livrare). Primește antetele relevante (nume cu litere mici).
 * Un răspuns automat nu trebuie să devină cerere și nu trebuie confirmat: confirmarea noastră ar primi alt răspuns automat și așa mai departe, la nesfârșit.
 * Returnează motivul sau null.
 */
export function detectAutomated(h: Record<string, string | undefined>): string | null {
  const v = (k: string) => (h[k] ?? "").trim();
  const autoSubmitted = v("auto-submitted").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return `Auto-Submitted: ${autoSubmitted}`;
  const precedence = v("precedence").toLowerCase();
  if (["bulk", "junk", "list", "auto_reply", "auto-reply"].includes(precedence)) return `Precedence: ${precedence}`;
  if (v("x-autoreply") || v("x-autorespond")) return "X-Autoreply";
  if (v("list-id") || v("list-unsubscribe")) return "mesaj de listă / newsletter";
  if (v("x-failed-recipients")) return "raport de livrare";
  if (v("return-path").replace(/\s/g, "") === "<>") return "Return-Path gol (notificare de livrare)";
  if (v("content-type").toLowerCase() === "multipart/report") return "raport de livrare (DSN)";
  return null;
}
