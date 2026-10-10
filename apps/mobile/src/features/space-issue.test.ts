import { expect, it } from "vitest";
import { spaceIssueProperties } from "./space-issue";

it("resolves shared issue IDs with public metadata and Chinese property labels", () => {
  expect(
    spaceIssueProperties(
      {
        state_id: "state",
        assignee_ids: ["user-a", "user-b"],
        label_ids: ["label"],
        priority: "high",
        start_date: "2026-10-10",
        target_date: "2026-10-20",
      },
      {
        states: [{ id: "state", name: "进行中" }],
        members: [
          { id: "membership-a", member: "user-a", member__display_name: "林晓" },
          { id: "membership-b", member: "user-b", member__display_name: "周澄" },
        ],
        labels: [{ id: "label", name: "水声数据" }],
      }
    )
  ).toEqual([
    ["状态", "进行中"],
    ["优先级", "高"],
    ["负责人", "林晓、周澄"],
    ["标签", "水声数据"],
    ["开始日期", "2026-10-10"],
    ["截止日期", "2026-10-20"],
  ]);
});

it("distinguishes genuinely empty properties from references missing metadata", () => {
  expect(spaceIssueProperties({}, { states: [], members: [], labels: [] })).toEqual([
    ["状态", "未设置"],
    ["优先级", "无"],
    ["负责人", "未分配"],
    ["标签", "无标签"],
    ["开始日期", "未设置"],
    ["截止日期", "未设置"],
  ]);
  expect(
    spaceIssueProperties(
      { state_id: "missing", assignee_ids: ["missing"], label_ids: ["missing"] },
      { states: [], members: [], labels: [] }
    ).slice(0, 4)
  ).toEqual([
    ["状态", "未知状态"],
    ["优先级", "无"],
    ["负责人", "未知成员"],
    ["标签", "未知标签"],
  ]);
});
