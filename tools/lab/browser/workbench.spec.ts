/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function fixture(page: Page) {
  const planner = {
    user_id: "member",
    team_access: false,
    folders: ["A", "B", "C", "D"].map((name, position) => ({ id: name, name, position })),
    items: [
      {
        id: "project-item",
        title: "声学阵列实验",
        status: "active",
        kind: "project",
        public: true,
        folder_id: "A",
        issue_id: "source-issue",
        project_id: "project",
        project_name: "海声实验",
        issue_key: "OOA-42",
        priority: "high",
        target_date: "2026-10-15",
        schedule: {
          future_count: 1,
          next_start: "2026-10-09T09:00:00+08:00",
          next_end: "2026-10-09T10:30:00+08:00",
          week_minutes: 90,
          total_count: 2,
        },
      },
      {
        id: "private-item",
        title: "学习信号处理",
        description: "阅读论文并复现实验",
        status: "todo",
        kind: "study",
        public: false,
        folder_id: "B",
        issue_id: null,
        project_id: null,
        project_name: null,
        issue_key: null,
        priority: null,
        target_date: null,
        schedule: { future_count: 0, next_start: null, next_end: null, week_minutes: 0, total_count: 0 },
      },
      {
        id: "done-item",
        title: "已完成的科研记录",
        status: "done",
        kind: "research",
        public: false,
        folder_id: "C",
        issue_id: null,
        schedule: { future_count: 0, next_start: null, next_end: null, week_minutes: 60, total_count: 1 },
      },
    ],
    projects: [{ id: "project", name: "海声实验", lead: false, states: [], members: [], mapping: {} }],
    timezone: "Asia/Shanghai",
    week_start: 1,
    step_minutes: 15,
  };
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/lab/lab/")[1];
    if (path === "planner/") await route.fulfill({ json: planner });
    else if (path === "folders/" && route.request().method() === "PUT") {
      const body = route.request().postDataJSON() as { ids: string[] };
      planner.folders = body.ids.map((id, position) => ({
        id,
        name: planner.folders.find((folder) => folder.id === id)!.name,
        position,
      }));
      await route.fulfill({ json: {} });
    } else if (path === "items/project-item/" && route.request().method() === "PATCH") {
      Object.assign(planner.items[0]!, route.request().postDataJSON());
      await route.fulfill({ json: {} });
    } else if (path === "calendar/")
      await route.fulfill({ json: { events: [], members: [{ id: "member", name: "本人" }] } });
    else await route.fulfill({ json: {} });
  });
  await page.goto("/workbench");
  return planner;
}

test("desktop workbench puts both views beside each other and cards use source metadata", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await fixture(page);
  const board = page.getByRole("region", { name: "文件夹看板区域", exact: true });
  const calendar = page.getByRole("region", { name: "个人周历区域", exact: true });
  await expect(board).toBeVisible();
  await expect(calendar).toBeVisible();
  const left = await board.boundingBox(),
    right = await calendar.boundingBox();
  expect(right!.x).toBeGreaterThan(left!.x + left!.width - 1);
  expect(Math.abs(right!.y - left!.y)).toBeLessThan(2);
  const card = board.locator("article").filter({ hasText: "声学阵列实验" });
  await expect(card).toContainText("海声实验");
  await expect(card).toContainText("OOA-42");
  await expect(card).toContainText("高优先级");
  await expect(card).toContainText("10月15日");
  await expect(card).toContainText("本周计划 1.5 小时");
  await expect(card.getByRole("link", { name: "声学阵列实验", exact: true })).toHaveAttribute(
    "href",
    "/lab/projects/project/issues/source-issue"
  );
  await expect(board.locator("article").filter({ hasText: "学习信号处理" })).toContainText("阅读论文并复现实验");
  await card.getByRole("button", { name: "安排声学阵列实验", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByLabel("事项", { exact: true })).toHaveValue("project-item");
});

test("pending filters use all-schedule metadata rather than the current empty calendar window", async ({ page }) => {
  await fixture(page);
  const board = page.getByRole("region", { name: "文件夹看板区域", exact: true });
  await board.getByRole("checkbox", { name: "只看待排事项", exact: true }).check();
  await expect(board.locator("article")).toHaveCount(1);
  await expect(board.locator("article")).toContainText("学习信号处理");
  await board.getByRole("checkbox", { name: "只看待排事项", exact: true }).uncheck();
  await board.getByLabel("搜索规划事项", { exact: true }).fill("OOA-42");
  await expect(board.locator("article")).toHaveCount(1);
  await expect(board.locator("article")).toContainText("声学阵列实验");
  await board.getByLabel("搜索规划事项", { exact: true }).fill("");
  await board.getByRole("combobox", { name: "筛选规划项目", exact: true }).click();
  await page.getByRole("option", { name: "个人事项", exact: true }).click();
  await expect(board.locator("article")).toHaveCount(2);
  await board.getByRole("combobox", { name: "筛选规划状态", exact: true }).click();
  await page.getByRole("option", { name: "待做", exact: true }).click();
  await expect(board.locator("article")).toHaveCount(1);
  await expect(board.locator("article")).toContainText("学习信号处理");
});

test("small screens stack without page overflow and individual modes retain the calendar date", async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await fixture(page);
  const board = page.getByRole("region", { name: "文件夹看板区域", exact: true });
  const calendar = page.getByRole("region", { name: "个人周历区域", exact: true });
  const first = await board.boundingBox(),
    second = await calendar.boundingBox();
  expect(second!.y).toBeGreaterThan(first!.y + first!.height - 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await calendar.getByLabel("跳转日期", { exact: true }).fill("2026-11-16");
  await page.getByRole("button", { name: "文件夹看板", exact: true }).click();
  await expect(calendar).toBeHidden();
  await page.getByRole("button", { name: "个人周历", exact: true }).click();
  await expect(board).toBeHidden();
  await expect(calendar).toContainText("11月");
  await page.getByRole("button", { name: "综合", exact: true }).click();
  await expect(board).toBeVisible();
  await expect(calendar).toBeVisible();
  await expect(calendar).toContainText("11月");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("combined layout retains keyboard folder sorting and pointer moves on the original task", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const planner = await fixture(page);
  const board = page.getByRole("region", { name: "文件夹看板区域", exact: true });
  const handle = board.getByRole("button", { name: "拖动排序文件夹 A", exact: true });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(
    () => new Promise<void>((ready) => requestAnimationFrame(() => requestAnimationFrame(() => ready())))
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("移动到B", { exact: true })).toHaveCount(1);
  await page.keyboard.press("Space");
  await expect.poll(() => planner.folders.map((folder) => folder.name)).toEqual(["B", "A", "C", "D"]);
  const source = await board.getByRole("button", { name: "拖动 声学阵列实验", exact: true }).boundingBox();
  const target = await board.getByRole("button", { name: "拖动排序文件夹 D", exact: true }).boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect.poll(() => planner.items[0]!.folder_id).toBe("D");
  expect(planner.items[0]!.issue_id).toBe("source-issue");
  expect(planner.items[0]!.status).toBe("active");
});
