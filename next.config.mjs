/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  reactCompiler: true,
  // Navigare instant: paginile (dinamice) vizitate sau prefetch-uite la intenție se păstrează în browser 30 s / 60 s; acțiunile de server
  // care schimbă date (revalidatePath) golesc singure acest cache, deci nu apar date vechi după o modificare.
  experimental: {
    staleTimes: { dynamic: 30, static: 60 },
    // pozele de contor trimise prin acțiuni de server pot depăși limita implicită de 1 MB (serverul le face WebP)
    serverActions: { bodySizeLimit: "25mb" },
    proxyClientMaxBodySize: "25mb",
  },
  // Portalul client: „tickets” → „cereri”. Linkurile vechi (din emailuri deja trimise) merg în continuare.
  async redirects() {
    return [
      { source: "/portal/tickets", destination: "/portal/cereri", permanent: true },
      { source: "/portal/tickets/:id", destination: "/portal/cereri/:id", permanent: true },
    ];
  },
  // Parser MIME pentru emailurile primite (IMAP): se încarcă din node_modules, nu se împachetează în bundle.
  serverExternalPackages: ["mailparser"],
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
