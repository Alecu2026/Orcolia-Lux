// Listează textele din cod scrise ca t("…") care nu au traducere în engleză sau în rusă (lib/i18n/dict/*.ts).
// Folosire: node scripts/check-i18n.mjs            → rezumat + lista lipsurilor
//           node scripts/check-i18n.mjs --strict   → ieșire cu cod 1 dacă lipsește ceva (pentru CI)
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const strict = process.argv.includes("--strict");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|mjs)$/.test(name) && !p.includes(join("lib", "i18n", "dict"))) out.push(p);
  }
  return out;
}

function parseDict(file) {
  const src = readFileSync(join(ROOT, "lib/i18n/dict", file), "utf8");
  const keys = new Set();
  // chei de forma  "text": "traducere",   (ghilimele duble, cu escape-uri)
  const re = /^\s*"((?:[^"\\]|\\.)*)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$/gm;
  let m;
  while ((m = re.exec(src))) keys.add(JSON.parse(`"${m[1]}"`));
  return keys;
}

const EN = parseDict("en.ts");
const RU = parseDict("ru.ts");

// t("text") / t('text') / t(`text`) — doar literale simple
const callRe = /\b(?:t|tr)\(\s*("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\$]|\\.)*`)/g;
const used = new Map();
for (const file of [...walk(join(ROOT, "app")), ...walk(join(ROOT, "lib"))]) {
  const src = readFileSync(file, "utf8");
  let m;
  while ((m = callRe.exec(src))) {
    let lit = m[1];
    let text;
    try {
      text = lit[0] === '"' ? JSON.parse(lit) : lit.slice(1, -1).replace(/\\(['`\\])/g, "$1");
    } catch {
      continue;
    }
    if (!used.has(text)) used.set(text, relative(ROOT, file));
  }
}

const missEn = [...used].filter(([k]) => !EN.has(k));
const missRu = [...used].filter(([k]) => !RU.has(k));
console.log(`Texte folosite cu t(): ${used.size} · în engleză: ${used.size - missEn.length} · în rusă: ${used.size - missRu.length}`);
if (missEn.length) {
  console.log(`\nLipsesc în EN (${missEn.length}):`);
  for (const [k, f] of missEn) console.log(`  ${JSON.stringify(k)}   ← ${f}`);
}
if (missRu.length) {
  console.log(`\nLipsesc în RU (${missRu.length}):`);
  for (const [k, f] of missRu) console.log(`  ${JSON.stringify(k)}   ← ${f}`);
}
if (strict && (missEn.length || missRu.length)) process.exit(1);
