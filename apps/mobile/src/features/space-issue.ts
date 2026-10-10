import type { Entity } from "../components/ui";
import { priorityName } from "./core/model";

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

export function spaceIssueProperties(
  issue: Entity,
  metadata: { states: Entity[]; members: Entity[]; labels: Entity[] }
): [string, string][] {
  const state = issue.state_id ? metadata.states.find((row) => row.id === issue.state_id) : undefined;
  const assignees = ids(issue.assignee_ids).map((id) => {
    // Public members expose the user ID as member; id identifies the membership.
    const member = metadata.members.find((row) => row.member === id);
    return member ? String(member.member__display_name ?? "成员") : "未知成员";
  });
  const labels = ids(issue.label_ids).map((id) => {
    const label = metadata.labels.find((row) => row.id === id);
    return label ? String(label.name) : "未知标签";
  });
  return [
    ["状态", state ? String(state.name) : issue.state_id ? "未知状态" : "未设置"],
    ["优先级", priorityName(issue.priority)],
    ["负责人", assignees.join("、") || "未分配"],
    ["标签", labels.join("、") || "无标签"],
    ["开始日期", issue.start_date ? String(issue.start_date) : "未设置"],
    ["截止日期", issue.target_date ? String(issue.target_date) : "未设置"],
  ];
}
