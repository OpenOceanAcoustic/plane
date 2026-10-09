/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(page: Page) {
  await page.clock.install({ time: new Date("2026-10-09T00:00:00Z") });
  const item = {
    id: "personal",
    title: "阅读计划",
    description: "阅读信号处理第三章\n完成笔记和练习",
    kind: "study",
    status: "todo",
    public: false,
    issue_id: null,
    folder_id: "A",
    category_name: "学习",
    category_color: "#15803d",
  };
  const event = {
    id: "block",
    title: item.title,
    kind: item.kind,
    item_id: item.id,
    user_id: "member",
    editable: true,
    revision: 1,
    start: "2026-10-08T09:00:00+08:00",
    end: "2026-10-08T11:00:00+08:00",
  };
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    const calendar = new URL(route.request().url()).pathname.endsWith("/calendar/");
    await route.fulfill({
      json: calendar
        ? { events: [event], members: [{ id: "member", name: "本人" }] }
        : {
            user_id: "member",
            team_access: true,
            folders: [{ id: "A", name: "A", position: 0 }],
            items: [
              item,
              {
                ...item,
                id: "project-reference",
                title: "项目实验",
                kind: "project",
                issue_id: "original-issue",
                project_id: "original-project",
                archived: false,
              },
            ],
            projects: [],
            timezone: "Asia/Shanghai",
            week_start: 1,
            step_minutes: 15,
          },
    });
  });
  await page.goto("/workbench");
  await page.getByRole("button", { name: "个人周历", exact: true }).click();
  const pane = page.getByRole("region", { name: "个人周历区域", exact: true });
  await pane.getByRole("button", { name: "事项时间轴", exact: true }).click();
  return pane;
}

test("timeline overview fits the month and supports zoom without a pixel-height setting", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const pane = await setup(page);
  await pane
    .getByRole("navigation", { name: "时间轴范围", exact: true })
    .getByRole("button", { name: "月", exact: true })
    .click();
  const surface = pane.locator(".lab-calendar");
  const first = surface.locator('[data-date^="2026-10-01"]').first();
  const last = surface.locator('[data-date^="2026-10-31"]').first();
  await expect
    .poll(async () => {
      const frame = await surface.boundingBox(),
        a = await first.boundingBox(),
        z = await last.boundingBox();
      return !!frame && !!a && !!z && a.x >= frame.x - 2 && z.x + z.width <= frame.x + frame.width + 2;
    })
    .toBe(true);
  await expect(pane.getByLabel("日历高度", { exact: true })).toHaveCount(0);
  await expect(pane.getByRole("separator", { name: "调整日历高度", exact: true })).toHaveCount(0);
  await pane.getByRole("button", { name: "放大时间轴", exact: true }).click();
  await expect
    .poll(() =>
      surface.evaluate((element) =>
        [...element.querySelectorAll("div")].some(
          (node) =>
            ["auto", "scroll"].includes(getComputedStyle(node).overflowX) && node.scrollWidth > node.clientWidth + 10
        )
      )
    )
    .toBe(true);
  await pane.getByRole("button", { name: "总览", exact: true }).click();
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect
    .poll(async () => {
      const frame = await surface.boundingBox(),
        end = await last.boundingBox();
      return !!frame && !!end && end.x + end.width <= frame.x + frame.width + 2;
    })
    .toBe(true);
});

test("clicking an item shows its complete content before editing the schedule", async ({ page }) => {
  const pane = await setup(page);
  await pane.locator('[data-lab-calendar-event="block"]').click();
  const details = page.getByRole("dialog", { name: "事项详情", exact: true });
  await expect(details).toBeVisible();
  await expect(details.getByRole("region", { name: "事项内容", exact: true })).toContainText(
    "阅读信号处理第三章\n完成笔记和练习"
  );
  await expect(details.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
  await details.getByRole("button", { name: "调整时间块", exact: true }).click();
  const adjustment = page.getByRole("dialog", { name: "调整时间块", exact: true });
  await expect(adjustment.getByLabel("开始（上海）", { exact: true })).toHaveValue("2026-10-08T09:00");
  await adjustment.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await pane.getByRole("button", { name: "查看事项 阅读计划", exact: true }).click();
  await expect(details.getByRole("region", { name: "事项内容", exact: true })).toContainText("完成笔记和练习");
  await details.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.evaluate(() => {
    window.addEventListener("lab-open-project-issue", (event) => {
      document.body.dataset.openedLabProjectIssue = JSON.stringify((event as CustomEvent).detail);
    });
  });
  await pane.getByRole("button", { name: "查看事项 项目实验", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-opened-lab-project-issue",
    JSON.stringify({ issue_id: "original-issue", project_id: "original-project", archived: false })
  );
});

test("personal planning details open as a right-side overview without obscuring the board", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await setup(page);
  await page.getByRole("button", { name: "文件夹看板", exact: true }).click();
  const board = page.getByRole("region", { name: "文件夹看板区域", exact: true });
  await board.getByRole("button", { name: "阅读计划", exact: true }).click();
  const overview = page.getByRole("dialog", { name: "事项详情", exact: true });
  await expect(overview).toBeVisible();
  const bounds = await overview.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeGreaterThanOrEqual(1438);
  expect(bounds!.y).toBeLessThanOrEqual(60);
  expect(bounds!.height).toBeGreaterThanOrEqual(900);
  await expect(board.getByRole("button", { name: "阅读计划", exact: true })).toBeVisible();
  await expect(overview.getByRole("region", { name: "事项内容", exact: true })).toContainText("完成笔记和练习");
  await overview.getByRole("button", { name: "展开总览", exact: true }).click();
  const expanded = await overview.boundingBox();
  expect(expanded!.width).toBeGreaterThan(bounds!.width);
  await overview.getByRole("button", { name: "还原总览", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(overview).toHaveCount(0);
});

test("personal overview fits a narrow screen and leaves scheduling available", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const pane = await setup(page);
  await pane.getByRole("button", { name: "查看事项 阅读计划", exact: true }).click();
  const overview = page.getByRole("dialog", { name: "事项详情", exact: true });
  await expect(overview).toBeVisible();
  const bounds = await overview.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await overview.getByRole("button", { name: "安排时间", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "安排个人时间", exact: true })).toBeVisible();
});
