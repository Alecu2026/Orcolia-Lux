// Feedback-ul clientului după închiderea unei cereri: nota (1–5) și un comentariu opțional (cod partajat server / browser).

export const FEEDBACK_MAX = 1000;
/** Nota de la care (inclusiv în jos) feedback-ul e semnalat personalului ca nemulțumire. */
export const FEEDBACK_LOW = 2;

/** Eroarea (cheie de traducere) sau null, dacă nota și comentariul sunt valide. */
export function validateFeedback(rating: unknown, comment: unknown): string | null {
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) return "Alege o notă de la 1 la 5.";
  if (comment != null && (typeof comment !== "string" || comment.length > FEEDBACK_MAX)) return "Comentariul este prea lung.";
  return null;
}
