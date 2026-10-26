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
  start_date: "2026-10-20",
  target_date: "2026-10-31",
  editable: true,
  values: {},
  is_mine: mine,
  assignees: mine ? [{ id: "member", name: "钱鹏" }] : [],
});
const longTitle =
  "验证工作项在较窄窗口下仍能完整阅读并打开详情 / Verify a very long work item title without increasing the compact row height";
async function fixture(page: Page, query = "", options: { longTitle?: boolean } = {}) {
  await page.clock.setFixedTime(new Date("2026-10-26T04:00:00Z"));
  const tasks = [
    task("parent", "样机开发"),
    task("child", "界面点击验证", "parent", true),
    task("grandchild", "空状态检查", "child"),
    task("other", "信号计算", null, false, "project-b"),
    task("cycle-a", "循环关联 A", "cycle-b"),
    task("cycle-b", "循环关联 B", "cycle-a"),
  ];
  if (options.longTitle) tasks.push(task("long-title", longTitle, "parent"));
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
    schedule: {
      future_count: 1,
      next_start: "2026-10-21T01:00:00Z",
      next_end: "2026-10-21T02:00:00Z",
      week_minutes: 60,
      total_count: 1,
    },
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

test("compact rows keep issue numbers aligned while titles indent and dates occupy independent columns", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await fixture(page);
  const table = page.getByRole("table", { name: "工作项层级列表", exact: true });
  await expect(table.getByRole("columnheader")).toHaveText([
    "编号",
    "标题",
    "状态",
    "开始日期",
    "结束日期",
    "负责人",
    "优先级",
  ]);
  const rows = ["样机开发", "界面点击验证", "空状态检查"].map((title) =>
    table.getByRole("link", { name: title, exact: true }).locator("xpath=ancestor::tr")
  );
  const positions = await Promise.all(
    rows.map(async (row, index) => {
      const cells = row.getByRole("cell");
      await expect(cells).toHaveCount(7);
      await expect(cells.nth(0)).toHaveText(`OOA-${["parent", "child", "grandchild"][index]}`);
      await expect(cells.nth(1)).not.toContainText("OOA-");
      await expect(cells.nth(3)).toHaveText("2026-10-20");
      await expect(cells.nth(4)).toHaveText("2026-10-31");
      const [rowBox, titleBox, numberBox] = await Promise.all([
        row.boundingBox(),
        cells.nth(1).getByRole("link").boundingBox(),
        cells.nth(0).boundingBox(),
      ]);
      expect(rowBox).not.toBeNull();
      expect(titleBox).not.toBeNull();
      expect(numberBox).not.toBeNull();
      expect(rowBox!.height).toBeLessThanOrEqual(40);
      return { title: titleBox!.x, number: numberBox!.x };
    })
  );
  const titlePositions = positions.map((position) => position.title);
  const numberPositions = positions.map((position) => position.number);
  expect(titlePositions[1]).toBeGreaterThan(titlePositions[0]);
  expect(titlePositions[2]).toBeGreaterThan(titlePositions[1]);
  expect(Math.max(...numberPositions) - Math.min(...numberPositions)).toBeLessThanOrEqual(1);
  if (process.env.LAB_HIERARCHY_SCREENSHOT) {
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: process.env.LAB_HIERARCHY_SCREENSHOT, fullPage: true, animations: "disabled" });
  }
});

test("long titles remain actionable in compact rows and horizontal scrolling stays inside the tree table", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await fixture(page, "", { longTitle: true });
  const table = page.getByRole("table", { name: "工作项层级列表", exact: true });
  const title = table.getByRole("link", { name: longTitle, exact: true });
  const row = title.locator("xpath=ancestor::tr");
  await expect(title).toBeVisible();
  expect((await row.boundingBox())!.height).toBeLessThanOrEqual(40);
  const scroll = page.locator(".lab-hierarchy-scroll");
  const dimensions = await scroll.evaluate((element) => ({
    content: element.scrollWidth,
    viewport: element.clientWidth,
  }));
  expect(dimensions.content).toBeGreaterThan(dimensions.viewport);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(902);
  await scroll.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(await scroll.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  const date = row.getByRole("cell").nth(4);
  await date.scrollIntoViewIfNeeded();
  const dateBox = await date.boundingBox();
  const scrollBox = await scroll.boundingBox();
  expect(dateBox!.x).toBeGreaterThanOrEqual(scrollBox!.x - 1);
  expect(dateBox!.x + dateBox!.width).toBeLessThanOrEqual(scrollBox!.x + scrollBox!.width + 1);
  await page.evaluate(() => {
    window.addEventListener(
      "lab-open-project-issue",
      (event) => {
        (window as Window & { openedIssue?: unknown }).openedIssue = (event as CustomEvent).detail;
      },
      { once: true }
    );
  });
  await title.click();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { openedIssue?: unknown }).openedIssue))
    .toEqual({ issue_id: "long-title", project_id: "project-a", archived: false });
});

