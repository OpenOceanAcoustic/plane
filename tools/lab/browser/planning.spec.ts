/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { expect, test } from "@playwright/test";
import type { LabEvent, LabItem, LabPlanner } from "../../../packages/types/src/lab";

test("folder planning and calendar split use the real form and preserve the referenced item", async ({ page }) => {
  const planner: LabPlanner = {
    user_id: "member",
    team_access: false,
    folders: ["A", "B", "C", "D"].map((name, position) => ({ id: name, name, position })),
    items: [],
    projects: [],
    timezone: "Asia/Shanghai",
    week_start: 1,
    step_minutes: 15,
  };
  let events: LabEvent[] = [];
  await page.clock.install({ time: new Date("2026-10-08T00:00:00Z") });
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/lab/lab/")[1];
    const method = route.request().method();
    const body = method === "GET" ? undefined : route.request().postDataJSON();
    let result: unknown = {};
    if (path === "planner/") result = planner;
    else if (path === "items/" && method === "POST") {
      planner.items.push({ id: "personal", ...body, issue_id: null, status: "todo" } as LabItem);
      result = { id: "personal" };
    } else if (path === "items/personal/") Object.assign(planner.items[0]!, body);
    else if (path === "calendar/" && method === "GET") result = { events, members: [{ id: "member", name: "成员" }] };
    else if (path === "calendar/" && method === "POST") {
      expect(body.item_id).toBe("personal");
      events.push({
        id: "block",
        user_id: "member",
        title: "科研规划",
        editable: true,
        item_id: "personal",
        start: body.start,
        end: body.end,
      });
      result = { id: "block", overlap: false };
    } else if (path === "calendar/block/" && body.split_at) {
      const originalEnd = events[0]!.end;
      events[0]!.end = body.split_at;
      events.push({ ...events[0]!, id: "following", start: body.split_at, end: originalEnd });
      result = { id: "block", following_id: "following" };
    }
    await route.fulfill({ json: result });
  });
  await page.goto("/planner");
  await page.getByRole("button", { name: "个人事项", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("事项名称").fill("科研规划");
  await dialog.getByLabel("文件夹").selectOption("A");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  const card = page.locator("article").filter({ hasText: "科研规划" });
  await expect(card).toBeVisible();
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await card.dispatchEvent("dragstart", { dataTransfer: transfer });
  await page
    .getByRole("button", { name: "B", exact: true })
    .locator("..")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect.poll(() => planner.items[0]!.folder_id).toBe("B");
  await page.getByRole("button", { name: "A", exact: true }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: "B", exact: true }).click();
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "安排科研规划", exact: true }).click();
  await dialog.getByLabel("开始（上海）").fill("2026-10-08T09:00");
  await dialog.getByLabel("结束（上海）").fill("2026-10-08T11:00");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  const block = page.getByRole("button", { name: "科研规划 09:00–11:00", exact: true });
  await block.click();
  await dialog.getByRole("button", { name: "拆分时间块", exact: true }).click();
  await dialog.getByLabel("拆分时间（上海）").fill("2026-10-08T10:00");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => events.length).toBe(2);
  expect(events.every((event) => event.item_id === "personal")).toBeTruthy();
  expect(planner.items[0]!.folder_id).toBe("B");
});
