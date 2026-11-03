/**
 * Cine poate bifa / debifa punctele din „Caiet de sarcini” (pagina Contract): doar acest cont, indiferent de rol sau permisiuni (nici administratorii nu pot).
 * Ceilalți cu „Gestionare utilizatori” văd pagina, bifele și pot scoate PDF-ul, dar nu le modifică. Verificarea se face pe server (setTenderCheckAction); interfața doar o reflectă.
 */
export const TENDER_EDITOR_EMAIL = "racustefan34@gmail.com";

export const canEditTenderChecks = (email: string | null | undefined): boolean =>
  !!email && email.trim().toLowerCase() === TENDER_EDITOR_EMAIL;
