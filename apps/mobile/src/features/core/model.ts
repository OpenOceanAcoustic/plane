import type { ApiClient } from "../../lib/client";
import type { Entity } from "../../components/ui";

export type CoreRoute = { page: string; projectId?: string; issueId?: string; pageId?: string };
export type CoreProps = {
  section: string;
  workspaceSlug: string;
  projectId?: string;
  issueId?: string;
  client: ApiClient;
  onNavigate: (route: CoreRoute) => void;
};
export type NamedEntity = Entity & { id: string; name: string };
export type User = { id: string; display_name?: string; first_name?: string; email?: string };
export type Member = Entity & { member: User; role: number; is_active?: boolean };
export type Session = { user: User };
export type Task = NamedEntity & {
  description_html?: string;
  state_id?: string;
  state?: string;
  priority?: string;
  sequence_id?: number;
  project_id?: string;
  assignee_ids?: string[];
  label_ids?: string[];
  start_date?: string | null;
  target_date?: string | null;
  parent_id?: string | null;
  cycle_id?: string | null;
  module_ids?: string[];
  archived_at?: string | null;
  created_by?: string;
  is_subscribed?: boolean;
  estimate_point?: string | null;
};
export const priorities = [
  { value: "urgent", label: "紧急" },
  { value: "high", label: "高" },
  { value: "medium", label: "中" },
  { value: "low", label: "低" },
  { value: "none", label: "无" },
];
export const priorityName = (value: unknown): string => priorities.find((row) => row.value === value)?.label ?? "无";
export const groupNames: Record<string, string> = {
  backlog: "待办",
  unstarted: "未开始",
  started: "进行中",
  completed: "已完成",
  cancelled: "已取消",
};
export const moduleStatuses = [
  { value: "backlog", label: "待办" },
  { value: "planned", label: "已计划" },
  { value: "in-progress", label: "进行中" },
  { value: "paused", label: "暂停" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" },
];
export const relationNames: Record<string, string> = {
  blocking: "阻塞",
  blocked_by: "被阻塞",
  relates_to: "相关",
  duplicate: "重复",
  start_before: "先开始",
  start_after: "后开始",
  finish_before: "先完成",
  finish_after: "后完成",
};
export function userName(user: User | undefined): string {
  return user?.display_name || user?.first_name || user?.email || "成员";
}
export function dateLabel(value: unknown): string {
  if (!value) return "未设置";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? "未设置"
    : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}
export function safeTextHtml(value: string): string {
  return `<p>${value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`;
}
export function plainText(html: unknown): string {
  const value = String(html ?? "");
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(
      value.replace(/<br\s*\/?\s*>/gi, "\n").replace(/<\/p>/gi, "\n"),
      "text/html"
    );
    return document.body.textContent?.trim() ?? "";
  }
  return value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}
export function entityId(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  return value && typeof value === "object" && "id" in value ? String(value.id) : undefined;
}
export function entityName(value: unknown): string {
  if (value && typeof value === "object" && "name" in value) return String(value.name);
  return "未设置";
}
export function issueRows(data: unknown): Task[] {
  if (Array.isArray(data)) return data as Task[];
  if (!data || typeof data !== "object") return [];
  const value = data as Record<string, unknown>;
  const results = value.results ?? value.data ?? value.items;
  if (Array.isArray(results)) return results as Task[];
  if (results && typeof results === "object") return Object.values(results).flatMap(issueRows);
  return [];
}

export class CoreService {
  readonly workspacePath: string;
  readonly projectPath: string;
  constructor(
    public client: ApiClient,
    public workspaceSlug: string,
    public projectId: string
  ) {
    this.workspacePath = `/api/workspaces/${encodeURIComponent(workspaceSlug)}`;
    this.projectPath = `${this.workspacePath}/projects/${projectId}`;
  }
  taskPath(issueId: string): string {
    return `${this.projectPath}/issues/${issueId}/`;
  }
  saveTask(values: Record<string, string>, issueId?: string, owners?: string[], labels?: string[], parentId?: string) {
    const body: Record<string, unknown> = {
      name: values.name.trim(),
      priority: values.priority || "none",
      start_date: values.start_date || null,
      target_date: values.target_date || null,
    };
    if (values.state_id) body.state_id = values.state_id;
    if (values.description !== undefined) body.description_html = values.description;
    if (values.estimate_point !== undefined) body.estimate_point = values.estimate_point || null;
    if (owners !== undefined) body.assignee_ids = owners;
    if (labels !== undefined) body.label_ids = labels;
    if (parentId) body.parent_id = parentId;
    return this.client.request<Task>(
      issueId ? this.taskPath(issueId) : `${this.projectPath}/issues/`,
      issueId ? "PATCH" : "POST",
      body
    );
  }
  saveDescription(issueId: string, html: string) {
    return this.client.request<Task>(this.taskPath(issueId), "PATCH", { description_html: html });
  }
  deleteTask(issueId: string, reason: string) {
    return this.client.request(`${this.workspacePath}/lab/tasks/${issueId}/`, "DELETE", { reason });
  }
  comment(issueId: string, html: string, commentId?: string) {
    return this.client.request(
      `${this.taskPath(issueId)}comments/${commentId ? `${commentId}/` : ""}`,
      commentId ? "PATCH" : "POST",
      { comment_html: html }
    );
  }
  relate(issueId: string, relatedId: string, relation: string) {
    return this.client.request(`${this.taskPath(issueId)}issue-relation/`, "POST", {
      relation_type: relation,
      issues: [relatedId],
    });
  }
  unrelate(issueId: string, relatedId: string) {
    return this.client.request(`${this.taskPath(issueId)}remove-relation/`, "POST", { related_issue: relatedId });
  }
}
