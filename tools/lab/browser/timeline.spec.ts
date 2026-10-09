/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { LabEvent, LabItem, LabPlanner } from "../../../packages/types/src/lab";

const item = (id: string, title: string, folder: string | null): LabItem => ({
  id,
  title,
  folder_id: folder,
  status: "todo",
  kind: "research",
  public: false,
  issue_id: null,
  project_name: null,
  issue_key: null,
  priority: null,
  target_date: null,
  schedule: { future_count: 0, next_start: null, next_end: null, week_minutes: 0, total_count: 0 },
});

async function fixture(page: Page, section: "team" | "workbench") {
  const planner: LabPlanner = {
    user_id: "member",
    team_access: true,
    timezone: "Asia/Shanghai",
    week_start: 1,
    step_minutes: 15,
    folders: ["A", "B", "C", "D"].map((name, position) => ({ id: name, name, position })),
    items: [
      {
        ...item("project-item", "阵列实验", "A"),
        kind: "project",
        public: true,
        issue_id: "source-issue",
        project_id: "project",
        project_name: "海声实验",
        issue_key: "OOA-42",
        priority: "high",
      },
      { ...item("private-item", "学习信号处理", "B"), kind: "study", description: "本人阅读计划" },
      item("unscheduled-item", "尚未安排的探索", null),
    ],
    projects: [
      {
        id: "project",
        name: "海声实验",
        lead: true,
        members: [],
        states: [],
        mapping: { todo: null, active: null, review: null, done: null },
      },
    ],
  };
  const ownEvents: LabEvent[] = [
    {
      id: "own-block",
      user_id: "member",
      title: "阵列实验",
      item_id: "project-item",
      project_id: "project",
      issue_id: "source-issue",
      kind: "project",
      status: "todo",
      editable: true,
      revision: 1,
      start: "2026-10-08T01:00:00.000Z",
      end: "2026-10-08T03:00:00.000Z",
    },
  ];
  const busy: LabEvent = {
    id: "opaque-busy",
    user_id: "other",
    title: "忙碌",
    editable: false,
    start: "2026-10-08T02:00:00.000Z",
    end: "2026-10-08T04:00:00.000Z",
  };
  const ownOpaque: LabEvent = {
    id: "own-opaque",
    user_id: "member",
    title: "忙碌",
    editable: false,
    start: "2026-10-08T05:00:00.000Z",
    end: "2026-10-08T06:00:00.000Z",
  };
  const calendarQueries: URLSearchParams[] = [];
  const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];
  let folderCounter = 0;
  await page.clock.install({ time: new Date("2026-10-08T00:00:00Z") });
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split("/lab/lab/")[1]!;
    const method = route.request().method();
    const body = method === "GET" ? undefined : (route.request().postDataJSON() as Record<string, unknown>);
    let result: unknown = {};
    if (method !== "GET") writes.push({ method, path, body: body! });
    if (path === "planner/") {
      for (const row of planner.items) {
        const blocks = ownEvents.filter((event) => event.item_id === row.id);
        row.schedule = {
          future_count: blocks.length,
          next_start: blocks[0]?.start ?? null,
          next_end: blocks[0]?.end ?? null,
          total_count: blocks.length,
          week_minutes: blocks.reduce(
            (sum, event) => sum + (Date.parse(event.end) - Date.parse(event.start)) / 60000,
            0
          ),
        };
      }
      result = planner;
    } else if (path === "folders/" && method === "PUT") {
      planner.folders = (body!.ids as string[]).map((id, position) => {
        const folder = planner.folders.find((row) => row.id === id)!;
        folder.position = position;
        return folder;
      });
    } else if (path === "folders/" && method === "POST") {
      folderCounter += 1;
      const folder = {
        id: folderCounter === 1 ? "new-folder" : `new-folder-${folderCounter}`,
        name: String(body!.name),
        position: planner.folders.length,
      };
      planner.folders.push(folder);
      result = folder;
    } else if (path.startsWith("folders/") && method === "PATCH") {
      const folder = planner.folders.find((row) => path === `folders/${row.id}/`)!;
      folder.name = String(body!.name);
      result = folder;
    } else if (path === "calendar/" && method === "GET") {
      calendarQueries.push(new URLSearchParams(url.searchParams));
      const team = url.searchParams.get("team") === "1";
      const events = [...ownEvents, ownOpaque, ...(team ? [busy] : [])].filter(
        (event) =>
          (!url.searchParams.get("user_id") || event.user_id === url.searchParams.get("user_id")) &&
          (!url.searchParams.get("project_id") ||
            !event.item_id ||
            event.project_id === url.searchParams.get("project_id")) &&
          Date.parse(event.start) < Date.parse(url.searchParams.get("end")!) &&
          Date.parse(event.end) > Date.parse(url.searchParams.get("start")!)
      );
      const members = [{ id: "member", name: "本人" }, ...(team ? [{ id: "other", name: "团队成员" }] : [])].filter(
        (member) => !url.searchParams.get("user_id") || member.id === url.searchParams.get("user_id")
      );
      for (const event of events) {
        if (event.kind) {
          event.category_id = event.kind;
          event.category_name = event.kind;
          event.category_color = event.kind === "project" ? "#1d4ed8" : event.kind === "study" ? "#15803d" : "#7c3aed";
        }
      }
      result = { events, members };
    } else if (path === "calendar/" && method === "POST") {
      const source = planner.items.find((row) => row.id === body!.item_id)!;
      expect(source).toBeDefined();
      const created: LabEvent = {
        id: `created-${ownEvents.length}`,
        user_id: "member",
        title: source.title,
        item_id: source.id,
        kind: source.kind,
        editable: true,
        revision: 1,
        start: String(body!.start),
        end: String(body!.end),
      };
      ownEvents.push(created);
      result = { id: created.id, revision: 1, overlap: false };
    } else if (path.startsWith("calendar/") && method === "PATCH") {
      const event = ownEvents.find((row) => path === `calendar/${row.id}/`)!;
      expect(event).toBeDefined();
      expect(body!.expected_revision).toBe(event.revision);
      event.revision! += 1;
      if (body!.split_at) {
        const end = event.end;
        event.end = String(body!.split_at);
        ownEvents.push({ ...event, id: `split-${ownEvents.length}`, revision: 1, start: event.end, end });
      } else {
        event.start = String(body!.start);
        event.end = String(body!.end);
      }
      result = { id: event.id, revision: event.revision, overlap: false };
    }
    await route.fulfill({ json: result });
  });
  await page.goto(`/${section}`);
  return { planner, ownEvents, busy, calendarQueries, writes };
}

