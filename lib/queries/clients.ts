import "server-only";
import { unstable_cache } from "next/cache";
import type { Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { DEMO, demoClients } from "../demo";
import { clientNamesFor } from "./client-names";

export type ClientListItem = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  telegramChatId: string | null;
  notes: string | null;
  noShowCount: number;
  lastAppointmentAt: Date | null;
};

const LIST_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  telegramChatId: true,
  notes: true,
  noShowCount: true,
  lastAppointmentAt: true,
} as const;

const PAGE_SIZE = 20;

/**
 * Clienții "de CRM": fără serie de contor (nu sunt plătitori Apă-Canal — aceia au secțiunea lor,
 * Plătitori) și neimportați din 1C. `meterSeries: null` singur nu prinde clienții la care câmpul
 * lipsește complet; isSet:false îi acoperă.
 */
const CRM_CLIENT_WHERE: Prisma.ClientWhereInput = {
  AND: [
    { OR: [{ meterSeries: null }, { meterSeries: { isSet: false } }] },
    { apaCanalImport: { not: true } },
  ],
};

/** Listare paginată + search (nume/telefon), select minimal. */
export async function listClients(
  _userId: string,
  opts: { search?: string; page?: number; pageSize?: number } = {},
) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const search = opts.search?.trim();

  if (DEMO) {
    const filtered = search
      ? demoClients.filter(
          (c) =>
            c.name.toLowerCase().includes(search.toLowerCase()) ||
            (c.phone ?? "").includes(search),
        )
      : demoClients;
    return { items: filtered, total: filtered.length, page: 1, pageSize, hasMore: false };
  }

  // Plătitorii (clienți portal Apă-Canal, cu serie de contor) au propria secțiune ("Plătitori")
  // — nu aglomerează lista obișnuită de clienți (programări).
  const where = {
    ...CRM_CLIENT_WHERE,
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.client.findMany({
      where,
      select: LIST_SELECT,
      orderBy: [{ lastAppointmentAt: "desc" }, { name: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.client.count({ where }),
  ]);

  return {
    items,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };
}

/** Search rapid pentru autocomplete (formular programare). */
export async function searchClients(_userId: string, q: string, limit = 8) {
  const search = q.trim();
  if (!search) return [];
  if (DEMO) {
    return demoClients
      .filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          (c.phone ?? "").includes(search),
      )
      .slice(0, limit)
      .map((c) => ({ id: c.id, name: c.name, phone: c.phone }));
  }
  return prisma.client.findMany({
    where: {
      OR: [
        { name: { contains: search, mode: "insensitive" } },
        { phone: { contains: search } },
      ],
    },
    select: { id: true, name: true, phone: true },
    take: limit,
    orderBy: { name: "asc" },
  });
}

/**
 * Opțiunile de client pentru selectoarele din Task-uri / Proiecte / Tichete / Calendar.
 *
 * Doar clienții de CRM + cei deja legați de un proiect sau task (ca valoarea curentă să rămână
 * afișată la editare). Fără filtrul ăsta, cei ~19.000 de plătitori importați ajungeau în fiecare
 * pagină: ~2,7 MB de HTML și ~19.000 de <option> într-un singur filtru (blocaj pe telefon).
 * Plătitorii se caută din Plătitori / căutarea de clienți, nu dintr-un dropdown.
 */
export const crmClientOptions = unstable_cache(
  async (): Promise<{ id: string; name: string }[]> => {
    if (DEMO) return [];
    // `distinct` din Prisma aduce TOATE documentele și le deduplică în memorie (secunde la zeci de mii de task-uri): grupăm în baza de date.
    const distinctClientIds = async (model: "task" | "project"): Promise<string[]> => {
      const res = (await (prisma[model] as unknown as { aggregateRaw: (a: unknown) => Promise<unknown> }).aggregateRaw({
        pipeline: [{ $match: { clientId: { $ne: null } } }, { $group: { _id: "$clientId" } }],
        options: { allowDiskUse: true },
      })) as unknown as { _id: { $oid?: string } | string }[];
      return res.map((r) => (typeof r._id === "string" ? r._id : r._id?.$oid)).filter((x): x is string => !!x);
    };
    const [crm, taskIds, projectIds] = await Promise.all([
      prisma.client.findMany({ where: CRM_CLIENT_WHERE, select: { id: true, name: true } }),
      distinctClientIds("task"),
      distinctClientIds("project"),
    ]);
    const have = new Set(crm.map((c) => c.id));
    const extraIds = [...new Set([...taskIds, ...projectIds].filter((id) => !have.has(id)))];
    // clienții legați de task-uri / proiecte dar în afara CRM-ului (de ex. plătitori): `id in [mii]` e lent, deci din harta numelor (vezi client-names.ts)
    const extraNames = await clientNamesFor(extraIds);
    const extra = [...extraNames].map(([id, name]) => ({ id, name }));
    return [...crm, ...extra].sort((a, b) => a.name.localeCompare(b.name, "ro"));
  },
  ["crm-client-options"],
  { tags: ["clients"], revalidate: 60 },
);

/** crmClientOptions + un client anume (ex: al facturii deschise), ca valoarea curentă să rămână selectabilă. */
export async function crmClientOptionsPlus(extraId?: string | null): Promise<{ id: string; name: string }[]> {
  const base = await crmClientOptions();
  if (!extraId || base.some((c) => c.id === extraId)) return base;
  const extra = await prisma.client.findFirst({ where: { id: extraId }, select: { id: true, name: true } }).catch(() => null);
  return extra ? [...base, extra].sort((a, b) => a.name.localeCompare(b.name, "ro")) : base;
}

export async function clientOptions(_userId: string): Promise<{ id: string; name: string }[]> {
  return crmClientOptions();
}

export async function getClient(_userId: string, id: string) {
  if (DEMO) return demoClients.find((c) => c.id === id) ?? null;
  return prisma.client.findFirst({
    where: { id },
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      telegramChatId: true,
      notes: true,
      noShowCount: true,
      lastAppointmentAt: true,
    },
  });
}

/**
 * Găsește un client după nume (case-insensitive) sau îl creează.
 * Folosit la crearea de programări din web/telegram/voce.
 */
export async function findOrCreateClient(
  userId: string,
  data: { name: string; phone?: string; email?: string; telegramChatId?: string },
) {
  const name = data.name.trim();
  const existing = await prisma.client.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true, phone: true, email: true, telegramChatId: true },
  });
  if (existing) {
    // completează datele lipsă fără a suprascrie ce există
    const patch: Record<string, string> = {};
    if (data.phone && !existing.phone) patch.phone = data.phone;
    if (data.email && !existing.email) patch.email = data.email;
    if (data.telegramChatId && !existing.telegramChatId)
      patch.telegramChatId = data.telegramChatId;
    if (Object.keys(patch).length) {
      return prisma.client.update({
        where: { id: existing.id },
        data: patch,
        select: { id: true, name: true, phone: true, email: true, telegramChatId: true },
      });
    }
    return existing;
  }

  return prisma.client.create({
    data: {
      userId,
      name,
      phone: data.phone || null,
      email: data.email || null,
      telegramChatId: data.telegramChatId || null,
    },
    select: { id: true, name: true, phone: true, email: true, telegramChatId: true },
  });
}
