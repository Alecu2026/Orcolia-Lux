/** Sigla AquaCRM (pătrat cu colțuri rotunjite, transparente, chiar în fișier): se afișează ca atare, fără rotunjire în plus. */
export default function BrandLogo({ size = 36, className = "" }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/icons/icon-192.png" alt="AquaCRM" width={size} height={size} className={`shrink-0 ${className}`} style={{ width: size, height: size }} />
  );
}
