import { records, useData, type Entity } from "../../components/ui";
import type { ApiClient } from "../../lib/client";
import type { Member, User } from "./model";

/** Project membership uses user IDs; workspace membership supplies authorized user details. */
export function useProjectMembers(client: ApiClient, workspaceSlug: string, projectId: string) {
  const base = `/api/workspaces/${encodeURIComponent(workspaceSlug)}`;
  const memberships = useData<Entity[]>(client, `${base}/projects/${projectId}/members/`);
  const workspaceMembers = useData<Member[]>(client, `${base}/members/`);
  const data = memberships.data?.map((row): Member => {
    const member = row.member;
    const id = typeof member === "string" ? member : String((member as User | undefined)?.id ?? "");
    const user =
      typeof member === "object" && member
        ? (member as User)
        : (records(workspaceMembers.data).find((entry) => (entry.member as User | undefined)?.id === id)?.member as
            | User
            | undefined);
    return { ...row, role: Number(row.role), member: user ?? { id }, is_active: row.is_active !== false };
  });
  return {
    ...memberships,
    data,
    loading: memberships.loading || workspaceMembers.loading,
    error: memberships.error ?? workspaceMembers.error,
  };
}
