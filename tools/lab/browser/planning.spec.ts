/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { LabEvent, LabItem, LabPlanner } from "../../../packages/types/src/lab";

async function planningServer(page: Page) {
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
  const events: LabEvent[] = [];
  await page.clock.install({ time: new Date("2026-10-08T00:00:00Z") });
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    const path = new URL(route.request().url()).pathname.split("/lab/lab/")[1];
    const method = route.request().method();
    const body = method === "GET" ? undefined : route.request().postDataJSON();
    let result: unknown = {};
    if (path === "planner/") result = planner;
    else if (path === "folders/" && method === "PUT") {
      planner.folders = body.ids.map((id: string, position: number) => ({
        ...planner.folders.find((folder) => folder.id === id),
        position,
      }));
    } else if (path === "items/" && method === "POST") {
      planner.items.push({ id: "personal", ...body, issue_id: null, status: "todo" } as LabItem);
      result = { id: "personal" };
    } else if (path?.startsWith("folders/")) {
      const id = path.split("/")[1];
      if (method === "PATCH") Object.assign(planner.folders.find((folder) => folder.id === id)!, body);
      if (method === "DELETE") {
        planner.folders = planner.folders.filter((folder) => folder.id !== id);
        for (const item of planner.items) if (item.folder_id === id) item.folder_id = null;
      }
    } else if (path === "items/personal/") Object.assign(planner.items[0]!, body);
    else if (path === "calendar/" && method === "GET") result = { events, members: [{ id: "member", name: "成员" }] };
    else if (path === "calendar/" && method === "POST") {
      expect(body.item_id).toBe("personal");
      events.push({
        id: "block",
        user_id: "member",
        title: "科研规划",
        editable: true,
        revision: 1,
        item_id: "personal",
        kind: "research",
        color: body.color ?? "",
        start: body.start,
        end: body.end,
      });
      result = { id: "block", revision: 1, overlap: false };
    } else if (path?.startsWith("calendar/") && method === "PATCH") {
      const event = events.find((candidate) => path === `calendar/${candidate.id}/`)!;
      expect(body.expected_revision).toBeGreaterThan(0);
      if (body.expected_revision !== event.revision) {
        await route.fulfill({ status: 409, json: { detail: "排期已被修改，请刷新后重试。" } });
        return;
      }
      event.revision! += 1;
      if (body.split_at) {
        const originalEnd = event.end;
        event.end = body.split_at;
        events.push({ ...event, id: "following", revision: 1, start: body.split_at, end: originalEnd });
        result = {
          id: "block",
          revision: event.revision,
          following_id: "following",
          following_revision: 1,
          overlap: false,
        };
      } else {
        event.start = body.start;
        event.end = body.end;
        if (body.color !== undefined) event.color = body.color;
        result = { id: event.id, revision: event.revision, overlap: false };
      }
    }
    await route.fulfill({ json: result });
  });
  return { planner, events };
}

async function createScheduledItem(page: Page) {
  await page.goto("/planner");
  await page.getByRole("button", { name: "个人事项", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("事项名称").fill("科研规划");
  await dialog.getByLabel("文件夹").selectOption("A");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "安排科研规划", exact: true }).click();
  await dialog.getByLabel("开始（上海）").fill("2026-10-08T09:00");
  await dialog.getByLabel("结束（上海）").fill("2026-10-08T11:00");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "科研规划 09:00–11:00", exact: true })).toBeVisible();
}

