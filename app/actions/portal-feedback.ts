"use server";

import { requireClient } from "@/lib/client-dal";
import { submitTicketFeedback, type FeedbackResult } from "@/lib/services/ticket-feedback";
import { auditPortalAction } from "@/lib/services/impersonation";

/** Feedback-ul clientului (nota + comentariu) după ce cererea lui a fost finalizată. Clientul vine din sesiunea portalului, nu din formular. */
export async function submitTicketFeedbackAction(ticketId: string, rating: number, comment: string): Promise<FeedbackResult> {
  const client = await requireClient();
  // personalul care „simulează” un client nu trimite feedback în numele lui
  if (client.impersonation) return { ok: false, error: "Simulare: feedback-ul nu se trimite în numele clientului." };
  const res = await submitTicketFeedback(client, String(ticketId ?? ""), Number(rating), String(comment ?? "").slice(0, 2000));
  if (res.ok) await auditPortalAction(`feedback ${res.rating}/5`, String(ticketId));
  return res;
}
