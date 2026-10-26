/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const task = (id: string, title: string, parent: string | null = null, mine = false, project = "project-a") => ({
  id,
  title,
  parent_id: parent,
  project_id: project,
  project: project === "project-a" ? "海声项目" : "算法项目",
  key: `OOA-${id}`,
  state: "进行中",
  priority: "medium",
  start_date: null,
  target_date: "2026-10-31",
  editable: true,
  values: {},
  is_mine: mine,
  assignees: mine ? [{ id: "member", name: "钱鹏" }] : [],
});
async function fixture(page: Page, query = "") {
  const tasks = [
    task("parent", "样机开发"),
    task("child", "界面点击验证", "parent", true),
    task("grandchild", "空状态检查", "child"),
    task("other", "信号计算", null, false, "project-b"),
    task("cycle-a", "循环关联 A", "cycle-b"),
    task("cycle-b", "循环关联 B", "cycle-a"),
  ];
  const personal = {
    id: "personal",
    title: "阅读测试规范",
    description: "记录测试边界",
    status: "todo",
    kind: "research",
    public: false,
    folder_id: null,
    issue_id: null,
    project_name: null,
    issue_key: null,
    priority: "low",
    target_date: null,
    schedule: { future_count: 0, next_start: null, next_end: null, week_minutes: 0, total_count: 0 },
  };
  const requests: string[] = [];
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split("/lab/lab/")[1];
    if (path === "planner/")
      return route.fulfill({
        json: {
          user_id: "member",
          team_access: false,
          folders: [],
          items: [
            personal,
            { ...personal, id: "linked", title: "关联副本不应重复显示", issue_id: "child", project_id: "project-a" },
          ],
          shared_items: [{ ...personal, id: "foreign", title: "其他人的私事" }],
          projects: [
            { id: "project-a", name: "海声项目", lead: false, states: [], members: [], mapping: {} },
            { id: "project-b", name: "算法项目", lead: false, states: [], members: [], mapping: {} },
          ],
          timezone: "Asia/Shanghai",
          week_start: 1,
          step_minutes: 15,
        },
      });
    if (path === "task-table/") {
      requests.push(url.search);
      return route.fulfill({
        json: {
          tasks: tasks.filter(
            (row) => !url.searchParams.get("project") || row.project_id === url.searchParams.get("project")
          ),
          fields: [],
        },
      });
    }
    if (path?.endsWith("/fields/")) return route.fulfill({ json: { fields: [], members: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto(`/task-hierarchy${query}`);
  await expect(page.getByRole("region", { name: "工作项层级", exact: true })).toBeVisible();
  return requests;
}

test("projects, native parent-child rows and private personal items share one hierarchy", async ({ page }) => {
  await fixture(page);
  const rows = page.getByRole("table", { name: "工作项层级列表" });
  await expect(rows.getByRole("link", { name: "样机开发", exact: true })).toBeVisible();
  await expect(
    rows.getByRole("link", { name: "空状态检查", exact: true }).locator("xpath=ancestor::tr")
  ).toHaveAttribute("data-depth", "3");
  await expect(
    rows.getByRole("button", { name: "阅读测试规范", exact: true }).locator("xpath=ancestor::tr")
  ).toHaveAttribute("data-kind", "personal");
  await expect(rows).not.toContainText("关联副本");
  await expect(rows).not.toContainText("其他人的私事");
  await expect(rows.getByRole("link", { name: "循环关联 A", exact: true })).toHaveCount(1);
  await expect(rows.getByRole("link", { name: "循环关联 B", exact: true })).toHaveCount(1);
  await rows.getByRole("button", { name: "折叠样机开发", exact: true }).click();
  await expect(rows.getByRole("link", { name: "界面点击验证", exact: true })).toHaveCount(0);
  await rows.getByRole("button", { name: "展开样机开发", exact: true }).click();
  await rows.getByRole("button", { name: "阅读测试规范", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "个人工作项", exact: true })).toContainText("记录测试边界");
});

test("search and my assignment filters retain ancestor context", async ({ page }) => {
  await fixture(page);
  const rows = page.getByRole("table", { name: "工作项层级列表" });
  await rows.getByRole("button", { name: "折叠样机开发", exact: true }).click();
  await page.getByLabel("搜索任务与字段", { exact: true }).fill("空状态");
  await expect(rows.getByRole("link", { name: "样机开发", exact: true })).toBeVisible();
  await expect(rows.getByRole("link", { name: "界面点击验证", exact: true })).toBeVisible();
  await expect(rows.getByRole("link", { name: "空状态检查", exact: true })).toBeVisible();
  await expect(rows.getByRole("link", { name: "信号计算", exact: true })).toHaveCount(0);
  await page.getByLabel("搜索任务与字段", { exact: true }).fill("");
  await page.getByLabel("工作项归属", { exact: true }).selectOption("mine");
  await expect(rows.getByRole("link", { name: "样机开发", exact: true }).locator("xpath=ancestor::tr")).toHaveAttribute(
    "data-context",
    "true"
  );
  await expect(
    rows.getByRole("link", { name: "界面点击验证", exact: true }).locator("xpath=ancestor::tr")
  ).toContainText("我负责");
  await expect(rows.getByRole("link", { name: "空状态检查", exact: true })).toHaveCount(0);
});

test("project deep link scopes native tasks without assigning unrelated personal items", async ({ page }) => {
  const requests = await fixture(page, "?project_id=project-a");
  await expect(page.getByLabel("项目筛选", { exact: true })).toHaveValue("project-a");
  await expect(page.getByRole("table", { name: "工作项层级列表" })).not.toContainText("阅读测试规范");
  await expect(page.getByRole("link", { name: "信号计算", exact: true })).toHaveCount(0);
  expect(requests).toContain("?project=project-a");
  await page.getByLabel("项目筛选", { exact: true }).selectOption("");
  await expect(page.getByRole("button", { name: "阅读测试规范", exact: true })).toBeVisible();
  await page.getByLabel("工作项视图", { exact: true }).selectOption("table");
  await expect(page.getByRole("button", { name: "管理字段", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "界面点击验证", exact: true }).first()).toBeVisible();
});
