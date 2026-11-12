/** @type {import('next').NextConfig} */
const nextConfig = {
  /* config options here */
  reactCompiler: true,
  // fără antetul „X-Powered-By: Next.js” (nu ajută pe nimeni în afară de cine caută versiuni vulnerabile)
  poweredByHeader: false,
  // Navigare instant: paginile (dinamice) vizitate sau prefetch-uite la intenție se păstrează în browser 30 s / 60 s; acțiunile de server
  // care schimbă date (revalidatePath) golesc singure acest cache, deci nu apar date vechi după o modificare.
  experimental: {
    staleTimes: { dynamic: 30, static: 60 },
    // pozele de contor trimise prin acțiuni de server pot depăși limita implicită de 1 MB (serverul le face WebP)
    serverActions: { bodySizeLimit: "25mb" },
    proxyClientMaxBodySize: "25mb",
  },
  // Antete de securitate pe toate răspunsurile. Content-Security-Policy (cu nonce per cerere) se pune în proxy.ts, nu aici.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(self), payment=(), usb=(), interest-cohort=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
        ],
      },
    ];
  },
  // Portalul client: „tickets” → „cereri”. Linkurile vechi (din emailuri deja trimise) merg în continuare.
  async redirects() {
    return [
      { source: "/portal/tickets", destination: "/portal/cereri", permanent: true },
      { source: "/portal/tickets/:id", destination: "/portal/cereri/:id", permanent: true },
    ];
  },
  // Parser MIME pentru emailurile primite (IMAP): se încarcă din node_modules, nu se împachetează în bundle.
  serverExternalPackages: ["mailparser", "pdfkit"],
  outputFileTracingIncludes: {
    // Decontarea PDF (pdfkit): fonturile din assets/fonts și datele pdfkit se citesc din disc la rulare
    "/api/portal/decontare/pdf": ["node_modules/pdfkit/**", "assets/fonts/**"],
    // Notificările tipărite (PDF cu foaie / document oficial pe plătitor): pdfkit și fonturile (DejaVu, Tinos) citite din disc la rulare
    "/api/platitori/notificari/pdf": ["node_modules/pdfkit/**", "assets/fonts/**"],
    // Factura publică PDF (pdfkit, fără Chromium): aceleași fonturi și date pdfkit citite la rulare.
    // Cheia e un glob (picomatch) potrivit cu ruta — parantezele pătrate din "[token]" trebuie escapate, altfel picomatch le tratează ca o clasă de caractere, nu ca literalul rutei.
    "/api/invoice/public/\\[token\\]/pdf": ["node_modules/pdfkit/**", "node_modules/sharp/**", "assets/fonts/**"],
  },
};

export default nextConfig;
