import "server-only";
import { prisma } from "../prisma";
import { DEMO, demoClients } from "../demo";

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

  const where = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" as const } },
          { phone: { contains: search } },
        ],
      }
    : {};

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

export async function clientOptions(_userId: string): Promise<{ id: string; name: string }[]> {
  if (DEMO) return [];
  return prisma.client.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
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
