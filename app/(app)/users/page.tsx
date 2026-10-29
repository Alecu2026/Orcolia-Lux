import { requirePermission, isSuper } from "@/lib/dal";
import { listUsers } from "@/lib/queries/users";
import { teamOptions } from "@/lib/queries/teams";
import UsersManager from "@/app/components/UsersManager";
import { listRoleTemplates } from "@/lib/queries/role-templates";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requirePermission("users.manage");
  const [users, teams, roleTemplates] = await Promise.all([listUsers(), teamOptions(), listRoleTemplates()]);
  return (
    <div className="w-full">
      <UsersManager users={users} teams={teams} roleTemplates={roleTemplates} viewerIsSuper={isSuper(user)} viewerId={user.id} viewerRole={user.role} />
    </div>
  );
}
