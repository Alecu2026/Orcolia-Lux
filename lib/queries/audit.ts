import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import type { Prisma } from "@prisma/client";

export type AuditLogRow = {
  id: string;
  userId: string | null;
  userName: string;
  userRole: string;
  action: string;
  module: string;
  objectId: string | null;
  objectName: string | null;
  oldValue: string | null;
  newValue: string | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
};

export type AuditFilter = {
  userId?: string;
  role?: string; // "ADMIN" | "STAFF"
  action?: string;
  module?: string;
  from?: Date;
  to?: Date;
  search?: string;
  page?: number;
  pageSize?: number;
};

const PAGE_SIZE = 30;

export async function listAuditLogs(
  filter: AuditFilter,
): Promise<{ items: AuditLogRow[]; hasMore: boolean; page: number; totalPages: number }> {
  if (DEMO) return { items: [], hasMore: false, page: 1, totalPages: 0 };

  const page = Math.max(1, filter.page ?? 1);
  const pageSize = filter.pageSize ?? PAGE_SIZE;

  const where: Prisma.AuditLogWhereInput = {};
  if (filter.userId) where.userId = filter.userId;
  if (filter.role) where.userRole = { contains: filter.role, mode: "insensitive" };
  if (filter.action) where.action = filter.action;
  if (filter.module) where.module = filter.module;
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }
  if (filter.search?.trim()) {
    const s = filter.search.trim();
    where.OR = [
      { objectName: { contains: s, mode: "insensitive" } },
      { userName: { contains: s, mode: "insensitive" } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  const totalPages = Math.ceil(total / pageSize);
  const hasMore = page < totalPages;
  return { items: rows, hasMore, page, totalPages };
}

export async function exportAuditLogs(
  filter: Omit<AuditFilter, "page" | "pageSize">,
): Promise<AuditLogRow[]> {
  if (DEMO) return [];

  const where: Prisma.AuditLogWhereInput = {};
  if (filter.userId) where.userId = filter.userId;
  if (filter.role) where.userRole = { contains: filter.role, mode: "insensitive" };
  if (filter.action) where.action = filter.action;
  if (filter.module) where.module = filter.module;
  if (filter.from || filter.to) {
    where.createdAt = {
      ...(filter.from ? { gte: filter.from } : {}),
      ...(filter.to ? { lte: filter.to } : {}),
    };
  }
  if (filter.search?.trim()) {
    const s = filter.search.trim();
    where.OR = [
      { objectName: { contains: s, mode: "insensitive" } },
      { userName: { contains: s, mode: "insensitive" } },
    ];
  }

  return prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 10_000,
  });
}
