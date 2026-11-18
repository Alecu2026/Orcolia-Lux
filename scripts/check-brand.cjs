// Verifică dacă variabilele CSS ale brandului (app/globals.css) au aceleași valori ca lib/brand.ts. Rulare: npm run check:brand
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const brand = fs.readFileSync(path.join(root, "lib/brand.ts"), "utf8");
const css = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
const fromBrand = (k) => new RegExp(k + String.raw`:s*"(#[0-9a-fA-F]{6})"`).exec(brand)?.[1]?.toLowerCase();
const theme = css.slice(css.indexOf("@theme"), css.indexOf(".dark {"));
const dark = css.slice(css.indexOf(".dark {"), css.indexOf("}", css.indexOf(".dark {")));
const fromCss = (blk, name) => new RegExp("--color-" + name + String.raw`:s*(#[0-9a-fA-F]{6})`).exec(blk)?.[1]?.toLowerCase();
const pairs = [
  ["brand", fromCss(theme, "brand")], ["strong", fromCss(theme, "brand-strong")], ["soft", fromCss(theme, "brand-soft")],
  ["darkBrand", fromCss(dark, "brand")], ["darkStrong", fromCss(dark, "brand-strong")], ["darkSoft", fromCss(dark, "brand-soft")],
];
let ok = true;
for (const [k, css1] of pairs) {
  const b = fromBrand(k);
  const same = !!b && b === css1;
  ok = ok && same;
  console.log(`${same ? "OK  " : "DIFERIT"} ${k}: lib/brand.ts=${b} · globals.css=${css1}`);
}
process.exit(ok ? 0 : 1);
