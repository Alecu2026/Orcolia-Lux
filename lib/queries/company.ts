import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { QuietHoursConfig } from "../quiet-hours";

export type Company = {
  companyName: string;
  logo: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  taxId: string | null;
  vatNumber: string | null;
  bankDetails: string | null;
  currency: string;
  invoicePrefix: string;
  appointmentsLabel: string;
};

const DEFAULTS: Company = {
  companyName: "",
  logo: null,
  phone: null,
  email: null,
  address: null,
  taxId: null,
  vatNumber: null,
  bankDetails: null,
  currency: "MDL",
  invoicePrefix: "INV",
  appointmentsLabel: "Programări",
};

const SELECT = {
  companyName: true,
  logo: true,
  phone: true,
  email: true,
  address: true,
  taxId: true,
  vatNumber: true,
  bankDetails: true,
  currency: true,
  invoicePrefix: true,
  appointmentsLabel: true,
} as const;

const QH_DEFAULTS: QuietHoursConfig = {
  quietHoursEnabled: false,
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  quietHoursTz: "Europe/Bucharest",
};

export { type QuietHoursConfig };

/** Orele de somn (singleton). */
export async function getQuietHoursSettings(): Promise<QuietHoursConfig> {
  if (DEMO) return QH_DEFAULTS;
  const row = await prisma.companySettings.findUnique({
    where: { singleton: "main" },
    select: {
      quietHoursEnabled: true,
      quietHoursStart: true,
      quietHoursEnd: true,
      quietHoursTz: true,
    },
  });
  if (!row) return QH_DEFAULTS;
  return {
    quietHoursEnabled: row.quietHoursEnabled,
    quietHoursStart: row.quietHoursStart,
    quietHoursEnd: row.quietHoursEnd,
    quietHoursTz: row.quietHoursTz,
  };
}

/** Datele companiei (singleton). Cache cross-request. */
export const getCompanySettings = unstable_cache(
  async (): Promise<Company> => {
    if (DEMO) return { ...DEFAULTS, companyName: "Compania Demo SRL" };
    const row = await prisma.companySettings.findUnique({
      where: { singleton: "main" },
      select: SELECT,
    });
    return row ?? DEFAULTS;
  },
  ["company-settings"],
  { tags: ["company"], revalidate: 600 },
);
