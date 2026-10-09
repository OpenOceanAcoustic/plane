/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(page: Page, canOpen: boolean) {
  const item = {
    id: "reference",
    title: "受控实验任务",
    issue_id: "issue",
    project_id: "project",
    project_name: "实验项目",
    issue_key: "LAB-1",
    kind: "project",
    status: "todo",
    public: true,
    folder_id: null,
    category_name: "自定义分类",
    category_color: "#0d9488",
    bounty_id: "bounty",
    can_open_issue: canOpen,
    can_edit_issue: false,
  };
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith("/calendar/")
      ? { events: [], members: [] }
      : path.endsWith("/detail/")
        ? {
            id: "bounty",
            stage_id: "stage",
            project_id: "project",
            project: "实验项目",
            issue_id: "issue",
            title: item.title,
            deliverable: "任务授权可见的交付要求",
            criteria: "独立验收标准",
            budget: "10",
            status: "active",
            access_level: "task",
            allocations: [],
            acceptances: [],
            is_lead: false,
            can_manage_materials: false,
          }
        : path.endsWith("/materials/")
          ? { materials: [] }
          : path.endsWith("/workflow/")
            ? {
                nodes: [],
                edges: [],
                history: [],
                actions: [],
                current_node: "started",
              }
            : {
                user_id: "member",
                team_access: false,
                items: [item],
                folders: [],
                projects: [],
                categories: [],
                timezone: "Asia/Shanghai",
                week_start: 1,
                step_minutes: 15,
              };
    await route.fulfill({ json });
  });
  await page.goto("/workbench");
  await page.getByRole("button", { name: "文件夹看板", exact: true }).click();
  return { item, requests };
}

test("task-only access opens a controlled right overview without requesting native project data", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { requests } = await setup(page, false);
  const card = page.getByRole("article", { name: "受控实验任务", exact: true });
  await card.locator(".lab-planner-card-meta").first().click();
  const overview = page.getByRole("dialog", { name: "悬赏任务详情", exact: true });
  await expect(overview).toBeVisible();
  await expect(overview.getByRole("region", { name: "事项内容", exact: true })).toContainText("任务授权可见的交付要求");
  await expect(overview.getByRole("region", { name: "悬赏共享资料", exact: true })).toBeVisible();
  await expect(overview.getByRole("region", { name: "悬赏流程图", exact: true })).toBeVisible();
  const bounds = await overview.boundingBox();
  expect(bounds!.x + bounds!.width).toBeGreaterThanOrEqual(1438);
  await expect(page).toHaveURL(/\/workbench$/);
  expect(requests.filter((url) => url.includes("/projects/project/"))).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(overview).toHaveCount(0);
  await card.focus();
  await card.press("Enter");
  await expect(overview).toBeVisible();
  await overview.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await card.getByRole("button", { name: "安排受控实验任务", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "安排个人时间", exact: true })).toBeVisible();
  await expect(overview).toHaveCount(0);
});

test("readable native issues keep the native overview path even when editing is disabled", async ({ page }) => {
  await setup(page, true);
  await page.evaluate(() => {
    window.addEventListener("lab-open-project-issue", (event) => {
      document.body.dataset.openedLabProjectIssue = JSON.stringify((event as CustomEvent).detail);
    });
  });
  const card = page.getByRole("article", { name: "受控实验任务", exact: true });
  await card.getByRole("link", { name: "受控实验任务", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-opened-lab-project-issue",
    JSON.stringify({ issue_id: "issue", project_id: "project" })
  );
  await expect(page.getByRole("dialog", { name: "悬赏任务详情", exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/\/workbench$/);
});

test("revoked task access hides cached execution details on the next open", async ({ page }) => {
  await setup(page, false);
  const card = page.getByRole("article", { name: "受控实验任务", exact: true });
  await card.getByRole("link", { name: "受控实验任务", exact: true }).click();
  const overview = page.getByRole("dialog", { name: "悬赏任务详情", exact: true });
  await expect(overview.getByRole("region", { name: "事项内容", exact: true })).toContainText("任务授权可见的交付要求");
  await overview.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.route("**/bounties/bounty/detail/", (route) =>
    route.fulfill({ status: 403, json: { detail: "任务授权已撤回" } })
  );
  await card.getByRole("link", { name: "受控实验任务", exact: true }).click();
  await expect(overview.getByRole("alert")).toContainText("任务授权已撤回");
  await expect(overview.getByRole("region", { name: "事项内容", exact: true })).toHaveCount(0);
  await expect(overview.getByRole("region", { name: "悬赏共享资料", exact: true })).toHaveCount(0);
  await expect(overview.getByRole("region", { name: "悬赏流程图", exact: true })).toHaveCount(0);
});
