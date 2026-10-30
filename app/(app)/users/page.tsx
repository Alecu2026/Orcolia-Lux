import { requirePermission, isSuper } from "@/lib/dal";
import { canImpersonateUser } from "@/lib/impersonation";
import { listUsers } from "@/lib/queries/users";
import { teamOptions } from "@/lib/queries/teams";
import UsersManager from "@/app/components/UsersManager";
import { listRoleTemplates } from "@/lib/queries/role-templates";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await requirePermission("users.manage");
  const [users, teams, roleTemplates] = await Promise.all([listUsers(), teamOptions(), listRoleTemplates()]);
  // conturile în care utilizatorul curent are voie să intre (simulare de login): butonul „Intră în cont” apare doar la ele
  const impersonable = user.impersonation ? [] : users.filter((u) => canImpersonateUser(user, u).ok).map((u) => u.id);
  return (
    <div className="w-full">
      <UsersManager users={users} teams={teams} roleTemplates={roleTemplates} viewerIsSuper={isSuper(user)} viewerId={user.id} viewerRole={user.role} impersonable={impersonable} />
    </div>
  );
}
