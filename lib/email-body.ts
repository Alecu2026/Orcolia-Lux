/** Curățarea corpului emailurilor primite (HTML → text, scoaterea citatelor din răspunsuri). Fără dependențe de server: se testează direct. */

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** HTML → text simplu: păstrează rândurile (br, p, div, li, tr), scoate stilurile/scripturile și decodează entitățile. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return "";
  const text = html
    .replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(text)
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// „On … wrote:", „În data de … a scris:", „Pe … a scris:", „… написал(а):" — și când linia de atribuire e împărțită pe două rânduri.
const ATTRIBUTION = /^(On|In|În|Pe|La|Le|El|Am)\b.{0,400}?(wrote|a scris|написал(\(а\)|а|и)?|écrit|escribió|schrieb)\s*:?\s*$/i;
const ATTRIBUTION_RU = /^.{0,400}?(написал(\(а\)|а|и)?)\s*:?\s*$/i;
const SEPARATOR = /^\s*(-{2,}\s*(Original Message|Mesaj original|Mesajul original|Forwarded message|Исходное сообщение)\s*-{2,}|_{10,})\s*$/i;
const HDR_FROM = /^\s*(De la|From|De|От)\s*:/i;
const HDR_SENT = /^\s*(Trimis|Sent|Data|Date|Отправлено|Дата)\s*:/i;

/** Păstrează doar partea nouă a unui răspuns: taie de la linia de atribuire / separator / antetul Outlook; ignoră liniile citate cu „>”. */
export function stripQuotedReply(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const kept: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const joined = i + 1 < lines.length ? `${line.trim()} ${lines[i + 1].trim()}` : line.trim();
    if (SEPARATOR.test(line)) break;
    if (ATTRIBUTION.test(line.trim()) || ATTRIBUTION.test(joined) || (ATTRIBUTION_RU.test(line.trim()) && /\d{1,2}[:.]\d{2}|<[^>]+@/.test(line))) break;
    if (HDR_FROM.test(line) && lines.slice(i + 1, i + 5).some((l) => HDR_SENT.test(l))) break;
    if (/^\s*>/.test(line)) continue; // linie citată (citatul poate fi și deasupra răspunsului)
    kept.push(line);
  }
  const result = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // Dacă tot ce a rămas e gol (mesaj format doar din citat), nu pierdem mesajul.
  return result || text.replace(/^\s*>+ ?/gm, "").trim();
}
