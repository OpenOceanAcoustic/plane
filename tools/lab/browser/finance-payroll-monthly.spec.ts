/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(
  page: Page,
  options: {
    ai?: boolean;
    failFirst?: boolean;
    canGenerate?: boolean;
    canManageSchedule?: boolean;
    enabled?: boolean;
    empty?: boolean;
  } = {}
) {
  const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
  let enabled = options.enabled ?? false;
  let generated = false;
  let posts = 0;
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test-csrf" } }));
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method !== "GET") writes.push({ method, path: url.pathname, body: route.request().postDataJSON() });
    if (url.pathname.endsWith("/finance-management/")) {
      return route.fulfill({
        json: {
          today: "2026-10-26",
          project_id: "project-a",
          user_id: "member-a",
          funding_id: "funding",
          can_view_finance: true,
          can_record: true,
          can_approve: options.canGenerate ?? true,
          can_pay: true,
          can_audit: true,
          can_recover: true,
          closed: false,
          members: [{ id: "member-a", name: "成员甲" }],
          records: [],
          accounts: [],
          categories: [],
          summary: null,
        },
      });
    }
    if (!url.pathname.endsWith("/payroll-monthly/")) return route.fulfill({ json: [] });
    if (method === "POST") {
      posts++;
      if (options.failFirst && posts === 1) return route.fulfill({ status: 400, json: { error: "月份暂不可生成" } });
      const body = route.request().postDataJSON();
      const count = generated || options.empty ? 0 : body.project_ids.length === 2 ? 3 : 2;
      generated = true;
      return route.fulfill({
        json: {
          month: body.month,
          created_count: count,
          created_amount: count === 3 ? "375.00" : count ? "300.00" : "0.00",
          projects: body.project_ids.map((id: string) => ({
            project_id: id,
            created_count: count ? (id === "project-a" ? 2 : 1) : 0,
            created_amount: count ? (id === "project-a" ? "300.00" : "75.00") : "0.00",
            status: "success",
            error: "",
            records: [],
          })),
        },
      });
    }
    if (method === "PATCH") enabled = route.request().postDataJSON().enabled;
    const month = url.searchParams.get("month") || "2026-10";
    const [year, monthNumber] = month.split("-").map(Number);
    const end = `${month}-${new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()}`;
    const schedule = {
      enabled,
      actor_name: enabled ? "负责人" : null,
      next_run_at: enabled ? "2026-10-31T15:55:00Z" : null,
      last_run_at: options.enabled ? "2026-09-30T15:55:00Z" : null,
      last_status: options.enabled ? "success" : null,
      last_error: null,
      last_month: options.enabled ? "2026-09" : null,
    };
    return route.fulfill({
      json: {
        month,
        current_month: "2026-10",
        start: `${month}-01`,
        end,
        timezone: "Asia/Shanghai",
        time: "23:55",
        projects: [
          {
            project_id: "project-a",
            project_name: "当前项目",
            can_generate: options.canGenerate ?? true,
            can_manage_schedule: options.canManageSchedule ?? options.canGenerate ?? true,
            eligible_count: generated || options.empty ? 0 : 3,
            eligible_people: generated || options.empty ? 0 : 2,
            eligible_amount: generated || options.empty ? "0.00" : "300.00",
            schedule,
          },
          {
            project_id: "project-b",
            project_name: "其他可管理项目",
            can_generate: true,
            can_manage_schedule: true,
            eligible_count: 1,
            eligible_people: 1,
            eligible_amount: "75.00",
            schedule,
          },
          {
            project_id: "project-c",
            project_name: "只读项目",
            can_generate: false,
            can_manage_schedule: false,
            eligible_count: 4,
            eligible_people: 2,
            eligible_amount: "999.00",
            schedule: { ...schedule, enabled: false },
          },
        ],
        runs: [],
      },
    });
  });
  await page.goto(`/finance-monthly${options.ai ? "?ai=1" : ""}`);
  await page.getByRole("button", { name: "生成工资单", exact: true }).click();
  return writes;
}

test("defaults to the workspace month and creates current-project wages without paying", async ({ page }) => {
  const writes = await setup(page);
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("工资月份")).toHaveValue("2026-10");
  await expect(dialog.getByText("计薪期间：2026-10-01 至 2026-10-31")).toBeVisible();
  await expect(dialog.getByText("待计薪工时：3 条 · 1 个项目")).toBeVisible();
  await dialog.getByRole("button", { name: "生成工资单", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("已生成 2 张工资单，合计 ¥300.00");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ method: "POST", body: { month: "2026-10", project_ids: ["project-a"] } });
  expect(writes[0].path).toMatch(/\/payroll-monthly\/$/);
  await expect(dialog.getByText("工资单状态：待付款")).toBeVisible();
});

