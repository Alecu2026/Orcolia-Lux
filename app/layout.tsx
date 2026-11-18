import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { env } from "@/lib/env";
import { getT } from "@/lib/i18n/server-t";
import { getLocaleFromCookie } from "@/lib/i18n/locale-cookie";
import { ThemeScript } from "@/app/components/ThemeScript";
import "./globals.css";
import { BRAND } from "@/lib/brand";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const baseMetadata: Metadata = {
  // Necesar ca og:image/twitter:image (generate din app/opengraph-image.tsx) să fie URL-uri
  // absolute corecte, indiferent de domeniul pe care rulează build-ul.
  metadataBase: new URL(env.appUrl),
  title: "AquaCRM",
  description: "Gestionare proiecte, sarcini și cereri — rapid și simplu.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "AquaCRM" },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { ...baseMetadata, description: t("Gestionare proiecte, sarcini și cereri — rapid și simplu.") };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: BRAND.brand },
    { media: "(prefers-color-scheme: dark)", color: "#0a0c10" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Necesar ca env(safe-area-inset-*) să raporteze valori reale în PWA standalone pe iOS —
  // fără asta, bara de jos fixă (nav, FAB, toasturi) se poziționează inconsistent la scroll.
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocaleFromCookie();
  // nonce-ul CSP al cererii (pus de proxy.ts): fără el scriptul inline de temă ar fi blocat
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body className="min-h-full antialiased">
        {children}
      </body>
    </html>
  );
}
