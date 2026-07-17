import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "../prisma";
import { DEMO } from "../demo";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "STAFF";
  isActive: boolean;
  isSuperAdmin: boolean;
  permissions: string[];
  notifyEvents: string[];
  telegramChatId: string | null;
  notifyScope: string;
  notifyTeamIds: string[];
  notifyMemberIds: string[];
};

const USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  isSuperAdmin: true,
  permissions: true,
  notifyEvents: true,
  telegramChatId: true,
  notifyScope: true,
  notifyTeamIds: true,
  notifyMemberIds: true,
} as const;

export async function listUsers(): Promise<UserRow[]> {
  if (DEMO) {
    return [
      { id: "demo-user", name: "Cont Demo", email: "demo@local", role: "ADMIN", isActive: true, isSuperAdmin: true, permissions: [], notifyEvents: [], telegramChatId: null, notifyScope: "ALL", notifyTeamIds: [], notifyMemberIds: [] },
    ];
  }
  return prisma.user.findMany({
    select: USER_SELECT,
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
}

export async function getUserById(id: string): Promise<UserRow | null> {
  if (DEMO) return null;
  return prisma.user.findUnique({ where: { id }, select: USER_SELECT });
}

/** Opțiuni minime pentru selectoare de asignare (utilizatori activi). Cache cross-request. */
export const userOptions = unstable_cache(
  async (): Promise<{ id: string; name: string }[]> => {
    if (DEMO) return [{ id: "demo-user", name: "Cont Demo" }];
    return prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  },
  ["user-options"],
  { tags: ["users"], revalidate: 300 },
);
