/** Tipuri și constante comune (browser + server) pentru conversația unui tichet între client și operatori. */

export type ChatSender = "CLIENT" | "STAFF";

export type ChatMessage = {
  id: string;
  sender: ChatSender;
  authorName: string;
  body: string;
  /** ISO */
  createdAt: string;
};

/** Starea conversației, întoarsă de /api/tickets/[id]/chat la fiecare citire. */
export type ChatState = {
  messages: ChatMessage[];
  /** Statusul tichetului (NEW, IN_PROGRESS, DONE…). */
  status: string;
  /** Poate scrie cel care citește? */
  canWrite: boolean;
  /** Dacă nu poate scrie: motivul, afișat în locul căsuței de scris. */
  writeBlockedReason: string | null;
  /** Numele celui care citește (operatorul sau clientul). */
  viewerName: string;
  /** Până când a citit CEALALTĂ parte conversația (ISO) — pentru „Văzut". */
  peerReadAt: string | null;
};

export const CHAT_MAX_BODY = 2000;
/** Cât de des se verifică mesaje noi cât conversația e deschisă și vizibilă. */
export const CHAT_POLL_MS = 3000;
