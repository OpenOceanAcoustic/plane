import type { ApiClient } from "../../lib/client";
import type { Entity } from "../../components/ui";
export type WorkspaceRoute = { page: string; projectId?: string; issueId?: string; id?: string };
export type WorkspaceProps = {
  section: string;
  workspaceSlug: string;
  client: ApiClient;
  onNavigate: (route: WorkspaceRoute) => void;
};
export type Draft = Entity & {
  id: string;
  name: string;
  project_id?: string;
  description_html?: string;
  priority?: string;
  state_id?: string;
  assignee_ids?: string[];
  label_ids?: string[];
  cycle_id?: string;
  module_ids?: string[];
};
export type Page<T> = {
  results?: T[];
  next_cursor?: string;
  prev_cursor?: string;
  next_page_results?: boolean;
  prev_page_results?: boolean;
  total_count?: number;
};
export const workspacePath = (slug: string) => `/api/workspaces/${encodeURIComponent(slug)}`;
export function viewQuery(filters: Record<string, unknown>, cursor = ""): string {
  const query = new URLSearchParams({ per_page: "30", order_by: "-created_at" });
  for (const [key, value] of Object.entries(filters)) {
    if (value === null || value === undefined || value === "") continue;
    if (Array.isArray(value)) {
      if (value.length) query.set(key, value.join(","));
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean")
      query.set(key, String(value));
  }
  if (cursor) query.set("cursor", cursor);
  return query.toString();
}
export function activeCycle(cycle: Entity, today = new Date().toLocaleDateString("en-CA")): boolean {
  if (cycle.status === "current" || cycle.status === "active") return true;
  const start = String(cycle.start_date ?? "").slice(0, 10),
    end = String(cycle.end_date ?? "").slice(0, 10);
  return !!start && !!end && start <= today && end >= today;
}
export class WorkspaceService {
  readonly base: string;
  constructor(
    readonly client: ApiClient,
    slug: string
  ) {
    this.base = workspacePath(slug);
  }
  async publishDraft(id: string): Promise<Draft> {
    const draft = await this.client.request<Draft>(`${this.base}/draft-issues/${id}/`);
    if (!draft.project_id || !draft.name?.trim()) throw new Error("请先设置项目和任务名称，再发布草稿");
    const fields = [
      "name",
      "description_html",
      "priority",
      "state_id",
      "assignee_ids",
      "label_ids",
      "estimate_point",
      "parent_id",
      "start_date",
      "target_date",
      "type_id",
    ];
    const body: Record<string, unknown> = {};
    for (const key of fields) if (draft[key] !== undefined) body[key] = draft[key];
    // The conversion endpoint transfers the draft's cycle/modules after creating the issue.
    if (draft.cycle_id) body.cycle_id = draft.cycle_id;
    if (draft.module_ids) body.module_ids = draft.module_ids;
    return this.client.request<Draft>(`${this.base}/draft-to-issue/${id}/`, "POST", body);
  }
}
