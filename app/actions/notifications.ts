"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { DEMO } from "@/lib/demo";

export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireUser();
  if (DEMO || user.impersonation) return; // în simulare de login starea „citit” a contului simulat nu se atinge
  await prisma.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true },
  });
  revalidatePath("/notificari");
}

export async function markNotificationRead(id: string): Promise<void> {
  const user = await requireUser();
  if (DEMO || user.impersonation) return;
  await prisma.notification.updateMany({
    where: { id, userId: user.id },
    data: { read: true },
  });
  revalidatePath("/notificari");
}

export async function clearReadNotifications(): Promise<void> {
  const user = await requireUser();
  if (DEMO || user.impersonation) return;
  await prisma.notification.deleteMany({ where: { userId: user.id, read: true } });
  revalidatePath("/notificari");
}

/** Marchează ca citite notificările date (cele pe care utilizatorul le-a văzut în inbox). Doar ale lui. */
export async function markNotificationsReadAction(ids: string[]): Promise<{ unread: number }> {
  const user = await requireUser();
  if (DEMO) return { unread: 0 };
  if (user.impersonation) return { unread: await prisma.notification.count({ where: { userId: user.id, read: false } }) };
  const valid = [...new Set((Array.isArray(ids) ? ids : []).filter((i) => typeof i === "string" && /^[0-9a-f]{24}$/i.test(i)))].slice(0, 100);
  if (valid.length) await prisma.notification.updateMany({ where: { id: { in: valid }, userId: user.id, read: false }, data: { read: true } });
  return { unread: await prisma.notification.count({ where: { userId: user.id, read: false } }) };
}
