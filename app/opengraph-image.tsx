import { renderLogoOgImage, OG_IMAGE_SIZE } from "@/lib/og-logo-image";

export const runtime = "nodejs";
export const alt = "CRM";
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";
// Șablonul static ar prinde logo-ul doar la build — firma îl schimbă din Setări oricând,
// deci imaginea trebuie randată la fiecare cerere, nu doar o dată la deploy.
export const dynamic = "force-dynamic";

export default async function Image() {
  return renderLogoOgImage(alt);
}
