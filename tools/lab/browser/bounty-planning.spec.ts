/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { LabBounty, LabItem, LabPlanner } from "@plane/types";
import type { LabWorkflow } from "../../../apps/web/core/components/lab/workflow-types";

type Scenario = "unclaimed" | "member" | "ready";

async function fixture(page: Page, scenario: Scenario) {
  const member = scenario === "member";
  const item: LabItem = {
    id: "bounty-reference",
    title: "声学样本悬赏",
    status: member ? "active" : "todo",
    kind: "project",
    public: true,
    folder_id: "A",
    issue_id: "native-bounty",
    project_id: "project",
    project_name: "海声实验",
    issue_key: "OOA-42",
    priority: "high",
    target_date: "2026-10-15",
    category_id: "research",
    category_name: "科研",
    category_color: "#7c3aed",
    bounty_id: "bounty",
    bounty_status: member ? "active" : "open",
    is_bounty: true,
    can_edit_issue: !member,
    can_open_issue: !member,
    schedule: { future_count: 0, next_start: null, next_end: null, week_minutes: 0, total_count: 0 },
  };
  const planner: LabPlanner = {
    user_id: member ? "member" : "lead",
    team_access: !member,
    folders: [{ id: "A", name: "A", position: 0 }],
    categories: [{ id: "research", name: "科研", color: "#7c3aed", position: 0 }],
    items: [item],
    projects: member
      ? []
      : [
          {
            id: "project",
            name: "海声实验",
            lead: true,
            members: [{ id: "member", name: "实验成员" }],
            states: [],
            mapping: { todo: null, active: null, review: null, done: null },
          },
        ],
    timezone: "Asia/Shanghai",
    week_start: 1,
    step_minutes: 15,
  };
  const bounty: LabBounty = {
    id: "bounty",
    stage_id: "stage",
    project_id: "project",
    project: "海声实验",
    issue_id: "native-bounty",
    title: item.title,
    deliverable: "提交声学样本分析报告",
    criteria: "样本可复现，报告包含实验参数",
    budget: "20.00",
    reserved: member ? null : "20.00",
    awarded: "0.00",
    status: member ? "active" : "open",
    major: false,
    major_reasons: [],
    evidence: "",
    due_at: null,
    overdue: false,
    is_lead: !member,
    is_reviewer: false,
    is_independent_reviewer: false,
    allocations:
      scenario === "unclaimed"
        ? []
        : [
            {
              id: "allocation",
              user_id: "member",
              name: "实验成员",
              deliverable: "提交声学样本分析报告",
              planned: "20.00",
              awarded: "0.00",
              approved: true,
              confirmed: true,
              closed: false,
            },
          ],
    acceptances: [],
    access_level: member ? "task" : "project",
    can_edit_issue: !member,
    can_submit: member,
    can_manage_materials: false,
    category_color: "#7c3aed",
  };
  const state = {
    plannerReads: 0,
    detailReads: 0,
    workflowReads: 0,
    rejectNextStart: false,
    statusPatches: [] as unknown[],
    actions: [] as { action: string; body: unknown }[],
  };
  function workflow(): LabWorkflow {
    const current = bounty.status === "review" ? "acceptance" : bounty.status === "active" ? "active" : "claim";
    const nodeRows: [string, string][] = [
      ["publication", "发布团队任务"],
      ["claim", "成员认领与批准"],
      ["confirm", "本人确认分工"],
      ["active", "团队开工"],
      ["submit", "提交成果证据"],
      ["acceptance", "独立验收"],
      ["done", "完成与 VC 记账"],
    ];
    const nodes = nodeRows.map(([id, label], index) => ({
      id,
      label,
      x: index * 200,
      y: 0,
      state: id === current ? ("current" as const) : ("upcoming" as const),
    }));
    return {
      bounty_id: bounty.id,
      title: bounty.title,
      status: bounty.status,
      major: false,
      current_node: current,
      nodes,
      edges: nodes.slice(1).map((node, index) => ({
        id: `${nodes[index]!.id}-${node.id}`,
        source: nodes[index]!.id,
        target: node.id,
      })),
      history: [],
      actions:
        bounty.status === "open"
          ? [
              {
                id: "start",
                action: "start",
                label: "团队开工",
                node_id: "active",
                body: {},
                enabled: scenario === "ready",
                reason: scenario === "ready" ? "" : "需要批准分工并由所有参与者确认",
              },
            ]
          : member && bounty.status === "active"
            ? [
                {
                  id: "submit",
                  action: "submit",
                  label: "提交成果验收",
                  node_id: "submit",
                  body: {},
                  enabled: true,
                  reason: "",
                },
              ]
            : [],
    };
  }
  await page.setViewportSize({ width: 1600, height: 1080 });
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/lab/lab/")[1]!;
    if (path === "planner/") {
      state.plannerReads += 1;
      await route.fulfill({ json: planner });
    } else if (path === "calendar/") await route.fulfill({ json: { events: [], members: [] } });
    else if (path === "bounties/bounty/detail/") {
      state.detailReads += 1;
      await route.fulfill({ json: bounty });
    } else if (path === "bounties/bounty/workflow/") {
      state.workflowReads += 1;
      await route.fulfill({ json: workflow() });
    } else if (path === "items/bounty-reference/" && route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if ("status" in body) state.statusPatches.push(body);
      await route.fulfill({ status: 409, json: { error: "团队开工须批准分工并由所有参与者确认" } });
    } else if (
      ["bounties/bounty/start/", "bounties/bounty/submit/"].includes(path) &&
      route.request().method() === "POST"
    ) {
      const action = path.includes("/start/") ? "start" : "submit";
      state.actions.push({ action, body: route.request().postDataJSON() });
      if (action === "start" && state.rejectNextStart) {
        state.rejectNextStart = false;
        await route.fulfill({ status: 400, json: { error: "仍有参与者尚未确认，暂不能开工" } });
        return;
      }
      bounty.status = action === "start" ? "active" : "review";
      item.status = bounty.status;
      item.bounty_status = bounty.status;
      await route.fulfill({ json: { ok: true } });
    } else if (path === "bounties/") await route.fulfill({ json: [bounty] });
    else if (["stages/", "inbox/", "bounties/bounty/materials/"].includes(path)) await route.fulfill({ json: [] });
    else await route.fulfill({ status: 404, json: { error: "不存在的测试接口" } });
  });
  await page.goto("/workbench");
  await expect(page.getByRole("button", { name: `拖动 ${item.title}`, exact: true })).toBeVisible();
  return state;
}

