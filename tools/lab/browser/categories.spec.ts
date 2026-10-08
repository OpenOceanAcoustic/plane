/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";

test("members edit their category names and colors, and choose arbitrary schedule colors from a palette", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-09T00:00:00Z") });
  const categories = [{ id: "initial", name: "科研", color: "#7c3aed", position: 0 }];
  const item = {
    id: "item",
    title: "海试计划",
    description: "采样",
    status: "todo",
    kind: "research",
    public: false,
    folder_id: "A",
    issue_id: null,
    category_id: "initial",
    project_name: null,
    issue_key: null,
    priority: null,
    target_date: null,
    schedule: {
      week_minutes: 60,
      future_count: 1,
      total_count: 1,
      next_start: "2026-10-09T09:00:00+08:00",
      next_end: "2026-10-09T10:00:00+08:00",
    },
  };
  let color = "",
    revision = 1;
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/lab/lab/")[1]!;
    const method = route.request().method();
    const body = method === "GET" ? undefined : route.request().postDataJSON();
    const category = categories.find((row) => row.id === item.category_id);
    const fields = {
      category_id: category?.id ?? null,
      category_name: category?.name ?? null,
      category_color: category?.color ?? null,
    };
    let result: unknown = {};
    if (path === "planner/")
      result = {
        user_id: "member",
        team_access: false,
        categories,
        default_category_id: "initial",
        folders: [{ id: "A", name: "A", position: 0 }],
        projects: [],
        items: [{ ...item, ...fields }],
        timezone: "Asia/Shanghai",
        week_start: 1,
        step_minutes: 15,
      };
    else if (path === "categories/" && method === "POST") {
      categories.push({ id: "sea", position: 1, ...body });
      result = categories[1];
    } else if (path.startsWith("categories/") && method === "PATCH")
      Object.assign(categories.find((row) => path === `categories/${row.id}/`)!, body);
    else if (path.startsWith("categories/") && method === "DELETE") {
      const index = categories.findIndex((row) => path === `categories/${row.id}/`);
      expect(index).toBeGreaterThanOrEqual(0);
      categories.splice(index, 1);
    } else if (path === "items/item/" && method === "PATCH") Object.assign(item, body);
    else if (path === "calendar/" && method === "GET")
      result = {
        members: [{ id: "member", name: "本人" }],
        events: [
          {
            id: "block",
            item_id: "item",
            title: item.title,
            user_id: "member",
            editable: true,
            kind: item.kind,
            revision,
            color,
            ...fields,
            start: "2026-10-09T09:00:00+08:00",
            end: "2026-10-09T10:00:00+08:00",
          },
        ],
      };
    else if (path === "calendar/block/" && method === "PATCH") {
      expect(body.expected_revision).toBe(revision);
      revision += 1;
      color = body.color;
    }
    await route.fulfill({ json: result });
  });
  await page.goto("/workbench");
  const block = page.locator('[data-lab-calendar-event="block"]');
  await expect(block).toHaveCSS("--fc-event-color", "#7c3aed");
  await page.getByRole("button", { name: "管理类别", exact: true }).click();
  await page.getByRole("button", { name: "新增类别", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("类别名称", { exact: true }).fill("海试");
  await dialog.getByLabel("自定义类别颜色", { exact: true }).fill("#2468ac");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "编辑海试计划", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("事项类别", { exact: true }).selectOption("sea");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(block).toHaveCSS("--fc-event-color", "#2468ac");
  await expect(page.getByRole("list", { name: "排期类别颜色" })).toContainText("海试");
  await page.getByRole("button", { name: "管理类别", exact: true }).click();
  await page.getByRole("button", { name: "编辑类别海试", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("类别名称", { exact: true }).fill("海上实验");
  await dialog.getByRole("button", { name: "取色 #0e7490", exact: true }).click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(block).toHaveCSS("--fc-event-color", "#0e7490");
  await expect(page.locator("article")).toContainText("海上实验");
  await block.getByRole("button", { name: "调整 海试计划 的排期", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "跟随事项类别", exact: true })).toBeChecked();
  await dialog.getByLabel("自定义排期颜色", { exact: true }).fill("#eeeeee");
  await expect(dialog.getByRole("checkbox", { name: "跟随事项类别", exact: true })).not.toBeChecked();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(block).toHaveCSS("--fc-event-color", "#eeeeee");
  await expect(block.locator("strong")).toHaveCSS("color", "rgb(17, 24, 39)");
  await page.reload();
  await expect(block).toHaveCSS("--fc-event-color", "#eeeeee");
  await block.getByRole("button", { name: "调整 海试计划 的排期", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("checkbox", { name: "跟随事项类别", exact: true }).check();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(block).toHaveCSS("--fc-event-color", "#0e7490");
  await page.getByRole("button", { name: "管理类别", exact: true }).click();
  await page.getByRole("button", { name: "删除类别海上实验", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator("article")).toContainText("未分类");
  await expect(block).toHaveCSS("--fc-event-color", "#64748b");
  await expect(page.getByRole("list", { name: "排期类别颜色" })).not.toContainText("海上实验");
  await page.reload();
  await expect(page.locator("article")).toContainText("未分类");
  await expect(block).toBeVisible();
});
