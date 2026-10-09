/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";

for (const rejected of [false, true]) {
  test(
    rejected
      ? "failed status drop displays a notification after background refresh"
      : "referenced project task can be dropped into the todo column",
    async ({ page }) => {
      const item = {
        id: "reference",
        issue_id: "native",
        project_id: "project",
        project_name: "海声",
        issue_key: "OA-1",
        title: "项目实验",
        kind: "project",
        status: "active",
        public: true,
        folder_id: "A",
      };
      let writes = 0;
      let plannerReads = 0;
      await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
      await page.route("**/api/workspaces/lab/lab/**", async (route) => {
        const path = new URL(route.request().url()).pathname.split("/lab/lab/")[1]!;
        if (path === "planner/") plannerReads += 1;
        if (path === "items/reference/" && route.request().method() === "PATCH") {
          expect(route.request().postDataJSON()).toEqual({ status: "todo" });
          writes += 1;
          if (rejected) {
            await route.fulfill({ status: 400, json: ["项目状态映射已失效，请项目负责人重新配置「项目状态映射」"] });
            return;
          }
          item.status = "todo";
        }
        await route.fulfill({
          json:
            path === "planner/"
              ? {
                  user_id: "member",
                  team_access: false,
                  folders: [{ id: "A", name: "A", position: 0 }],
                  items: [item],
                  projects: [],
                  timezone: "Asia/Shanghai",
                  week_start: 1,
                  step_minutes: 15,
                }
              : path === "calendar/"
                ? { events: [], members: [] }
                : {},
        });
      });
      await page.goto("/workbench");
      const handle = page.getByRole("button", { name: "拖动 项目实验", exact: true });
      const target = page.getByRole("region", { name: "待做事项", exact: true });
      await handle.scrollIntoViewIfNeeded();
      const start = await handle.boundingBox(),
        end = await target.boundingBox();
      expect(start).not.toBeNull();
      expect(end).not.toBeNull();
      await page.mouse.move(start!.x + start!.width / 2, start!.y + start!.height / 2);
      await page.mouse.down();
      await page.mouse.move(end!.x + end!.width / 2, end!.y + 55, { steps: 12 });
      await page.mouse.up();
      await expect.poll(() => writes).toBe(1);
      if (rejected) {
        const notification = page.getByText("规划更新失败", { exact: true });
        await expect(notification).toBeInViewport();
        await expect(
          page.getByText("项目状态映射已失效，请项目负责人重新配置「项目状态映射」").last()
        ).toBeInViewport();
        await expect(page.getByRole("region", { name: "进行中事项", exact: true }).locator("article")).toContainText(
          "项目实验"
        );
        const previousReads = plannerReads;
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect.poll(() => plannerReads).toBeGreaterThan(previousReads);
        await expect(notification).toBeInViewport();
      } else {
        await expect(target.locator("article")).toContainText("项目实验");
      }
    }
  );
}