async function dragTo(page: Page, column: string) {
  const handle = page.getByRole("button", { name: "拖动 声学样本悬赏", exact: true });
  const target = page.getByRole("region", { name: `${column}事项`, exact: true });
  await handle.scrollIntoViewIfNeeded();
  const start = await handle.boundingBox(),
    end = await target.boundingBox();
  expect(start).not.toBeNull();
  expect(end).not.toBeNull();
  await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
  await page.mouse.down();
  await page.mouse.move(end!.x + end!.width / 2, end!.y + 55, { steps: 12 });
  await page.mouse.up();
}

test("dropping an unclaimed bounty opens its controlled workflow without a native status PATCH", async ({ page }) => {
  const state = await fixture(page, "unclaimed");
  await dragTo(page, "进行中");
  await expect.poll(() => state.detailReads + state.statusPatches.length).toBeGreaterThan(0);
  expect(state.statusPatches).toEqual([]);
  const dialog = page.getByRole("dialog", { name: "悬赏任务办理", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "团队开工", exact: true })).toBeDisabled();
  await expect(dialog.getByText("需要批准分工并由所有参与者确认", { exact: true })).toBeVisible();
  await expect.poll(() => state.workflowReads).toBeGreaterThan(0);
  await expect(
    page.getByRole("region", { name: "待做事项", exact: true, includeHidden: true }).locator("article")
  ).toContainText("声学样本悬赏");
  expect(state.actions).toEqual([]);
  if (process.env.LAB_BOUNTY_PLANNING_SCREENSHOT) {
    await page.evaluate(() => document.fonts.ready);
    await dialog.screenshot({ path: process.env.LAB_BOUNTY_PLANNING_SCREENSHOT, animations: "disabled" });
  }
});

test("a confirmed task-only member submits evidence after dropping a bounty into review", async ({ page }) => {
  const state = await fixture(page, "member");
  await dragTo(page, "待验收");
  const submission = page.getByRole("dialog", { name: "提交成果验收", exact: true });
  await expect(submission).toBeVisible();
  expect(state.actions).toEqual([]);
  expect(state.detailReads).toBeGreaterThan(0);
  expect(state.workflowReads).toBeGreaterThan(0);
  await submission.getByLabel("成果、附件链接、探索记录", { exact: true }).fill("实验报告及可复现的样本记录");
  await submission.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() => state.actions)
    .toEqual([{ action: "submit", body: { evidence: "实验报告及可复现的样本记录" } }]);
  await expect(
    page.getByRole("region", { name: "待验收事项", exact: true, includeHidden: true }).locator("article")
  ).toContainText("声学样本悬赏");
  await expect(submission).toHaveCount(0);
  expect(state.statusPatches).toEqual([]);
});

test("a ready lead confirms team start before the bounty moves into the active column", async ({ page }) => {
  const state = await fixture(page, "ready");
  await dragTo(page, "进行中");
  const confirmation = page.getByRole("dialog", { name: "团队开工", exact: true });
  await expect(confirmation).toBeVisible();
  expect(state.actions).toEqual([]);
  expect(state.detailReads).toBeGreaterThan(0);
  expect(state.workflowReads).toBeGreaterThan(0);
  state.rejectNextStart = true;
  await confirmation.getByRole("button", { name: "保存", exact: true }).click();
  await expect(confirmation.getByRole("alert")).toHaveText("仍有参与者尚未确认，暂不能开工");
  await expect(
    page.getByRole("region", { name: "待做事项", exact: true, includeHidden: true }).locator("article")
  ).toContainText("声学样本悬赏");
  await expect(
    page.getByRole("region", { name: "进行中事项", exact: true, includeHidden: true }).locator("article")
  ).toHaveCount(0);
  expect(state.statusPatches).toEqual([]);
  const previousReads = state.plannerReads;
  const previousDetails = state.detailReads;
  await confirmation.getByRole("button", { name: "保存", exact: true }).click();
  await expect
    .poll(() => state.actions)
    .toEqual([
      { action: "start", body: {} },
      { action: "start", body: {} },
    ]);
  await expect.poll(() => state.plannerReads).toBeGreaterThan(previousReads);
  await expect.poll(() => state.detailReads).toBeGreaterThan(previousDetails);
  await expect(
    page.getByRole("region", { name: "进行中事项", exact: true, includeHidden: true }).locator("article")
  ).toContainText("声学样本悬赏");
  await expect(confirmation).toHaveCount(0);
  const outer = page.getByRole("dialog", { name: "悬赏任务办理", exact: true });
  await expect(outer.locator("dl").first()).toContainText("进行中");
  const previousWorkflow = state.workflowReads;
  await outer.getByRole("button", { name: "刷新", exact: true }).click();
  await expect.poll(() => state.workflowReads).toBeGreaterThan(previousWorkflow);
  await expect(confirmation).toHaveCount(0);
  expect(state.statusPatches).toEqual([]);
});
