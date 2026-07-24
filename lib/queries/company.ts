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
  apaCanalLogo: string | null;
  apaCanalCompanyLine: string;
  apaCanalAddress: string;
  apaCanalEmail: string;
  apaCanalCodFiscal: string;
  apaCanalContactName: string;
  apaCanalContactsText: string;
  apaCanalAtentieText: string;
  apaCanalAnuntText: string;
  apaCanalTarifApa: number;
  apaCanalTarifCanal: number;
};

const APA_CANAL_DEFAULTS = {
  apaCanalCompanyLine: "S.A. Apa-Canal Cahul",
  apaCanalAddress: "mun.Cahul, str.31 August 1989 nr.1",
  apaCanalEmail: "apacanalmega@gmail.com",
  apaCanalCodFiscal: "Cod fiscal 1002603000859",
  apaCanalContactName: "Corneliu",
  apaCanalContactsText:
    "0 600-99-490 · Controlor Viber/Whatsapp\n0 (299) 2-20-00 · serviciul dispecerat 24/24\n0 601-05-866 · secția evidență și control\n0 605-58-819 · secția calcul\n0 688-96-964 · secția tehnică\n0 688-96-930 · anticamera",
  apaCanalAtentieText:
    "Vă atenționăm că în cazul neachitării acestei facturi de plată, în decurs de 10 zile de la data-limită de achitare indicată în ea, în conformitate cu legislația, operatorul este în drept să deconecteze instalațiile interne de apă și de canalizare ce aparțin, de la sistemul public de alimentare cu apă și de canalizare. Reconectarea instalațiilor interne de apă și de canalizare va fi posibilă după eliminarea cauzei care a dus la deconectare și după achitarea tarifului pentru reconectare.",
  apaCanalAnuntText:
    "Stimați consumatori, DVS aveți posibilitatea de a transmite indicii contorului de apă prin aplicația Viber sau WhatsApp, pe primul număr indicat mai jos, din data de 17 până pe data de 27.",
} as const;

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
  apaCanalLogo: null,
  ...APA_CANAL_DEFAULTS,
  apaCanalTarifApa: 0,
  apaCanalTarifCanal: 0,
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
  apaCanalLogo: true,
  apaCanalCompanyLine: true,
  apaCanalAddress: true,
  apaCanalEmail: true,
  apaCanalCodFiscal: true,
  apaCanalContactName: true,
  apaCanalContactsText: true,
  apaCanalAtentieText: true,
  apaCanalAnuntText: true,
  apaCanalTarifApa: true,
  apaCanalTarifCanal: true,
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
