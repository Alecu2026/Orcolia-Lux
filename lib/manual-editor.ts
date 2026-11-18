/**
 * Cine poate pune / înlocui / șterge pozele (screenshot-urile) din „Manual de utilizare”: doar acest cont, indiferent de rol sau permisiuni (nici ceilalți administratori nu pot).
 * Ceilalți administratori (cu „Gestionare utilizatori”) citesc manualul, dar nu modifică pozele. Verificarea se face pe server (app/actions/manual.ts); interfața doar o reflectă.
 * Contul se poate schimba din setările serverului: MANUAL_EDITOR_EMAIL (o adresă sau mai multe, separate prin virgulă).
 */
export const DEFAULT_MANUAL_EDITOR_EMAIL = "stefanracu012@gmail.com";

const editors = (): string[] =>
  (process.env.MANUAL_EDITOR_EMAIL || DEFAULT_MANUAL_EDITOR_EMAIL)
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export const canEditManual = (email: string | null | undefined): boolean => !!email && editors().includes(email.trim().toLowerCase());

/** Adresa afișată în pagină („pozele le modifică doar …”). */
export const manualEditorLabel = (): string => editors().join(", ");
