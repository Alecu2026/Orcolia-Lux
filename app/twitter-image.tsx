import { renderLogoOgImage, OG_IMAGE_SIZE } from "@/lib/og-logo-image";

export const runtime = "nodejs";
export const alt = "CRM";
export const size = OG_IMAGE_SIZE;
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function Image() {
  return renderLogoOgImage(alt);
}