test("selects a natural leap month and batches only projects with generation rights", async ({ page }) => {
  const writes = await setup(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("工资月份").fill("2028-02");
  await dialog.getByLabel("生成范围").selectOption("all");
  await expect(dialog.getByText("计薪期间：2028-02-01 至 2028-02-29")).toBeVisible();
  await expect(dialog.getByText("待生成金额：¥375.00")).toBeVisible();
  await dialog.getByRole("button", { name: "生成工资单", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("已生成 3 张工资单");
  expect(writes[0].body).toEqual({ month: "2028-02", project_ids: ["project-a", "project-b"] });
});

test("repeat generation reports no extra wages and never issues a payment request", async ({ page }) => {
  const writes = await setup(page);
  const dialog = page.getByRole("dialog");
  const generate = dialog.getByRole("button", { name: "生成工资单", exact: true });
  await generate.click();
  await expect(dialog.getByRole("status")).toContainText("已生成 2 张工资单");
  await expect(generate).toBeEnabled();
  await generate.click();
  await expect(dialog.getByRole("status")).toContainText("已生成 0 张工资单，合计 ¥0.00");
  expect(writes).toHaveLength(2);
  expect(writes.every((request) => request.path.endsWith("/payroll-monthly/") && !request.body.action)).toBe(true);
});

test("failed generation preserves selected month and project scope for retry", async ({ page }) => {
  const writes = await setup(page, { failFirst: true });
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("工资月份").fill("2026-09");
  await dialog.getByLabel("生成范围").selectOption("all");
  await dialog.getByRole("button", { name: "生成工资单", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("月份暂不可生成");
  await expect(dialog.getByLabel("工资月份")).toHaveValue("2026-09");
  await expect(dialog.getByLabel("生成范围")).toHaveValue("all");
  await dialog.getByRole("button", { name: "生成工资单", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("2026-09：已生成 3 张工资单");
  expect(writes[0].body).toEqual(writes[1].body);
});

test("schedule changes use the selected project scope and show next execution", async ({ page }) => {
  const writes = await setup(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("生成范围").selectOption("all");
  await dialog.getByRole("button", { name: "启用月末自动生成", exact: true }).click();
  await expect(dialog.getByText("生成时间：每月最后一天 23:55")).toBeVisible();
  await expect(dialog.getByText("时区：Asia/Shanghai")).toBeVisible();
  await expect(dialog.getByText("下次执行：2026/10/31 23:55")).toHaveCount(2);
  expect(writes[0]).toMatchObject({
    method: "PATCH",
    body: { project_ids: ["project-a", "project-b"], enabled: true },
  });
  await dialog.getByRole("button", { name: "停用月末自动生成", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "启用月末自动生成", exact: true })).toBeEnabled();
  expect(writes[1].body).toEqual({ project_ids: ["project-a", "project-b"], enabled: false });
});

test("read-only current project cannot generate wages or change its schedule", async ({ page }) => {
  const writes = await setup(page, { canGenerate: false, enabled: true });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "生成工资单", exact: true })).toBeDisabled();
  await expect(dialog.getByText("没有可生成工资单的项目")).toBeVisible();
  await expect(page.getByRole("button", { name: "停用月末自动生成", exact: true })).toHaveCount(0);
  await expect(page.getByText("最近执行：2026/09/30 23:55 · 已完成")).toBeVisible();
  expect(writes).toHaveLength(0);
});

test("AI drafts retain individual member and date range compatibility", async ({ page }) => {
  const writes = await setup(page, { ai: true });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "生成项目工资单" })).toBeVisible();
  await expect(dialog.getByLabel("计薪成员")).toHaveValue("member-a");
  await expect(dialog.getByLabel("计薪开始日期")).toHaveValue("2026-09-03");
  await expect(dialog.getByLabel("计薪结束日期")).toHaveValue("2026-09-18");
  await dialog.getByLabel("操作说明").fill("按 AI 草稿生成指定成员工资单");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes[0].path).toMatch(/\/finance-management\/$/);
  expect(writes[0].body).toMatchObject({
    kind: "payroll",
    action: "save",
    data: { user_id: "member-a", start: "2026-09-03", end: "2026-09-18" },
  });
});

test("a project that cannot generate wages can still stop an existing automatic plan", async ({ page }) => {
  const writes = await setup(page, { canGenerate: false, canManageSchedule: true, enabled: true });
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "停用月末自动生成", exact: true }).click();
  await expect(page.getByText("未启用", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "启用月末自动生成", exact: true })).toHaveCount(0);
  expect(writes[0]).toMatchObject({ method: "PATCH", body: { project_ids: ["project-a"], enabled: false } });
});

test("users can switch from monthly generation to the existing individual form", async ({ page }) => {
  await setup(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "指定成员与日期" }).click();
  await expect(dialog.getByLabel("计薪成员")).toBeVisible();
  await dialog.getByRole("button", { name: "按月批量生成" }).click();
  await expect(dialog.getByLabel("工资月份")).toHaveValue("2026-10");
});
