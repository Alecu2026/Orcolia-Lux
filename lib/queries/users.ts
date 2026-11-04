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
  taskViewScope: string;
  taskViewTeamIds: string[];
  taskViewMemberIds: string[];
  /** Echipele din care face parte (aceleași cu membrii din pagina Echipe). */
  teamIds: string[];
  /** Secția din care face parte (Section); null = fără secție. */
  sectionId: string | null;
  /** Autentificarea în doi pași (TOTP) e activă pe cont. */
  totp?: boolean;
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
  taskViewScope: true,
  taskViewTeamIds: true,
  taskViewMemberIds: true,
  teamIds: true,
  sectionId: true,
  tableLook: true,
} as const;

export async function listUsers(): Promise<UserRow[]> {
  if (DEMO) {
    return [
      { id: "demo-user", name: "Cont Demo", email: "demo@local", role: "ADMIN", isActive: true, isSuperAdmin: true, permissions: [], notifyEvents: [], telegramChatId: null, notifyScope: "ALL", notifyTeamIds: [], notifyMemberIds: [], taskViewScope: "ALL", taskViewTeamIds: [], taskViewMemberIds: [], teamIds: [], sectionId: null },
    ];
  }
  const rows = await prisma.user.findMany({
    select: { ...USER_SELECT, totpEnabledAt: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return rows.map(({ totpEnabledAt, ...u }) => ({ ...u, totp: !!totpEnabledAt }));
}

export async function getUserById(id: string): Promise<UserRow | null> {
  if (DEMO) return null;
  return prisma.user.findUnique({ where: { id }, select: USER_SELECT });
}

/** Opțiuni minime pentru selectoare de asignare (utilizatori activi). Cache cross-request. */
export const userOptions = unstable_cache(
  async (): Promise<{ id: string; name: string; sectionId: string | null }[]> => {
    if (DEMO) return [{ id: "demo-user", name: "Cont Demo", sectionId: null }];
    return prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sectionId: true },
      orderBy: { name: "asc" },
    });
  },
  ["user-options"],
  { tags: ["users"], revalidate: 300 },
);
