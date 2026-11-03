import { can, type PermissionSubject } from "./permissions";

/**
 * Cine vede registrul „Nereguli contoare”: cine are „Plătitori – Vizualizare”, „Doar Nereguli contoare” sau „Administrare contoare” vede toate neregulile (implicit filtrate pe secția lui,
 * dar poate alege și alte secții); ORICE membru al unei secții (echipe) vede, fără nicio permisiune în plus, doar neregulile atribuite secției lui (câmpul „Secția responsabilă” din regulile
 * de nereguli) și le poate marca rezolvate. Fără permisiune și fără secție: fără acces.
 */
export type IssueAccess = { all: boolean; teamIds: string[] };

export function issueAccess(user: PermissionSubject & { teamIds?: string[] }): IssueAccess | null {
  const teamIds = user.teamIds ?? [];
  if (can(user, "payers.view") || canManageMeterIssues(user)) return { all: true, teamIds };
  return teamIds.length > 0 ? { all: false, teamIds } : null;
}

/** Neregulile pe care le are voie să le vadă (toate sau doar ale secțiilor lui). */
export function visibleIssues<T extends { teamId: string | null }>(rows: T[], a: IssueAccess): T[] {
  return a.all ? rows : rows.filter((r) => !!r.teamId && a.teamIds.includes(r.teamId));
}

/** Poate edita (cine remediază, secția, termenul) și rezolva orice neregulă: „Administrare contoare” sau „Doar Nereguli contoare”. */
export function canManageMeterIssues(user: PermissionSubject): boolean {
  return can(user, "meters.manage") || can(user, "meters.issues");
}

/** Poate marca neregula rezolvată: cine administrează neregulile, sau membrul secției responsabile. */
export function canResolveIssue(user: PermissionSubject & { teamIds?: string[] }, teamId: string | null): boolean {
  return canManageMeterIssues(user) || (!!teamId && (user.teamIds ?? []).includes(teamId));
}
