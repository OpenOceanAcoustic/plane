/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";

for (const path of ["/visibility-fields", "/mobile-visibility-fields"]) {
  test(`${path}: visibility and named recipients serialize and clear together`, async ({ page }) => {
    await page.goto(path);
    const scope = page.locator('select[name="visibility"]');
    await expect(scope).toHaveValue("private");
    await scope.selectOption("selected", { force: true });
    await page.getByLabel("张三", { exact: true }).check();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator("output")).toHaveText(
      JSON.stringify({ visibility: "selected", shared_user_ids: ["member-2"] })
    );
    await scope.selectOption("organization", { force: true });
    await expect(page.getByLabel("张三", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.locator("output")).toHaveText(
      JSON.stringify({ visibility: "organization", shared_user_ids: [] })
    );
  });
}
for (const path of ["/planner", "/mobile-planner"]) {
  test(`${path}: shared planning content has no editing or scheduling action`, async ({ page }) => {
    const schedule = { future_count: 0, next_start: null, next_end: null, week_minutes: 0, total_count: 0 };
    const planner = {
      user_id: "member",
      team_access: false,
      team_calendar_access: true,
      folders: [],
      categories: [],
      items: [],
      projects: [],
      sharing_members: [],
      timezone: "Asia/Shanghai",
      week_start: 1,
      step_minutes: 15,
      shared_items: [
        {
          id: "shared",
          title: "组织实验计划",
          description: "共享内容可读",
          kind: "research",
          status: "todo",
          public: true,
          visibility: "organization",
          owner_id: "other",
          owner_name: "张三",
          editable: false,
          issue_id: null,
          folder_id: null,
          project_name: null,
          issue_key: null,
          priority: null,
          target_date: null,
          schedule,
        },
      ],
    };
    await page.route("**/api/workspaces/lab/lab/**", (route) =>
      route.fulfill({ json: route.request().url().includes("planner/") ? planner : { events: [], members: [] } })
    );
    await page.goto(path);
    await page.getByRole("button", { name: "共享规划", exact: true }).click();
    await page.getByRole("button", { name: /组织实验计划/ }).click();
    const detail = path.startsWith("/mobile")
      ? page.locator(".lab-detail-page").last()
      : page.getByRole("dialog").last();
    await expect(detail).toContainText("共享内容可读");
    await expect(detail).toContainText("张三");
    await expect(detail.getByRole("button", { name: /编辑|安排时间|移除|保存/ })).toHaveCount(0);
  });
}
