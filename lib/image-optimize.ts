/** Optimizare imagini în browser înainte de upload — fără dependențe externe. */

const MAX_PX = 1920;   // latura maximă
const QUALITY = 0.82;  // calitate JPEG/WebP

const SKIP_TYPES = new Set(["image/svg+xml", "image/gif", "image/webp"]);

/**
 * Redimensionează și comprimă o imagine dacă e necesar.
 * Fișierele non-imagine sau cele deja mici sunt returnate nemodificate.
 * Dacă output-ul e mai mare decât originalul, returnează originalul.
 */
export async function optimizeImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || SKIP_TYPES.has(file.type)) return file;
  // Sub 200KB și dimensiuni mici → probabil nu merită procesarea
  if (file.size < 200 * 1024) return file;

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(url);

      let { naturalWidth: w, naturalHeight: h } = img;

      // Calculează noile dimensiuni păstrând aspect ratio
      if (w > MAX_PX || h > MAX_PX) {
        if (w >= h) { h = Math.round(h * MAX_PX / w); w = MAX_PX; }
        else        { w = Math.round(w * MAX_PX / h); h = MAX_PX; }
      }

      // Dacă imaginea e deja mică și sub limita de size, nu recomprima
      if (img.naturalWidth <= MAX_PX && img.naturalHeight <= MAX_PX && file.size < 300 * 1024) {
        resolve(file);
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width  = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, w, h);

      // Preferă WebP; dacă browserul nu-l suportă, revine la JPEG
      const tryWebP = () => {
        canvas.toBlob((blob) => {
          if (blob && blob.size < file.size) {
            const name = file.name.replace(/\.[^.]+$/, ".webp");
            resolve(new File([blob], name, { type: "image/webp" }));
          } else {
            // WebP nu a ajutat (sau nu e suportat) — încearcă JPEG
            tryJpeg();
          }
        }, "image/webp", QUALITY);
      };

      const tryJpeg = () => {
        canvas.toBlob((blob) => {
          if (blob && blob.size < file.size) {
            const name = file.name.replace(/\.[^.]+$/, ".jpg");
            resolve(new File([blob], name, { type: "image/jpeg" }));
          } else {
            resolve(file); // compresia nu a ajutat, păstrează originalul
          }
        }, "image/jpeg", QUALITY);
      };

      // PNG cu transparență → păstrează PNG (recomprimat)
      if (file.type === "image/png") {
        canvas.toBlob((blob) => {
          if (blob && blob.size < file.size) {
            resolve(new File([blob], file.name, { type: "image/png" }));
          } else {
            resolve(file);
          }
        }, "image/png");
      } else {
        tryWebP();
      }
    };

    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

export function isImage(file: File): boolean {
  return file.type.startsWith("image/") && !SKIP_TYPES.has(file.type);
}
