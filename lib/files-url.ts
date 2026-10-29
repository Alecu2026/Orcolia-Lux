/** Adresa unei miniaturi: serverul face (o singură dată) o variantă WebP mică și o ține pe disc. Linkurile externe (vechi) rămân neschimbate. */
export const THUMB_WIDTHS = [160, 320, 640] as const;

export function thumbUrl(url: string, width: (typeof THUMB_WIDTHS)[number]): string {
  return url.startsWith("/files/") && !url.includes("?") ? `${url}?w=${width}` : url;
}