async function selectLane(page: Page, lane: Locator) {
  const selectionMode = page.getByRole("button", { name: "框选排期", exact: true });
  if (await selectionMode.isVisible()) {
    if ((await selectionMode.getAttribute("aria-pressed")) !== "true") await selectionMode.click();
  }
  await lane.scrollIntoViewIfNeeded();
  const box = await lane.boundingBox();
  expect(box).not.toBeNull();
  const grid = await page.locator(".lab-calendar").boundingBox();
  expect(grid).not.toBeNull();
  const left = Math.max(box!.x, grid!.x + 190);
  const right = Math.min(box!.x + box!.width, grid!.x + grid!.width, page.viewportSize()!.width) - 8;
  const x = left + (right - left) * 0.8,
    y = box!.y + box!.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(Math.min(x + 36, right), y, { steps: 12 });
  await page.clock.runFor(50);
  await page.mouse.up();
}

async function chooseDay(page: Page) {
  await page
    .getByRole("navigation", { name: "时间轴范围", exact: true })
    .getByRole("button", { name: "日", exact: true })
    .click();
  await page.getByLabel("跳转日期", { exact: true }).fill("2026-10-08");
  await page.getByRole("button", { name: "放大时间轴", exact: true }).click();
}

async function createFolder(page: Page, name: string) {
  await page
    .getByRole("region", { name: "文件夹看板区域", exact: true })
    .getByRole("button", { name: "新增文件夹", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "新增文件夹", exact: true });
  await dialog.getByLabel("名称", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

test("team timeline day week and month request matching ranges and filters", async ({ page }) => {
  const { calendarQueries } = await fixture(page, "team");
  const scale = page.getByRole("navigation", { name: "时间轴范围", exact: true });
  await expect(scale).toBeVisible();
  await expect(scale.getByRole("button", { name: "周", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const [label, minimumDays, maximumDays] of [
    ["日", 1, 1],
    ["周", 7, 7],
    ["月", 28, 31],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- Scale transitions share one calendar and must finish in order.
    await scale.getByRole("button", { name: label, exact: true }).click();
    // oxlint-disable-next-line no-await-in-loop -- Verify the request produced by this scale before changing it again.
    await expect
      .poll(() => {
        const query = calendarQueries.at(-1)!;
        const days = (Date.parse(query.get("end")!) - Date.parse(query.get("start")!)) / 86400000;
        return days >= minimumDays && days <= maximumDays;
      })
      .toBe(true);
    const query = calendarQueries.at(-1)!;
    expect((Date.parse(query.get("end")!) - Date.parse(query.get("start")!)) / 86400000).toBeLessThanOrEqual(
      maximumDays
    );
    expect(query.get("team")).toBe("1");
  }
  const start = calendarQueries.at(-1)!.get("start");
  await page.getByLabel("下一时段", { exact: true }).click();
  await expect.poll(() => calendarQueries.at(-1)!.get("start")).not.toBe(start);
  await page.getByRole("combobox", { name: "筛选成员", exact: true }).click();
  await page.getByRole("option", { name: "团队成员", exact: true }).click();
  await expect.poll(() => calendarQueries.at(-1)!.get("user_id")).toBe("other");
  await page.getByRole("combobox", { name: "筛选项目", exact: true }).click();
  await page.getByRole("option", { name: "海声实验", exact: true }).click();
  await expect.poll(() => calendarQueries.at(-1)!.get("project_id")).toBe("project");
  await page.getByRole("button", { name: "人员分列", exact: true }).click();
  await expect(scale).toBeHidden();
  await page.getByRole("button", { name: "人员时间轴", exact: true }).click();
  await expect(scale.getByRole("button", { name: "月", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("team native timeline selection rejects other rows and opaque busy export has no item metadata", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const { ownEvents, writes } = await fixture(page, "team");
  await chooseDay(page);
  await selectLane(page, page.locator('[data-lab-resource="other"]'));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const hidden = page.locator('[data-lab-calendar-event="opaque-busy"]');
  await expect(hidden).toContainText("忙碌");
  await hidden.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "JSON", exact: true }).click();
  const download = await downloadPromise;
  const data = JSON.parse(await readFile((await download.path())!, "utf8")) as Record<string, unknown>[];
  const exportedBusy = data.find((row) => row.member === "团队成员")!;
  expect(exportedBusy.title).toBe("忙碌");
  expect(Object.keys(exportedBusy).toSorted()).toEqual(["end", "member", "start", "timezone", "title"]);
  await selectLane(page, page.locator('[data-lab-resource="member"]'));
  const dialog = page.getByRole("dialog", { name: "安排个人时间", exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("事项", { exact: true }).selectOption("private-item");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => ownEvents.length).toBe(2);
  expect(writes).toHaveLength(1);
  expect(writes[0]!.body.item_id).toBe("private-item");
  expect(ownEvents[1]!.user_id).toBe("member");
});

test("personal timeline keeps unscheduled item rows and selection prefills the original item", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { ownEvents, writes } = await fixture(page, "workbench");
  const pane = page.getByRole("region", { name: "个人周历区域", exact: true });
  await pane.getByRole("button", { name: "事项时间轴", exact: true }).click();
  await expect(
    pane.getByRole("navigation", { name: "时间轴范围", exact: true }).getByRole("button", { name: "周", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await pane
    .getByRole("navigation", { name: "时间轴范围", exact: true })
    .getByRole("button", { name: "月", exact: true })
    .click();
  await expect(
    pane.getByRole("navigation", { name: "时间轴范围", exact: true }).getByRole("button", { name: "月", exact: true })
  ).toHaveAttribute("aria-pressed", "true");
  await chooseDay(page);
  await expect(pane.locator('[data-lab-item="unscheduled-item"]')).toBeVisible();
  await expect(pane.locator('[role="rowheader"][data-resource-id="item:project-item"]')).toContainText("OOA-42");
  await selectLane(page, pane.locator('[data-lab-resource="folder:A"]'));
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await selectLane(page, pane.locator('[data-lab-item="unscheduled-item"]'));
  const dialog = page.getByRole("dialog", { name: "安排个人时间", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("事项", { exact: true })).toHaveValue("unscheduled-item");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => ownEvents.length).toBe(2);
  expect(writes[0]!.body.item_id).toBe("unscheduled-item");
  expect(ownEvents[1]!.item_id).toBe("unscheduled-item");
  expect(Date.parse(ownEvents[1]!.start) % 900000).toBe(0);
  expect(Date.parse(ownEvents[1]!.end) % 900000).toBe(0);
  await expect(pane.locator('[data-lab-calendar-event="created-1"]')).toBeVisible();
});

test("personal folder groups retain their markers while timeline blocks use category colors", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { planner, ownEvents } = await fixture(page, "workbench");
  const pane = page.getByRole("region", { name: "个人周历区域", exact: true });
  await pane.getByRole("button", { name: "事项时间轴", exact: true }).click();
  ownEvents.push({
    id: "private-block",
    user_id: "member",
    title: "学习信号处理",
    item_id: "private-item",
    kind: "study",
    editable: true,
    revision: 1,
    start: "2026-10-08T05:00:00.000Z",
    end: "2026-10-08T06:00:00.000Z",
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(pane.locator('[data-lab-calendar-event="private-block"]')).toBeVisible();
  const folderA = pane.locator('[role="rowheader"][data-resource-id="folder:A"]');
  const folderB = pane.locator('[role="rowheader"][data-resource-id="folder:B"]');
  await expect(folderA).toContainText("A");
  await expect(folderB).toContainText("B");
  const aColor = await folderA
    .locator(".lab-folder-marker")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  const bColor = await folderB
    .locator(".lab-folder-marker")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(aColor).not.toBe(bColor);
  const itemMarker = pane.locator('[role="rowheader"][data-resource-id="item:project-item"] .lab-folder-marker');
  await expect(itemMarker).toHaveCSS("background-color", aColor);
  await expect(pane.locator('[data-lab-calendar-event="own-block"]')).toHaveCSS("--fc-event-color", "#1d4ed8");
  await expect(pane.locator('[data-lab-calendar-event="private-block"]')).toHaveCSS("--fc-event-color", "#15803d");
  const projectLane = pane.locator('[data-lab-item="project-item"]');
  await expect(projectLane).toBeVisible();
  await folderA.locator('span[aria-hidden="true"]').first().click();
  await expect(projectLane).toHaveCount(0);
  await expect(pane.locator('[data-lab-calendar-event="own-block"]')).toHaveCount(0);
  await expect(pane.locator('[data-lab-item="private-item"]')).toBeVisible();
  await folderA.locator('span[aria-hidden="true"]').first().click();
  await expect(projectLane).toBeVisible();
  await expect(pane.locator('[data-lab-calendar-event="own-block"]')).toBeVisible();
  const board = page.getByRole("region", { name: "文件夹看板区域", exact: true });
  const handle = board.getByRole("button", { name: "拖动排序文件夹 A", exact: true });
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(handle).toHaveAttribute("aria-pressed", "true");
  await page.clock.runFor(50);
  await page.evaluate(
    () => new Promise<void>((ready) => requestAnimationFrame(() => requestAnimationFrame(() => ready())))
  );
  await page.keyboard.press("ArrowRight");
  await page.clock.runFor(50);
  await expect(page.getByText("移动到B", { exact: true })).toHaveCount(1);
  await page.keyboard.press("Space");
  await page.clock.runFor(50);
  await expect.poll(() => planner.folders.map((folder) => folder.id)).toEqual(["B", "A", "C", "D"]);
  await expect(folderA.locator(".lab-folder-marker")).toHaveCSS("background-color", aColor);
  await expect(folderB.locator(".lab-folder-marker")).toHaveCSS("background-color", bColor);
  await board.getByLabel("A 文件夹操作", { exact: true }).click();
  await board.getByRole("button", { name: "改名", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("研究 A");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(folderA).toContainText("研究 A");
  await expect(folderA.locator(".lab-folder-marker")).toHaveCSS("background-color", aColor);
  await createFolder(page, "E");
  const folderE = pane.locator('[role="rowheader"][data-resource-id="folder:new-folder"]');
  await expect(folderE).toContainText("E");
  const eColor = await folderE
    .locator(".lab-folder-marker")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(eColor).not.toBe(aColor);
  expect(eColor).not.toBe(bColor);
  await page.reload();
  await pane.getByRole("button", { name: "事项时间轴", exact: true }).click();
  await expect(folderA).toContainText("研究 A");
  await Promise.all([
    expect(folderA.locator(".lab-folder-marker")).toHaveCSS("background-color", aColor),
    expect(folderB.locator(".lab-folder-marker")).toHaveCSS("background-color", bColor),
    expect(folderE.locator(".lab-folder-marker")).toHaveCSS("background-color", eColor),
    expect(pane.locator('[data-lab-calendar-event="own-block"]')).toHaveCSS("--fc-event-color", "#1d4ed8"),
    expect(pane.locator('[data-lab-calendar-event="private-block"]')).toHaveCSS("--fc-event-color", "#15803d"),
  ]);
});

async function checkOpaqueExport(page: Page, pane: Locator) {
  const opaque = pane.locator('[data-lab-calendar-event="own-opaque"]');
  expect(
    await opaque.evaluate((element) => element.closest("[data-lab-resource]")?.getAttribute("data-lab-resource"))
  ).toBe("busy");
  await expect(pane.locator('[data-lab-resource="busy"]')).not.toHaveAttribute("data-lab-item", /.+/);
  await opaque.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opaque.locator(".fc-qd")).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await pane.getByRole("button", { name: "JSON", exact: true }).click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile((await download.path())!, "utf8")) as Record<string, unknown>[];
  expect(exported.some((row) => row.title === "阵列实验")).toBe(false);
  expect(exported.some((row) => row.title === "忙碌")).toBe(true);
  for (const row of exported)
    expect(Object.keys(row).toSorted()).toEqual(["end", "member", "start", "timezone", "title"]);
  const csvPromise = page.waitForEvent("download");
  await pane.getByRole("button", { name: "CSV", exact: true }).click();
  const csv = await readFile((await (await csvPromise).path())!, "utf8");
  expect(csv).toContain("忙碌");
  expect(csv).not.toContain("阵列实验");
}

test("personal folder visibility survives calendar modes dates and refreshed planner responses", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { calendarQueries } = await fixture(page, "workbench");
  const pane = page.getByRole("region", { name: "个人周历区域", exact: true });
  await pane.getByRole("button", { name: "事项时间轴", exact: true }).click();
  await pane.getByRole("button", { name: "显示文件夹", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "选择显示的文件夹", exact: true });
  await Promise.all(
    ["A", "B", "C", "D", "未分类"].map((folder) =>
      expect(picker.getByRole("checkbox", { name: folder, exact: true })).toBeChecked()
    )
  );
  await picker.getByRole("checkbox", { name: "A", exact: true }).uncheck();
  await picker.getByRole("checkbox", { name: "未分类", exact: true }).uncheck();
  await picker.getByRole("button", { name: "保存", exact: true }).click();
  await expect(pane.locator('[data-lab-resource="folder:A"]')).toHaveCount(0);
  await expect(pane.locator('[data-lab-item="project-item"]')).toHaveCount(0);
  await expect(pane.locator('[data-lab-calendar-event="own-block"]')).toHaveCount(0);
  await expect(pane.locator('[data-lab-item="unscheduled-item"]')).toHaveCount(0);
  await expect(pane.locator('[data-lab-item="private-item"]')).toBeVisible();
  await expect(pane.locator('[data-lab-calendar-event="own-opaque"]')).toBeVisible();
  await checkOpaqueExport(page, pane);
  const retainedColor = await pane
    .locator('[role="rowheader"][data-resource-id="folder:B"] .lab-folder-marker')
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  await page.reload();
  await pane.getByRole("button", { name: "事项时间轴", exact: true }).click();
  await Promise.all([
    expect(pane.locator('[data-lab-resource="folder:A"]')).toHaveCount(0),
    expect(pane.locator('[data-lab-resource="folder:unclassified"]')).toHaveCount(0),
    expect(pane.locator('[data-lab-item="private-item"]')).toBeVisible(),
    expect(pane.locator('[role="rowheader"][data-resource-id="folder:B"] .lab-folder-marker')).toHaveCSS(
      "background-color",
      retainedColor
    ),
    expect(pane.locator('[data-lab-calendar-event="own-opaque"]')).toBeVisible(),
  ]);
  await pane.getByRole("button", { name: "显示文件夹", exact: true }).click();
  await Promise.all([
    expect(picker.getByRole("checkbox", { name: "A", exact: true })).not.toBeChecked(),
    expect(picker.getByRole("checkbox", { name: "未分类", exact: true })).not.toBeChecked(),
  ]);
  await picker.getByRole("button", { name: "取消", exact: true }).click();
  await pane.getByLabel("跳转日期", { exact: true }).fill("2026-11-16");
  await expect.poll(() => calendarQueries.at(-1)!.get("start")).toBe("2026-11-15T16:00:00.000Z");
  await page.getByRole("button", { name: "文件夹看板", exact: true }).click();
  await page.getByRole("button", { name: "个人周历", exact: true }).click();
  await expect(pane.getByRole("button", { name: "事项时间轴", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(pane.locator('[data-lab-resource="folder:A"]')).toHaveCount(0);
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await expect(pane.locator('[data-lab-item="private-item"]')).toBeVisible();
  await expect(pane.locator('[data-lab-resource="folder:A"]')).toHaveCount(0);
  await pane.getByRole("button", { name: "显示文件夹", exact: true }).click();
  await expect(picker.getByRole("checkbox", { name: "A", exact: true })).not.toBeChecked();
  await picker.getByRole("button", { name: "取消", exact: true }).click();
  await pane.getByRole("combobox", { name: "筛选项目", exact: true }).click();
  await page.getByRole("option", { name: "海声实验", exact: true }).click();
  await expect.poll(() => calendarQueries.at(-1)!.get("project_id")).toBe("project");
  await expect(pane.locator('[data-lab-item="private-item"]')).toHaveCount(0);
  await expect(pane.locator('[data-lab-item="unscheduled-item"]')).toHaveCount(0);
});

test("team timeline native moves resizing and splitting preserve owner and item identity", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const { ownEvents, writes } = await fixture(page, "team");
  await chooseDay(page);
  const block = page.locator('[data-lab-calendar-event="own-block"]');
  await block.scrollIntoViewIfNeeded();
  const originalStart = Date.parse(ownEvents[0]!.start),
    duration = Date.parse(ownEvents[0]!.end) - originalStart;
  let box = await block.boundingBox();
  expect(box).not.toBeNull();
  const otherRow = await page.locator('[data-lab-resource="other"]').boundingBox();
  expect(otherRow).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 60, otherRow!.y + otherRow!.height / 2, { steps: 12 });
  await page.clock.runFor(50);
  await page.mouse.up();
  await expect.poll(() => Date.parse(ownEvents[0]!.start)).not.toBe(originalStart);
  expect(Date.parse(ownEvents[0]!.end) - Date.parse(ownEvents[0]!.start)).toBe(duration);
  expect(ownEvents[0]!.user_id).toBe("member");
  expect(
    await block.evaluate((element) => element.closest("[data-lab-resource]")?.getAttribute("data-lab-resource"))
  ).toBe("member");
  const resize = block.locator(".fc-qd.fc-2I");
  await block.hover();
  await page.clock.runFor(50);
  await expect(resize).toHaveCSS("cursor", "e-resize");
  await expect(resize).toBeVisible();
  box = await resize.boundingBox();
  expect(box).not.toBeNull();
  const beforeResize = Date.parse(ownEvents[0]!.start);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 30, box!.y + box!.height / 2, { steps: 12 });
  await page.clock.runFor(50);
  await page.mouse.up();
  await expect.poll(() => Date.parse(ownEvents[0]!.end) - Date.parse(ownEvents[0]!.start)).toBeGreaterThan(duration);
  expect(Date.parse(ownEvents[0]!.start)).toBe(beforeResize);
  expect(Date.parse(ownEvents[0]!.end) % 900000).toBe(0);
  await block.getByRole("button", { name: "调整 阵列实验 的排期", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "拆分时间块", exact: true }).click();
  const split = new Date(Date.parse(ownEvents[0]!.start) + 3600000);
  const local = new Date(split.getTime() + 8 * 3600000).toISOString().slice(0, 16);
  await dialog.getByLabel("拆分时间（上海）", { exact: true }).fill(local);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => ownEvents.length).toBe(2);
  expect(ownEvents.map((event) => event.item_id)).toEqual(["project-item", "project-item"]);
  expect(ownEvents.map((event) => event.user_id)).toEqual(["member", "member"]);
  for (const write of writes)
    expect(Object.keys(write.body).toSorted()).toEqual(
      write.body.split_at ? ["expected_revision", "split_at"] : ["end", "expected_revision", "start"]
    );
});

test("monthly native selection moves and resizing retain quarter-hour precision", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { ownEvents, writes } = await fixture(page, "workbench");
  await page.getByRole("button", { name: "个人周历", exact: true }).click();
  const pane = page.getByRole("region", { name: "个人周历区域", exact: true });
  await pane.getByRole("button", { name: "事项时间轴", exact: true }).click();
  ownEvents[0]!.start = "2026-10-08T01:15:00.000Z";
  ownEvents[0]!.end = "2026-10-08T03:45:00.000Z";
  await pane
    .getByRole("navigation", { name: "时间轴范围", exact: true })
    .getByRole("button", { name: "月", exact: true })
    .click();
  await pane.getByRole("button", { name: "放大时间轴", exact: true }).click();
  const day = pane.locator('[data-date^="2026-10-08"]').first();
  await day.scrollIntoViewIfNeeded();
  const column = await day.boundingBox();
  const lane = await pane.locator('[data-lab-item="unscheduled-item"]').boundingBox();
  expect(column).not.toBeNull();
  expect(lane).not.toBeNull();
  const startX = column!.x + (column!.width * 9.25) / 24;
  const endX = column!.x + (column!.width * 12.25) / 24;
  const y = lane!.y + lane!.height / 2;
  await page.mouse.move(startX, y);
  await page.mouse.down();
  await page.mouse.move(endX, y, { steps: 12 });
  await page.clock.runFor(50);
  await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "安排个人时间", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("事项", { exact: true })).toHaveValue("unscheduled-item");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => ownEvents.length).toBe(2);
  const selected = ownEvents[1]!;
  const selectedDuration = Date.parse(selected.end) - Date.parse(selected.start);
  expect(selectedDuration).toBeGreaterThanOrEqual(2 * 3600000);
  expect(selectedDuration).toBeLessThanOrEqual(4 * 3600000);
  expect(Date.parse(selected.start) % 900000).toBe(0);
  expect(Date.parse(selected.end) % 900000).toBe(0);
  const block = pane.locator('[data-lab-calendar-event="own-block"]');
  await block.scrollIntoViewIfNeeded();
  await expect(block).toContainText("09:15–11:45");
  const originalStart = Date.parse(ownEvents[0]!.start);
  const originalEnd = Date.parse(ownEvents[0]!.end);
  let box = await block.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + column!.width / 4, box!.y + box!.height / 2, { steps: 12 });
  await page.clock.runFor(50);
  await page.mouse.up();
  await expect.poll(() => Date.parse(ownEvents[0]!.start)).not.toBe(originalStart);
  const move = Date.parse(ownEvents[0]!.start) - originalStart;
  expect(move).toBeGreaterThan(0);
  expect(move).toBeLessThan(86400000);
  expect(move % 900000).toBe(0);
  expect(Date.parse(ownEvents[0]!.start) % 3600000).toBe(originalStart % 3600000);
  expect(Date.parse(ownEvents[0]!.end) - Date.parse(ownEvents[0]!.start)).toBe(originalEnd - originalStart);
  const resize = block.locator(".fc-qd.fc-2I");
  await block.hover();
  await page.clock.runFor(50);
  await expect(resize).toBeVisible();
  box = await resize.boundingBox();
  expect(box).not.toBeNull();
  const beforeResizeStart = Date.parse(ownEvents[0]!.start);
  const beforeResizeEnd = Date.parse(ownEvents[0]!.end);
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + column!.width / 8, box!.y + box!.height / 2, { steps: 12 });
  await page.clock.runFor(50);
  await page.mouse.up();
  await expect.poll(() => Date.parse(ownEvents[0]!.end)).toBeGreaterThan(beforeResizeEnd);
  const resized = Date.parse(ownEvents[0]!.end) - beforeResizeEnd;
  expect(resized).toBeLessThan(86400000);
  expect(resized % 900000).toBe(0);
  expect(Date.parse(ownEvents[0]!.start)).toBe(beforeResizeStart);
  expect(ownEvents[0]!.item_id).toBe("project-item");
  expect(ownEvents[0]!.issue_id).toBe("source-issue");
  expect(writes.filter((write) => write.method === "PATCH")).toHaveLength(2);
});

test("more than seven user-created folders retain distinct colors after reloading", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1400 });
  const { planner } = await fixture(page, "workbench");
  const pane = page.getByRole("region", { name: "个人周历区域", exact: true });
  await pane.getByRole("button", { name: "事项时间轴", exact: true }).click();
  for (const name of ["E", "F", "G", "H", "I", "J", "K", "L"]) {
    // oxlint-disable-next-line no-await-in-loop -- Each creation opens and submits the same real dialog.
    await createFolder(page, name);
  }
  expect(planner.folders).toHaveLength(12);
  const colors = await Promise.all(
    planner.folders.map(async (folder) => ({
      id: folder.id,
      color: await pane
        .locator(`[role="rowheader"][data-resource-id="folder:${folder.id}"] .lab-folder-marker`)
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    }))
  );
  expect(new Set(colors.map((folder) => folder.color)).size).toBe(12);
  await page.reload();
  await pane.getByRole("button", { name: "事项时间轴", exact: true }).click();
  await Promise.all(
    colors.map(({ id, color }) =>
      expect(pane.locator(`[role="rowheader"][data-resource-id="folder:${id}"] .lab-folder-marker`)).toHaveCSS(
        "background-color",
        color
      )
    )
  );
});