test("schedule colors default by category and manual overrides survive saving, splitting and reload", async ({
  page,
}) => {
  const { events } = await planningServer(page);
  await createScheduledItem(page);
  const block = page.locator('[data-lab-calendar-event="block"]');
  await expect(block).toHaveCSS("--fc-event-color", "#7c3aed");
  await page.getByRole("button", { name: "事项时间轴", exact: true }).click();
  await expect(block).toBeVisible();
  await page.getByRole("button", { name: "日历", exact: true }).click();
  await expect(block).toHaveCSS("--fc-event-color", "#7c3aed");
  await block.click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("排期颜色", { exact: true }).selectOption("orange");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(block).toHaveCSS("--fc-event-color", "#c2410c");
  expect(events[0]!.color).toBe("orange");
  await page.getByRole("button", { name: "事项时间轴", exact: true }).click();
  await block.click();
  await expect(dialog.getByLabel("排期颜色", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("结束（上海）").fill("2026-10-08T11:15");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  expect(events[0]!.color).toBe("orange");
  await page.getByRole("button", { name: "日历", exact: true }).click();
  await expect(block).toHaveCSS("--fc-event-color", "#c2410c");
  await page.reload();
  await expect(block).toHaveCSS("--fc-event-color", "#c2410c");
  await block.click();
  await dialog.getByRole("button", { name: "拆分时间块", exact: true }).click();
  await dialog.getByLabel("拆分时间（上海）").fill("2026-10-08T10:00");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator('[data-lab-calendar-event="following"]')).toHaveCSS("--fc-event-color", "#c2410c");
  await block.click();
  await dialog.getByLabel("排期颜色", { exact: true }).selectOption("");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(block).toHaveCSS("--fc-event-color", "#7c3aed");
});

test("calendar categories have distinct colors and opaque busy blocks use a neutral color", async ({ page }) => {
  const { events } = await planningServer(page);
  for (const kind of ["project", "research", "study", "mentoring", undefined]) {
    events.push({
      id: kind ?? "busy",
      kind,
      user_id: "member",
      title: kind ?? "忙碌",
      editable: false,
      start: "2026-10-08T09:00:00+08:00",
      end: "2026-10-08T10:00:00+08:00",
    });
  }
  await page.goto("/planner");
  await Promise.all(
    [
      ["project", "#1d4ed8"],
      ["research", "#7c3aed"],
      ["study", "#15803d"],
      ["mentoring", "#c2410c"],
      ["busy", "#64748b"],
    ].map(([id, color]) =>
      expect(page.locator(`[data-lab-calendar-event="${id}"]`)).toHaveCSS("--fc-event-color", color!)
    )
  );
});

test("keyboard folder ordering, pointer moves and calendar splitting preserve the original item", async ({ page }) => {
  const { planner, events } = await planningServer(page);
  await page.goto("/planner");
  const handle = page.getByRole("button", { name: "拖动排序文件夹 A", exact: true });
  await handle.focus();
  await page.keyboard.press("Space");
  await page.clock.runFor(50);
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("ArrowRight");
  await page.clock.runFor(50);
  await expect(page.getByText("移动到B", { exact: true })).toHaveCount(1);
  await page.keyboard.press("Space");
  await page.clock.runFor(50);
  await expect.poll(() => planner.folders.map((folder) => folder.name)).toEqual(["B", "A", "C", "D"]);
  await createScheduledItem(page);
  const source = page.getByRole("button", { name: "拖动 科研规划", exact: true });
  const target = page.getByRole("button", { name: "拖动排序文件夹 B", exact: true });
  await source.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox(),
    targetBox = await target.boundingBox();
  expect(sourceBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(sourceBox!.x + sourceBox!.width / 2, sourceBox!.y + sourceBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => planner.items[0]!.folder_id).toBe("B");
  const card = page.locator("article").filter({ hasText: "科研规划" });
  await page.getByRole("button", { name: /^A\s+0$/ }).click();
  await expect(card).toHaveCount(0);
  await page.getByRole("button", { name: /^B\s+1$/ }).click();
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "月", exact: true }).click();
  await expect(page.getByRole("button", { name: "月", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "周", exact: true }).click();
  const editableBlock = page.getByRole("button", { name: "科研规划 09:00–11:00", exact: true });
  await editableBlock.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "拆分时间块", exact: true }).click();
  await dialog.getByLabel("拆分时间（上海）").fill("2026-10-08T10:00");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => events.length).toBe(2);
  expect(events.map((event) => [event.item_id, event.revision])).toEqual([
    ["personal", 2],
    ["personal", 1],
  ]);
  expect(planner.items[0]!.folder_id).toBe("B");
  await expect(page.getByRole("button", { name: "科研规划 09:00–10:00", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "科研规划 10:00–11:00", exact: true })).toBeVisible();
});

test("a stale calendar edit reports conflict and reopening uses the refreshed revision", async ({ page }) => {
  const { events } = await planningServer(page);
  await createScheduledItem(page);
  await page.getByRole("button", { name: "科研规划 09:00–11:00", exact: true }).click();
  // A concurrent client changed the server after this form was opened.
  events[0]!.revision = 2;
  events[0]!.end = "2026-10-08T04:00:00.000Z";
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("结束（上海）").fill("2026-10-08T13:00");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("排期已被修改");
  expect(events[0]!.end).toBe("2026-10-08T04:00:00.000Z");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "科研规划 09:00–12:00", exact: true }).click();
  await dialog.getByLabel("结束（上海）").fill("2026-10-08T13:00");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(events[0]!.revision).toBe(3);
  await expect(page.getByRole("button", { name: "科研规划 09:00–13:00", exact: true })).toBeVisible();
});

