import type { Entity } from "../../components/ui";
export type TaskLayout = "list" | "board" | "calendar" | "timeline" | "records";
export const displayFields = [
  { id: "key", name: "编号" },
  { id: "state", name: "状态" },
  { id: "priority", name: "优先级" },
  { id: "assignee", name: "负责人" },
  { id: "labels", name: "标签" },
  { id: "cycle", name: "周期" },
  { id: "module", name: "模块" },
  { id: "estimate", name: "估算" },
  { id: "start_date", name: "开始日期" },
  { id: "due_date", name: "截止日期" },
  { id: "attachment_count", name: "附件数量" },
  { id: "link", name: "链接数量" },
  { id: "sub_issue_count", name: "子任务数量" },
  { id: "created_on", name: "创建时间" },
  { id: "updated_on", name: "更新时间" },
];
export function objectValue(value: unknown): Entity {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Entity) : {};
}
export function layoutValue(value: unknown): TaskLayout {
  if (value === "kanban" || value === "board") return "board";
  if (value === "gantt" || value === "timeline") return "timeline";
  if (value === "spreadsheet" || value === "records") return "records";
  return value === "calendar" ? "calendar" : "list";
}
export function preferencePayload(
  current: Entity | undefined,
  values: {
    layout: TaskLayout;
    state: string;
    priority: string;
    assignees: string;
    labels: string;
    orderBy: string;
    groupBy: string;
    fields: string[];
    extraFilters?: Entity;
    secondaryGroup?: string;
    showEmpty?: boolean;
    subIssues?: boolean;
  }
): Entity {
  return {
    filters: {
      ...objectValue(current?.filters),
      ...values.extraFilters,
      state: values.state ? [values.state] : null,
      priority: values.priority ? [values.priority] : null,
      assignees: values.assignees ? [values.assignees] : null,
      labels: values.labels ? [values.labels] : null,
    },
    display_filters: {
      ...objectValue(current?.display_filters),
      layout:
        ({ board: "kanban", timeline: "gantt", records: "spreadsheet" } as Record<string, string>)[values.layout] ??
        values.layout,
      order_by: values.orderBy,
      group_by: values.groupBy || null,
      ...(values.secondaryGroup !== undefined ? { sub_group_by: values.secondaryGroup || null } : {}),
      ...(values.showEmpty !== undefined ? { show_empty_groups: values.showEmpty } : {}),
      ...(values.subIssues !== undefined ? { sub_issue: values.subIssues } : {}),
    },
    display_properties: {
      ...objectValue(current?.display_properties),
      ...Object.fromEntries(displayFields.map((row) => [row.id, values.fields.includes(row.id)])),
    },
  };
}
export function firstFilter(value: unknown): string {
  return Array.isArray(value) ? String(value[0] ?? "") : value == null ? "" : String(value);
}
