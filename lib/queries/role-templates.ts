import "server-only";
import { prisma } from "../prisma";
import { DEMO } from "../demo";
import { mergeRoleTemplates, type RoleTemplate } from "../role-templates";

/** Șabloanele de roluri: tipurile implicite (cu modificările lor) + cele create de administrator. */
export async function listRoleTemplates(): Promise<RoleTemplate[]> {
  if (DEMO) return mergeRoleTemplates([]);
  const rows = await prisma.roleTemplate.findMany({ take: 300, select: { key: true, name: true, description: true, role: true, permissions: true, taskView: true } });
  return mergeRoleTemplates(rows);
}
