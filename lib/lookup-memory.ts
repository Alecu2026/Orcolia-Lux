import "server-only";

/**
 * Hărțile mici păstrate în memorie pentru paginile de detaliu (nume de utilizatori / echipe / proiecte / categorii — vezi `taskLookups` în lib/queries/tasks.ts — și lista de categorii)
 * se golesc imediat ce se scrie pe User / Team / Project / Category (extensia Prisma din lib/prisma.ts), nu doar la expirarea timpului. Fără importuri, ca să poată fi folosit din lib/prisma.ts.
 * O încărcare pornită înainte de scriere nu mai ajunge în memorie (epocă). Starea stă pe `globalThis` (pachetele Next de producție nu partajează variabilele de modul).
 */
const g = globalThis as unknown as { __lookupEpoch?: number; __apptEpoch?: number; __clientEpoch?: number; __clientSearchEpoch?: number; __taskLookups?: unknown; __categoryList?: unknown };

export const lookupEpoch = (): number => g.__lookupEpoch ?? 0;

/** Epoca programărilor (lib/services/appointment-cache.ts): crește la orice scriere pe Appointment și pe User/Team/Project/Category (numele din liste). */
export const apptEpoch = (): number => g.__apptEpoch ?? 0;
export function bumpApptEpoch(): void {
  g.__apptEpoch = apptEpoch() + 1;
}

/** Epoca listei de clienți (lib/services/client-cache.ts): crește la orice scriere pe Client. */
export const clientEpoch = (): number => g.__clientEpoch ?? 0;
export function bumpClientEpoch(): void {
  g.__clientEpoch = clientEpoch() + 1;
}

/** Epoca indexului de căutare a clienților (lib/services/client-search.ts): crește doar la ce schimbă rezultatul căutării — client creat / șters sau cu nume / telefon schimbat. */
export const clientSearchEpoch = (): number => g.__clientSearchEpoch ?? 0;
export function bumpClientSearchEpoch(): void {
  g.__clientSearchEpoch = clientSearchEpoch() + 1;
}

export function clearLookupMemory(): void {
  g.__lookupEpoch = lookupEpoch() + 1;
  bumpApptEpoch();
  g.__taskLookups = undefined;
  g.__categoryList = undefined;
}
