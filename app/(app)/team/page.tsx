import { requirePermission } from "@/lib/dal";
import { can } from "@/lib/permissions";
import { listTeams } from "@/lib/queries/teams";
import { userOptions } from "@/lib/queries/users";
import { listSections } from "@/lib/queries/sections";
import TeamsManager from "@/app/components/TeamsManager";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const user = await requirePermission("teams.view");
  const [teams, users, sections] = await Promise.all([listTeams(), userOptions(), listSections()]);
  return (
    <div className="w-full">
      <TeamsManager teams={teams} users={users} sections={sections} canManage={can(user, "teams.manage")} />
    </div>
  );
}
