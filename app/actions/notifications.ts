"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/dal";
import { DEMO } from "@/lib/demo";

export async function markAllNotificationsRead(): Promise<void> {
  const user = await requireUser();
  if (DEMO) return;
  await prisma.notification.updateMany({
    where: { userId: user.id, read: false },
    data: { read: true },
  });
  revalidatePath("/notificari");
}

export async function markNotificationRead(id: string): Promise<void> {
  const user = await requireUser();
  if (DEMO) return;
  await prisma.notification.updateMany({
    where: { id, userId: user.id },
    data: { read: true },
  });
  revalidatePath("/notificari");
}

export async function clearReadNotifications(): Promise<void> {
  const user = await requireUser();
  if (DEMO) return;
  await prisma.notification.deleteMany({ where: { userId: user.id, read: true } });
  revalidatePath("/notificari");
}
