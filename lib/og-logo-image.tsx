import { ImageResponse } from "next/og";
import sharp from "sharp";
import { getCompanySettings } from "@/lib/queries/company";

export const OG_IMAGE_SIZE = { width: 1200, height: 630 };

const BG = "#0d9488";

/**
 * Satori (motorul din spatele `next/og`) nu poate decoda WEBP în `<img>` — aruncă o eroare
 * criptică ("u2 is not iterable") care oprește tot răspunsul. Logo-ul din Setări e stocat ca
 * data URL, indiferent de format (upload-ul din CompanyDetailsForm nu forțează un format), deci
 * convertim mereu la PNG înainte de a-l da lui ImageResponse.
 */
async function toPngDataUrl(dataUrl: string): Promise<string> {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return dataUrl;
  const [, , base64] = match;
  // { failOn: "none" } — unele WEBP-uri au metadate de spațiu de culori invalide/corupte pe
  // care libvips le respinge implicit ("colourspace: parameter space not set"); modul lenient
  // ignoră acele metadate în loc să arunce eroare.
  const png = await sharp(Buffer.from(base64, "base64"), { failOn: "none" }).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

/**
 * Imaginea de previzualizare (Open Graph/Twitter) afișată de aplicații (WhatsApp, Telegram,
 * Facebook etc.) când cineva trimite linkul site-ului. Randată la cerere din logo-ul curent
 * din Setări (`CompanySettings.logo`, stocat ca data URL base64) — dacă firma nu are logo
 * încărcat, cade pe numele companiei ca text, pe fondul brand-ului.
 */
export async function renderLogoOgImage(alt: string) {
  const company = await getCompanySettings();
  const logo = company.logo ? await toPngDataUrl(company.logo).catch(() => null) : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: BG,
        }}
      >
        {logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logo}
            alt={alt}
            style={{ maxWidth: "70%", maxHeight: "70%", objectFit: "contain" }}
          />
        ) : (
          <div style={{ display: "flex", fontSize: 72, fontWeight: 700, color: "#ffffff", fontFamily: "sans-serif" }}>
            {company.companyName || "CRM"}
          </div>
        )}
      </div>
    ),
    { ...OG_IMAGE_SIZE },
  );
}
