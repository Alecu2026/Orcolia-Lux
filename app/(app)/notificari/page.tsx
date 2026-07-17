import { requireUser } from "@/lib/dal";
import { listNotificationsPaged } from "@/lib/queries/notifications";
import NotificationsList from "@/app/components/NotificationsList";

export const dynamic = "force-dynamic";

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const ps = Math.min(200, Math.max(10, Number(sp.ps) || 20));
  const page = Math.max(1, Number(sp.page) || 1);
  const { items, total } = await listNotificationsPaged(user.id, page, ps);
  const totalPages = Math.max(1, Math.ceil(total / ps));

  return (
    <div className="w-full">
      <NotificationsList
        items={items}
        page={page}
        totalPages={totalPages}
        ps={ps}
        total={total}
      />
    </div>
  );
}
