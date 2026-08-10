/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  reactCompiler: true,
  // playwright-core loads browsers.json + other data files at runtime via a
  // dynamic path Vercel's file tracer doesn't statically detect, so without
  // this the deployed function is missing them and Chromium fails to launch.
  outputFileTracingIncludes: {
    // Cheia e un glob (picomatch) potrivit cu ruta — parantezele pătrate din
    // "[token]" trebuie escapate, altfel picomatch le tratează ca o clasă de
    // caractere (`[token]` = un singur caracter dintre t/o/k/e/n), nu ca
    // literalul rutei, iar regula nu se aplică niciodată.
    "/api/invoice/public/\\[token\\]/pdf": [
      "node_modules/playwright-core/**",
      "node_modules/@sparticuz/chromium/**",
    ],
  },
};

export default nextConfig;