test("folder actions close their menu and deleting a renamed folder retains scheduled items", async ({ page }) => {
  const { planner, events } = await planningServer(page);
  await createScheduledItem(page);
  await page.getByLabel("A 文件夹操作", { exact: true }).click();
  await page.getByRole("button", { name: "改名", exact: true }).click();
  await expect(page.getByLabel("A 文件夹操作", { exact: true }).locator("..")).toHaveJSProperty("open", false);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("研究 A");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByLabel("研究 A 文件夹操作", { exact: true }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByLabel("研究 A 文件夹操作", { exact: true }).locator("..")).toHaveJSProperty("open", false);
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await expect.poll(() => planner.folders.some((folder) => folder.id === "A")).toBe(false);
  expect(planner.items[0]!.folder_id).toBeNull();
  expect(events).toHaveLength(1);
  await expect(page.locator("article").filter({ hasText: "科研规划" })).toBeVisible();
});

test("native calendar drag preserves duration and the end handle resizes in fifteen-minute steps", async ({ page }) => {
  const { events } = await planningServer(page);
  await createScheduledItem(page);
  let block = page.getByRole("button", { name: /^科研规划 / });
  await block.scrollIntoViewIfNeeded();
  const originalStart = new Date(events[0]!.start).getTime();
  const duration = new Date(events[0]!.end).getTime() - originalStart;
  let box = await block.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 45, { steps: 12 });
  await page.clock.runFor(50);
  await page.mouse.up();
  await expect.poll(() => new Date(events[0]!.start).getTime()).not.toBe(originalStart);
  expect(new Date(events[0]!.end).getTime() - new Date(events[0]!.start).getTime()).toBe(duration);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  block = page.getByRole("button", { name: /^科研规划 / });
  // FullCalendar 7.1.1 publishes hashed classes for its real resize handle.
  // Grabbing the event body's bottom edge instead can start a move operation.
  const endHandle = block.locator(".fc-qd.fc-2I");
  await expect(endHandle).toHaveCSS("cursor", "s-resize");
  await endHandle.scrollIntoViewIfNeeded();
  box = await endHandle.boundingBox();
  expect(box).not.toBeNull();
  const beforeResize = new Date(events[0]!.start).getTime();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 45, { steps: 12 });
  await page.clock.runFor(50);
  await page.mouse.up();
  await expect
    .poll(() => new Date(events[0]!.end).getTime() - new Date(events[0]!.start).getTime())
    .toBeGreaterThan(duration);
  expect(new Date(events[0]!.start).getTime()).toBe(beforeResize);
  expect(new Date(events[0]!.end).getTime() % 900000).toBe(0);
  expect(events[0]!.revision).toBe(3);
});

test("native planning fields have exact labels independent of their select option text", async ({ page }) => {
  const { planner } = await planningServer(page);
  await page.goto("/planner");
  await page.getByRole("button", { name: "个人事项", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "事项名称", exact: true }).fill("学习命名验证");
  await dialog.getByRole("textbox", { name: "说明", exact: true }).fill("原始事项说明");
  const kind = dialog.getByRole("combobox", { name: "类型", exact: true });
  await expect(kind).toBeVisible();
  await kind.selectOption("study");
  await expect(kind).toHaveValue("study");
  const folder = dialog.getByLabel("文件夹", { exact: true });
  await expect(folder.locator("option")).toHaveCount(5);
  await folder.selectOption("B");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => planner.items[0]?.kind).toBe("study");
  expect(planner.items[0]!.folder_id).toBe("B");
});

for (const insecureOrigin of [false, true]) {
  test(`blank calendar selection opens a form without crashing on ${insecureOrigin ? "LAN HTTP" : "localhost"}`, async ({
    page,
    baseURL,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    if (insecureOrigin) {
      // Exercise the deployed non-loopback HTTP browser context with isolated assets/data.
      await page.route("http://planning.lab.test/**", async (route) => {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: new URL(`${url.pathname}${url.search}`, baseURL).href });
        await route.fulfill({ response });
      });
    }
    await planningServer(page);
    await page.goto(insecureOrigin ? "http://planning.lab.test/planner" : "/planner");
    expect(await page.evaluate(() => window.isSecureContext)).toBe(!insecureOrigin);
    const calendar = page.locator(".lab-calendar");
    await calendar.scrollIntoViewIfNeeded();
    const box = await calendar.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + 200, box!.y + 250);
    await page.mouse.down();
    await page.mouse.move(box!.x + 200, box!.y + 310, { steps: 12 });
    await page.clock.runFor(50);
    await page.mouse.up();
    await page.waitForTimeout(200);
    expect(errors, "Selecting a new time block must not reach Plane's error boundary").toEqual([]);
    await expect(page.getByRole("dialog", { name: "安排个人时间" })).toBeVisible();
    await expect(page.getByLabel("开始（上海）", { exact: true })).not.toHaveValue("");
    await expect(page.locator(".lab-calendar")).toBeVisible();
  });
}
