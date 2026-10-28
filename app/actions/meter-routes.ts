"use server";

import { requireUser } from "@/lib/dal";
import { can } from "@/lib/permissions";
import type { RouteDto } from "@/lib/meter-routes";
import { deleteRoute, moveRoute, saveRoute } from "@/lib/services/meter-routes";
import { resolveIssue } from "@/lib/services/meter-issues";

/**
 * Administrarea rutelor de citire și a neregulilor contoarelor (permisiunea „Rute de citire …”). Logica stă în lib/services (într-un fișier „use server”
 * fiecare funcție exportată poate fi apelată din browser, deci aici sunt doar punțile verificate).
 */

export async function saveRouteAction(raw: unknown): Promise<{ ok: true; route: RouteDto } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can(user, "meters.manage")) return { ok: false, error: "Fără permisiune." };
  return saveRoute(user, raw);
}

export async function deleteRouteAction(id: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!can(user, "meters.manage")) return { ok: false, error: "Fără permisiune." };
  if (typeof id !== "string" || !/^[0-9a-f]{24}$/i.test(id)) return { ok: false, error: "Rută invalidă." };
  return deleteRoute(user, id);
}

export async function moveRouteAction(id: string, dir: "up" | "down"): Promise<{ ok: boolean }> {
  const user = await requireUser();
  if (!can(user, "meters.manage") || typeof id !== "string" || !/^[0-9a-f]{24}$/i.test(id) || (dir !== "up" && dir !== "down")) return { ok: false };
  await moveRoute(id, dir);
  return { ok: true };
}

export async function resolveIssueAction(id: string, note: string): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  if (!can(user, "meters.manage")) return { ok: false, error: "Fără permisiune." };
  return resolveIssue(user, String(id), typeof note === "string" ? note : null);
}
