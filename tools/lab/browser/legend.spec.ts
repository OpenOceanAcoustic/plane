/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";

test("calendar legend matches effective schedule colors and identifies individually colored items", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-10-09T00:00:00Z") });
  const categories = [
    { id: "research", name: "科研", color: "#7c3aed", position: 0 },
    { id: "unused", name: "学习", color: "#15803d", position: 1 },
  ];
  const items = ["standard", "custom"].map((id) => ({
    id,
    title: id === "custom" ? "海试安排" : "论文实验",
    status: "todo",
    kind: "research",
    public: false,
    issue_id: null,
    folder_id: "A",
    category_id: "research",
    category_name: "科研",
    category_color: "#7c3aed",
  }));
  const events = items.map((item) => ({
    ...item,
    id: item.id + "-block",
    item_id: item.id,
    user_id: "member",
    editable: true,
    revision: 1,
    color: item.id === "custom" ? "#575d1e" : "",
    start: "2026-10-09T09:00:00+08:00",
    end: "2026-10-09T10:00:00+08:00",
  }));
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    const calendar = new URL(route.request().url()).pathname.endsWith("/calendar/");
    await route.fulfill({
      json: calendar
        ? { events, members: [{ id: "member", name: "本人" }] }
        : {
            user_id: "member",
            team_access: false,
            folders: [{ id: "A", name: "A", position: 0 }],
            categories,
            items,
            projects: [],
            timezone: "Asia/Shanghai",
            week_start: 1,
            step_minutes: 15,
          },
    });
  });
  await page.goto("/workbench");
  const legend = page.getByRole("list", { name: "排期类别颜色" });
  const standard = page.locator('[data-lab-calendar-event="standard-block"]');
  const custom = page.locator('[data-lab-calendar-event="custom-block"]');
  await expect(standard).toHaveCSS("--fc-event-color", "#7c3aed");
  await expect(custom).toHaveCSS("--fc-event-color", "#575d1e");
  const matching = legend.getByRole("listitem").filter({ hasText: "海试安排" });
  await expect(matching).toContainText("科研");
  await expect(matching.locator("span[aria-hidden]")).toHaveCSS("background-color", "rgb(87, 93, 30)");
  await expect(legend).not.toContainText("学习");
});