test("the Gantt chart mirrors visible hierarchy rows through collapse and search without inventing personal dates", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await fixture(page);
  const table = page.getByRole("table", { name: "工作项层级列表", exact: true });
  const timeline = page.getByRole("region", { name: "工作项甘特图", exact: true });
  await expect(timeline).toBeVisible();
  const tableIds = () =>
    table
      .locator("tbody tr[data-row-id]")
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-row-id")));
  const timelineIds = () =>
    timeline
      .locator("[data-row-id]")
      .evaluateAll((elements) => elements.map((element) => element.getAttribute("data-row-id")));
  await expect.poll(timelineIds).toEqual(await tableIds());
  const childRow = table.getByRole("link", { name: "界面点击验证", exact: true }).locator("xpath=ancestor::tr");
  const childId = await childRow.getAttribute("data-row-id");
  expect(childId).toBeTruthy();
  const timelineChild = timeline.locator(`[data-row-id="${childId}"]`);
  await expect(timelineChild).toBeVisible();
  await expect(
    timelineChild.getByRole("img", { name: "界面点击验证：2026-10-20 至 2026-10-31", exact: true })
  ).toBeVisible();
  expect(Math.abs((await childRow.boundingBox())!.y - (await timelineChild.boundingBox())!.y)).toBeLessThanOrEqual(2);
  const personalRow = table.getByRole("button", { name: "阅读测试规范", exact: true }).locator("xpath=ancestor::tr");
  const personalId = await personalRow.getAttribute("data-row-id");
  const timelinePersonal = timeline.locator(`[data-row-id="${personalId}"]`);
  await expect(timelinePersonal).toContainText("未排期");
  await expect(timelinePersonal.getByRole("img")).toHaveCount(0);
  await table.getByRole("button", { name: "折叠样机开发", exact: true }).click();
  await expect(timelineChild).toHaveCount(0);
  await expect.poll(timelineIds).toEqual(await tableIds());
  await page.getByLabel("搜索任务与字段", { exact: true }).fill("空状态");
  await expect(table.getByRole("link", { name: "空状态检查", exact: true })).toBeVisible();
  await expect.poll(timelineIds).toEqual(await tableIds());
  await expect(timelineChild).toBeVisible();
  await expect(timelinePersonal).toHaveCount(0);
  expect((await tableIds()).length).toBe(4);
});

test("Gantt scale and date navigation change the view while preserving task dates and row order", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await fixture(page);
  const table = page.getByRole("table", { name: "工作项层级列表", exact: true });
  const timeline = page.getByRole("region", { name: "工作项甘特图", exact: true });
  const bar = timeline.getByRole("img", { name: "界面点击验证：2026-10-20 至 2026-10-31", exact: true });
  const originalRows = await timeline
    .locator("[data-row-id]")
    .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-row-id")));
  await timeline.getByLabel("甘特时间尺度", { exact: true }).selectOption("week");
  await expect(bar).toBeVisible();
  await timeline.getByRole("button", { name: "后一段时间", exact: true }).click();
  await expect(bar).toHaveCount(0);
  await timeline.getByRole("button", { name: "前一段时间", exact: true }).click();
  await expect(bar).toBeVisible();
  await timeline.getByRole("button", { name: "后一段时间", exact: true }).click();
  await timeline.getByRole("button", { name: "今天", exact: true }).click();
  await expect(timeline.getByRole("img", { name: "今天 2026-10-26", exact: true })).toBeVisible();
  await timeline.getByRole("button", { name: "后一段时间", exact: true }).click();
  await expect(bar).toHaveCount(0);
  await timeline.getByRole("button", { name: "定位任务", exact: true }).click();
  await expect(bar).toBeVisible();
  await timeline.getByLabel("甘特时间尺度", { exact: true }).selectOption("day");
  await expect(bar).toBeVisible();
  const row = table.getByRole("link", { name: "界面点击验证", exact: true }).locator("xpath=ancestor::tr");
  await expect(row.getByRole("cell").nth(3)).toHaveText("2026-10-20");
  await expect(row.getByRole("cell").nth(4)).toHaveText("2026-10-31");
  expect(
    await timeline
      .locator("[data-row-id]")
      .evaluateAll((rows) => rows.map((element) => element.getAttribute("data-row-id")))
  ).toEqual(originalRows);
});
