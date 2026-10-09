/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type { LabEvent, LabPlanner } from "../../../packages/types/src/lab";

let server: ReturnType<typeof createServer>;
let origin = "";
let directory = "";
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "lab-calendar-pan-"));
  const require = createRequire(resolve("apps/web/package.json"));
  const { build } = require("esbuild") as typeof import("esbuild");
  await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { MemoryRouter } from 'react-router'; import { LabStore } from '${resolve("packages/shared-state/src/lab.store.ts")}'; import { LabCalendar } from '${resolve("apps/web/core/components/lab/calendar.tsx")}'; const store = new LabStore('', 'lab'); store.planner = window.labPlanner; createRoot(document.getElementById('root')).render(<MemoryRouter><LabCalendar store={store} team clearScheduled={() => {}} /></MemoryRouter>);`,
      resolveDir: resolve("apps/web"),
      loader: "tsx",
      sourcefile: "lab-calendar-pan-harness.tsx",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    outfile: join(directory, "app.js"),
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
    loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl" },
    logLevel: "silent",
  });
  const assetDirectory = resolve("apps/web/build/client/assets");
  const globalStyle = (await readdir(assetDirectory)).find(
    (name) => name.startsWith("globals-") && name.endsWith(".css")
  );
  if (!globalStyle) throw new Error("The calendar visual fixture requires the current production global stylesheet");
  server = createServer(async (request, response) => {
    const file = request.url === "/app.js" ? "app.js" : request.url === "/app.css" ? "app.css" : null;
    response.setHeader(
      "Content-Type",
      file === "app.js" ? "text/javascript" : file || request.url === "/global.css" ? "text/css" : "text/html"
    );
    response.end(
      request.url === "/global.css"
        ? await readFile(join(assetDirectory, globalStyle))
        : file
          ? await readFile(join(directory, file))
          : '<!doctype html><html data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/app.css"><style>body{font-family:Inter,sans-serif;background:#f7f8fa;padding:24px}#root{max-width:1120px;margin:auto}[role=dialog]{background:white;position:fixed;inset:5%;overflow:auto;padding:24px;z-index:100}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
    );
  });
  await new Promise<void>((resolveListening) => server.listen(0, "127.0.0.1", resolveListening));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function mount(page: Page) {
  const planner: LabPlanner = {
    user_id: "member",
    team_access: true,
    timezone: "Asia/Shanghai",
    week_start: 1,
    step_minutes: 15,
    folders: [],
    projects: [],
    items: [
      {
        id: "item",
        title: "阵列实验",
        kind: "research",
        status: "todo",
        public: false,
        folder_id: null,
        issue_id: null,
        issue_key: null,
        project_name: null,
        priority: null,
        target_date: null,
        schedule: {
          total_count: 1,
          future_count: 1,
          week_minutes: 120,
          next_start: "2026-10-08T01:00:00Z",
          next_end: "2026-10-08T03:00:00Z",
        },
      },
    ],
  };
  const events: LabEvent[] = [
    {
      id: "own",
      user_id: "member",
      item_id: "item",
      title: "阵列实验",
      kind: "research",
      status: "todo",
      editable: true,
      revision: 1,
      start: "2026-10-08T01:00:00Z",
      end: "2026-10-08T03:00:00Z",
    },
    {
      id: "busy",
      user_id: "other",
      title: "忙碌",
      editable: false,
      start: "2026-10-08T01:00:00Z",
      end: "2026-10-08T07:00:00Z",
    },
  ];
  const queries: URLSearchParams[] = [];
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.setFixedTime(new Date("2026-10-08T00:00:00Z"));
  await page.addInitScript((value) => Object.assign(window, { labPlanner: value }), planner);
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.split("/lab/lab/")[1]!;
    if (route.request().method() === "GET" && path === "calendar/") {
      queries.push(new URLSearchParams(url.searchParams));
      await route.fulfill({
        json: {
          events: events.filter(
            (event) =>
              Date.parse(event.start) < Date.parse(url.searchParams.get("end")!) &&
              Date.parse(event.end) > Date.parse(url.searchParams.get("start")!)
          ),
          members: [
            { id: "member", name: "本人" },
            { id: "other", name: "团队成员" },
          ],
        },
      });
    } else if (route.request().method() === "PATCH" && path.startsWith("calendar/")) {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      writes.push({ path, body });
      const event = events.find((row) => path === `calendar/${row.id}/`)!;
      expect(event.editable).toBe(true);
      expect(body.expected_revision).toBe(event.revision);
      event.start = String(body.start);
      event.end = String(body.end);
      event.revision! += 1;
      await route.fulfill({ json: { id: event.id, revision: event.revision, overlap: false } });
    } else await route.fulfill({ json: path === "planner/" ? planner : {} });
  });
  await page.goto(origin);
  await expect(page.getByRole("button", { name: "人员时间轴", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-lab-resource="other"]')).toBeVisible();
  await expect.poll(() => queries.length).toBeGreaterThan(0);
  return { events, queries, writes, errors };
}

async function horizontalScroller(page: Page): Promise<Locator> {
  const calendars = page.locator(".lab-calendar");
  const selector = await calendars.evaluate((element) => {
    const scroll = Array.from(element.querySelectorAll<HTMLElement>("*"))
      .filter(
        (node) =>
          node.scrollWidth > node.clientWidth + 100 &&
          ["auto", "scroll"].includes(getComputedStyle(node).overflowX) &&
          node.clientHeight > 50
      )
      .toSorted((a, b) => b.clientHeight - a.clientHeight)[0];
    if (!scroll) return null;
    scroll.dataset.labPanTestScroller = "true";
    return '[data-lab-pan-test-scroller="true"]';
  });
  expect(selector).not.toBeNull();
  return page.locator(selector!);
}

async function dragBlankLane(page: Page, delta: number, resource = "other") {
  const lane = page.locator(`[data-lab-resource="${resource}"]`);
  const row = await lane.boundingBox();
  const canvas = await page.locator(".lab-calendar").boundingBox();
  expect(row).not.toBeNull();
  expect(canvas).not.toBeNull();
  const x = canvas!.x + canvas!.width * 0.6;
  const y = row!.y + row!.height - 6;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 12 });
  await page.mouse.up();
}

async function dragDateHeader(page: Page, delta: number) {
  const canvas = await page.locator(".lab-calendar").boundingBox();
  expect(canvas).not.toBeNull();
  const x = canvas!.x + canvas!.width * 0.6;
  const y = canvas!.y + 20;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 12 });
  await page.mouse.up();
}

async function assertScrollSynchronizedAndReleased(page: Page, scroller: Locator) {
  await expect
    .poll(() =>
      scroller.evaluate((body) => {
        const horizontal = Array.from(body.closest(".lab-calendar")!.querySelectorAll<HTMLElement>("*")).filter(
          (node) =>
            node.clientWidth > 300 &&
            node.scrollWidth > node.clientWidth + 100 &&
            ["auto", "scroll"].includes(getComputedStyle(node).overflowX)
        );
        return horizontal.length >= 2 && horizontal.every((node) => Math.abs(node.scrollLeft - body.scrollLeft) < 2);
      })
    )
    .toBe(true);
  const afterRelease = await scroller.evaluate((element) => element.scrollLeft);
  const box = await page.locator(".lab-calendar").boundingBox();
  await page.mouse.move(box!.x + box!.width * 0.7, box!.y + 110, { steps: 5 });
  expect(await scroller.evaluate((element) => element.scrollLeft)).toBe(afterRelease);
}

for (const area of ["background", "header"] as const) {
  test(`default full-week team timeline ${area} drag reaches earlier and later dates without scheduling writes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
    const { queries, writes, errors } = await mount(page);
    const initial = queries.at(-1)!.get("start");
    const metrics = await page.locator(".lab-calendar").evaluate((element) => ({
      width: element.clientWidth,
      scrollers: Array.from(element.querySelectorAll<HTMLElement>("*"))
        .filter((node) => ["auto", "scroll"].includes(getComputedStyle(node).overflowX) && node.clientHeight > 50)
        .map((node) => ({ clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })),
    }));
    console.log(
      `calendar pan ${area} before:`,
      JSON.stringify({ start: initial, end: queries.at(-1)!.get("end"), ...metrics })
    );
    if (area === "background") await dragBlankLane(page, -240);
    else await dragDateHeader(page, -240);
    await expect.poll(() => queries.at(-1)!.get("start"), { timeout: 1500 }).not.toBe(initial);
    const later = queries.at(-1)!.get("start");
    expect(Date.parse(later!)).toBeGreaterThan(Date.parse(initial!));
    if (area === "background") await dragBlankLane(page, 240);
    else await dragDateHeader(page, 240);
    await expect.poll(() => queries.at(-1)!.get("start"), { timeout: 1500 }).not.toBe(later);
    expect(Date.parse(queries.at(-1)!.get("start")!)).toBeLessThan(Date.parse(later!));
    expect(writes).toEqual([]);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("dragging a blank team timeline lane pans dates without changing anyone's schedule", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const { writes, errors } = await mount(page);
  await page.getByRole("button", { name: "放大时间轴", exact: true }).click();
  const scroller = await horizontalScroller(page);
  await scroller.evaluate((element) => {
    element.scrollLeft = 200;
  });
  const initial = await scroller.evaluate((element) => element.scrollLeft);
  await dragBlankLane(page, -200);
  await page.locator(".lab-calendar").screenshot({ path: "/tmp/lab-team-timeline-pan-repro.png" });
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollLeft), { timeout: 1500 })
    .toBeGreaterThan(initial + 100);
  await assertScrollSynchronizedAndReleased(page, scroller);
  expect(writes).toEqual([]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("dragging the team timeline date header pans the view without creating a selection", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const { writes, errors } = await mount(page);
  await page.getByRole("button", { name: "放大时间轴", exact: true }).click();
  const scroller = await horizontalScroller(page);
  await scroller.evaluate((element) => {
    element.scrollLeft = 200;
  });
  const initial = await scroller.evaluate((element) => element.scrollLeft);
  await dragDateHeader(page, -200);
  await expect
    .poll(() => scroller.evaluate((element) => element.scrollLeft), { timeout: 1500 })
    .toBeGreaterThan(initial + 100);
  await assertScrollSynchronizedAndReleased(page, scroller);
  expect(writes).toEqual([]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("one's blank team lane browses dates by default and explicit selection permits only one's own schedule", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const { queries, writes, errors } = await mount(page);
  const mode = page.getByRole("button", { name: "框选排期", exact: true });
  await expect(mode).toHaveAttribute("aria-pressed", "false");
  const initial = queries.at(-1)!.get("start");
  await dragBlankLane(page, -240, "member");
  await expect.poll(() => queries.at(-1)!.get("start")).not.toBe(initial);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(writes).toEqual([]);
  await mode.click();
  await expect(mode).toHaveAttribute("aria-pressed", "true");
  await dragBlankLane(page, 80, "other");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const selectionStart = queries.at(-1)!.get("start");
  await dragDateHeader(page, -240);
  await expect.poll(() => queries.at(-1)!.get("start")).not.toBe(selectionStart);
  await expect(mode).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await dragBlankLane(page, 80, "member");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test("opaque read-only schedule blocks stay unchanged when dragged in browsing mode", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const { events, writes, errors } = await mount(page);
  await page
    .getByRole("navigation", { name: "时间轴范围", exact: true })
    .getByRole("button", { name: "日", exact: true })
    .click();
  await page.getByLabel("跳转日期", { exact: true }).fill("2026-10-08");
  await page.getByRole("button", { name: "放大时间轴", exact: true }).click();
  const block = page.locator('[data-lab-calendar-event="busy"]');
  await expect(block).toBeVisible();
  const before = { start: events[1]!.start, end: events[1]!.end };
  const box = await block.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2, { steps: 12 });
  await page.mouse.up();
  expect(events[1]!.start).toBe(before.start);
  expect(events[1]!.end).toBe(before.end);
  expect(writes).toEqual([]);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("moving and stretching one's own timeline block still save scheduling changes", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const { events, writes, errors } = await mount(page);
  await page
    .getByRole("navigation", { name: "时间轴范围", exact: true })
    .getByRole("button", { name: "日", exact: true })
    .click();
  await page.getByLabel("跳转日期", { exact: true }).fill("2026-10-08");
  await page.getByRole("button", { name: "放大时间轴", exact: true }).click();
  const block = page.locator('[data-lab-calendar-event="own"]');
  await expect(block).toBeVisible();
  const before = { start: events[0]!.start, end: events[0]!.end };
  let box = await block.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 80, box!.y + box!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => writes.length).toBe(1);
  expect(events[0]!.start).not.toBe(before.start);
  const duration = Date.parse(before.end) - Date.parse(before.start);
  expect(Date.parse(events[0]!.end) - Date.parse(events[0]!.start)).toBe(duration);
  await expect(page.getByRole("button", { name: "CSV", exact: true })).toBeEnabled();
  await block.hover();
  const resize = block.locator(".fc-qd.fc-2I");
  await expect(resize).toBeVisible();
  await expect(resize).toHaveCSS("cursor", "e-resize");
  box = await resize.boundingBox();
  const afterMoveStart = events[0]!.start;
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 40, box!.y + box!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => writes.length).toBe(2);
  expect(events[0]!.start).toBe(afterMoveStart);
  expect(Date.parse(events[0]!.end) - Date.parse(events[0]!.start)).toBeGreaterThan(duration);
  expect(events[0]!.user_id).toBe("member");
  expect(errors).toEqual([]);
});

test("switching away from the timeline clears browsing and returning installs only one navigation gesture", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const { queries, writes, errors } = await mount(page);
  async function switchViewsThenPan() {
    await page.getByRole("button", { name: "人员分列", exact: true }).click();
    await expect(page.getByRole("button", { name: "框选排期", exact: true })).toHaveCount(0);
    const start = queries.at(-1)!.get("start");
    const grid = await page.locator(".lab-calendar").boundingBox();
    await page.mouse.move(grid!.x + grid!.width * 0.75, grid!.y + 80, { steps: 8 });
    expect(queries.at(-1)!.get("start")).toBe(start);
    await page.getByRole("button", { name: "人员时间轴", exact: true }).click();
    await expect(page.getByRole("button", { name: "框选排期", exact: true })).toHaveAttribute("aria-pressed", "false");
    const before = Date.parse(queries.at(-1)!.get("start")!);
    await dragBlankLane(page, -240);
    await expect.poll(() => Date.parse(queries.at(-1)!.get("start")!) - before).toBe(7 * 86400000);
  }
  await switchViewsThenPan();
  await switchViewsThenPan();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});
