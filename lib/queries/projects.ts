import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { ProjectStatus } from "@prisma/client";

export type ProjectRow = {
  id: string;
  seq: number | null;
  name: string;
  description: string | null;
  status: ProjectStatus;
  ownerId: string;
  clientId: string | null;
  assigneeId: string | null;
  teamId: string | null;
  taskCount: number;
  address: string | null;
  lat: number | null;
  lng: number | null;
};

export type ProjectFilter = {
  search?: string;
  status?: ProjectStatus;
  page?: number;
  pageSize?: number;
};

const PROJECT_PAGE_SIZE = 30;

export async function listProjects(
  filter: ProjectFilter = {},
): Promise<{ items: ProjectRow[]; hasMore: boolean; page: number; totalPages: number }> {
  if (DEMO) return { items: [], hasMore: false, page: 1, totalPages: 0 };
  const page = Math.max(1, filter.page ?? 1);
  const pageSize = filter.pageSize ?? PROJECT_PAGE_SIZE;

  const where: import("@prisma/client").Prisma.ProjectWhereInput = {};
  if (filter.status) where.status = filter.status;
  if (filter.search?.trim()) {
    const s = filter.search.trim();
    const seqMatch = s.match(/^#?(\d+)$/);
    if (seqMatch) {
      where.seq = parseInt(seqMatch[1], 10);
    } else {
      where.OR = [
        { name: { contains: s, mode: "insensitive" } },
        { description: { contains: s, mode: "insensitive" } },
      ];
    }
  }

  const [rows, total] = await Promise.all([
    prisma.project.findMany({
      where,
      select: {
        id: true,
        seq: true,
        name: true,
        description: true,
        status: true,
        ownerId: true,
        clientId: true,
        assigneeId: true,
        teamId: true,
        address: true,
        lat: true,
        lng: true,
        _count: { select: { tasks: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.project.count({ where }),
  ]);

  const totalPages = Math.ceil(total / pageSize);
  const hasMore = page < totalPages;
  return {
    items: rows.map((r) => ({
      id: r.id,
      seq: r.seq ?? null,
      name: r.name,
      description: r.description,
      status: r.status,
      ownerId: r.ownerId,
      clientId: r.clientId,
      assigneeId: r.assigneeId,
      teamId: r.teamId,
      taskCount: r._count.tasks,
      address: r.address ?? null,
      lat: r.lat ?? null,
      lng: r.lng ?? null,
    })),
    hasMore,
    page,
    totalPages,
  };
}

export const projectOptions = unstable_cache(
  async (): Promise<
    { id: string; name: string; assigneeId: string | null; teamId: string | null }[]
  > => {
    if (DEMO) return [];
    return prisma.project.findMany({
      where: { status: { in: ["ACTIVE", "ON_HOLD"] } },
      select: { id: true, name: true, assigneeId: true, teamId: true },
      orderBy: { name: "asc" },
    });
  },
  ["project-options"],
  { tags: ["projects"], revalidate: 300 },
);

export type ProjectPin = {
  id: string;
  seq: number | null;
  name: string;
  status: ProjectStatus;
  address: string | null;
  taskCount: number;
  lat: number;
  lng: number;
};

export async function listProjectsWithLocation(): Promise<ProjectPin[]> {
  if (DEMO) return [];
  const rows = await prisma.project.findMany({
    where: { lat: { not: null }, lng: { not: null } },
    select: {
      id: true,
      seq: true,
      name: true,
      status: true,
      address: true,
      lat: true,
      lng: true,
      _count: { select: { tasks: true } },
    },
    orderBy: { name: "asc" },
  });
  return rows
    .filter((r) => r.lat != null && r.lng != null)
    .map((r) => ({
      id: r.id,
      seq: r.seq,
      name: r.name,
      status: r.status,
      address: r.address ?? null,
      taskCount: r._count.tasks,
      lat: r.lat!,
      lng: r.lng!,
    }));
}

export async function getProject(id: string) {
  if (DEMO) return null;
  return prisma.project.findUnique({
    where: { id },
    select: {
      id: true,
      seq: true,
      name: true,
      description: true,
      status: true,
      ownerId: true,
      clientId: true,
      assigneeId: true,
      teamId: true,
      address: true,
      lat: true,
      lng: true,
    },
  });
}
