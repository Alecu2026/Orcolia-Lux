import "server-only";
import { cache } from "react";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { QuietHoursConfig } from "../quiet-hours";
import { sanitizeAutoNotify } from "../auto-notify";
import { sanitizeIssueRules } from "../meter-issues";
import { parseStatusConfigs } from "../ticket-status-config";
import { AUTOCLOSE_DEFAULT_HOURS, cleanAutoCloseHours } from "../ticket-autoclose";

/**
 * Setările de administrare din pagina Setări, citite DINTR-O SINGURĂ interogare (înainte: orele de somn, închiderea automată, notificările automate, regulile neregulilor și
 * statusurile cereri își făceau fiecare câte una pe același rând). Cache per cerere. Se apelează doar pentru administratori — un utilizator obișnuit nu primește aceste date.
 */
export const getAdminSettings = cache(async () => {
  const row = DEMO
    ? null
    : await prisma.companySettings.findUnique({
        where: { singleton: "main" },
        select: {
          quietHoursEnabled: true,
          quietHoursStart: true,
          quietHoursEnd: true,
          quietHoursTz: true,
          emailTicketAutoCloseEnabled: true,
          emailTicketAutoCloseHours: true,
          autoNotify: true,
          meterIssueRules: true,
          ticketStatusConfig: true,
        },
      });
  const quietHours: QuietHoursConfig = {
    quietHoursEnabled: row?.quietHoursEnabled ?? false,
    quietHoursStart: row?.quietHoursStart ?? "22:00",
    quietHoursEnd: row?.quietHoursEnd ?? "07:00",
    quietHoursTz: row?.quietHoursTz ?? "Europe/Bucharest",
  };
  return {
    quietHours,
    autoClose: { enabled: row?.emailTicketAutoCloseEnabled ?? true, hours: cleanAutoCloseHours(row?.emailTicketAutoCloseHours) ?? AUTOCLOSE_DEFAULT_HOURS },
    autoNotify: sanitizeAutoNotify(row?.autoNotify),
    issueRules: sanitizeIssueRules(row?.meterIssueRules),
    statusConfigs: parseStatusConfigs(row?.ticketStatusConfig),
  };
});
