import "server-only";
import { prisma } from "../prisma";

/** Fără diacritice, litere mici, doar litere/cifre separate prin spațiu. */
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, " ")
    .trim();

const STOP = new Set(["srl", "sa", "sc", "ii", "intreprinderea", "societatea", "firma", "domnul", "doamna", "dl", "dna"]);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Un cuvânt fără diacritice → expresie care acceptă și formele cu diacritice românești (a/ă/â, i/î, s/ș, t/ț). */
const diacriticPattern = (token: string) =>
  escapeRe(token)
    .replace(/a/g, "[aăâ]")
    .replace(/i/g, "[iî]")
    .replace(/s/g, "[sșş]")
    .replace(/t/g, "[tțţ]");

export type ClientOption = { id: string; name: string };

/**
 * Potriviri pentru un nume de client spus într-o comandă vocală. Căutăm în baza de date doar după cuvintele numelui (nu aducem toți cei
 * ~19.000 de clienți în AI sau în browser) și le clasăm aici. `bestId` e setat doar când potrivirea e clară (nume identic, sau un singur
 * candidat care conține toate cuvintele); altfel utilizatorul alege din `options`.
 */
export async function matchClientsByName(spoken: string): Promise<{ options: ClientOption[]; bestId: string | null }> {
  const q = norm(spoken);
  const tokens = [...new Set(q.split(" ").filter((t) => t.length >= 3 && !STOP.has(t)))].slice(0, 4);
  if (tokens.length === 0) return { options: [], bestId: null };

  const raw = (await prisma.client.findRaw({
    filter: { $or: tokens.map((t) => ({ name: { $regex: diacriticPattern(t), $options: "i" } })) },
    options: { projection: { name: 1 }, limit: 300 },
  })) as unknown as { _id: { $oid: string } | string; name?: string }[];

  const cands = raw
    .map((d) => ({ id: typeof d._id === "string" ? d._id : d._id?.$oid, name: d.name ?? "" }))
    .filter((d): d is { id: string; name: string } => !!d.id && !!d.name)
    .map((d) => {
      const n = norm(d.name);
      const hits = tokens.filter((t) => n.includes(t)).length;
      const exact = n === q;
      return { ...d, hits, exact, score: exact ? 1000 : n.includes(q) ? 100 + hits : hits };
    })
    .filter((d) => d.hits > 0)
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length);

  const options = cands.slice(0, 15).map(({ id, name }) => ({ id, name }));
  const top = cands[0];
  const second = cands[1];
  let bestId: string | null = null;
  if (top) {
    if (top.exact && !(second?.exact)) bestId = top.id;
    else if (top.hits === tokens.length && (!second || second.score < top.score)) bestId = top.id;
  }
  return { options, bestId };
}
