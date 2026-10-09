/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { LabPlanner } from "../../../packages/types/src/index";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "22222222-2222-4222-8222-222222222222";
const memberId = "33333333-3333-4333-8333-333333333333";
const reviewerId = "44444444-4444-4444-8444-444444444444";
const independentId = "55555555-5555-4555-8555-555555555555";
const issueId = "66666666-6666-4666-8666-666666666666";
const otherIssueId = "77777777-7777-4777-8777-777777777777";
const planner: LabPlanner = {
  user_id: memberId,
  team_access: true,
  timezone: "Asia/Shanghai",
  week_start: 1,
  step_minutes: 15,
  items: [],
  folders: [],
  categories: [],
  projects: [
    {
      id: projectId,
      name: "声学实验",
      lead: true,
      members: [
        { id: memberId, name: "负责人" },
        { id: reviewerId, name: "验收人" },
        { id: independentId, name: "复核人" },
      ],
      states: [],
      mapping: { todo: null, active: null, review: null, done: null },
    },
    {
      id: otherProjectId,
      name: "水下实验",
      lead: true,
      members: [
        { id: memberId, name: "负责人" },
        { id: reviewerId, name: "验收人" },
        { id: independentId, name: "复核人" },
      ],
      states: [],
      mapping: { todo: null, active: null, review: null, done: null },
    },
  ],
};
let server: ReturnType<typeof createServer>;
let origin = "";
let directory = "";
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "lab-market-publish-"));
  const require = createRequire(resolve("apps/web/package.json"));
  const { build } = require("esbuild") as typeof import("esbuild");
  await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { MemoryRouter } from 'react-router'; import { LabStore } from '${resolve("packages/shared-state/src/lab.store.ts")}'; import { LabMarket } from '${resolve("apps/web/core/components/lab/market.tsx")}'; const store = new LabStore('', 'test'); store.planner = window.labPlanner; createRoot(document.getElementById('root')).render(<MemoryRouter><LabMarket store={store} /></MemoryRouter>);`,
      resolveDir: resolve("apps/web"),
      loader: "tsx",
      sourcefile: "lab-market-publish-harness.tsx",
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
  server = createServer(async (request, response) => {
    const file = request.url === "/app.js" ? "app.js" : request.url === "/app.css" ? "app.css" : null;
    response.setHeader(
      "Content-Type",
      file === "app.js" ? "text/javascript" : file === "app.css" ? "text/css" : "text/html"
    );
    response.end(
      file
        ? await readFile(join(directory, file))
        : '<!doctype html><html><head><link rel="stylesheet" href="/app.css"><style>body{font-family:sans-serif}button,input,select,textarea{margin:4px}[role=dialog]{background:white;border:1px solid #bbb;position:fixed;inset:5%;overflow:auto;padding:18px;z-index:100}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
    );
  });
  await new Promise<void>((resolveListening) => server.listen(0, "127.0.0.1", resolveListening));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  if (directory) await rm(directory, { recursive: true, force: true });
});
const budgets = [
  {
    project_id: projectId,
    project: "声学实验",
    stage_id: "stage-a",
    stage_name: "第一阶段",
    budget: "100.00",
    reserved: "20.00",
    available: "80.00",
    configured: true,
  },
  {
    project_id: otherProjectId,
    project: "水下实验",
    stage_id: "stage-b",
    stage_name: "第二阶段",
    budget: "60.00",
    reserved: "5.00",
    available: "55.00",
    configured: true,
  },
];
const tasks = [
  { id: issueId, title: "标注声学样本", project_id: projectId, project: "声学实验", key: "LAB-1" },
  { id: otherIssueId, title: "水下实验记录", project_id: otherProjectId, project: "水下实验", key: "SEA-1" },
];
async function mount(page: import("@playwright/test").Page, configure?: () => Promise<void>) {
  await page.addInitScript((value) => Object.assign(window, { labPlanner: value }), planner);
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/lab/**", (route) => route.fulfill({ json: [] }));
  await page.route("**/lab/planner/", (route) => route.fulfill({ json: planner }));
  await page.route("**/lab/bounties/budgets/", (route) => route.fulfill({ json: budgets }));
  await page.route("**/lab/tasks/**", (route) => {
    const request = new URL(route.request().url());
    return route.fulfill({ json: tasks.filter((task) => task.project_id === request.searchParams.get("project_id")) });
  });
  if (configure) await configure();
  await page.goto(origin);
}

async function openPublication(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "发布悬赏", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "发布悬赏", exact: true });
  await expect(dialog.getByLabel("项目", { exact: true })).toHaveValue(projectId);
  await expect(dialog.getByLabel("工作项", { exact: true })).toBeEnabled();
  return dialog;
}

function deferred() {
  let complete: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    complete = resolvePromise;
  });
  return { promise, complete: () => complete() };
}

test("bounty hall exposes a single publication entry without separate frozen B or WIP controls", async ({ page }) => {
  await mount(page);
  await expect(page.getByRole("button", { name: "冻结阶段预算 B", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "批准 WIP 例外", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发布悬赏", exact: true })).toHaveCount(1);
  await expect(page.getByText("导出项目 VC CSV", { exact: true })).toHaveCount(0);
});

test("publication loads project work items without searching and sends a single set of materials against the project budget", async ({
  page,
}) => {
  const errors: string[] = [];
  const taskRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().includes("/lab/tasks/")) taskRequests.push(request.url());
  });
  await mount(page);
  const dialog = await openPublication(page);
  await expect(dialog.getByLabel("项目 VC 预算")).toHaveText("VC预算 100.00 · 已占用 20.00 · 剩余 80.00");
  await dialog.getByLabel("工作项", { exact: true }).selectOption(issueId);
  await dialog.getByLabel("VC配额", { exact: true }).fill("10");
  await expect(dialog.getByLabel("复核人", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("现金承诺（元）", { exact: true })).toBeHidden();
  await expect(dialog.locator("textarea")).toHaveCount(3);
  await dialog.getByLabel("任务资料", { exact: true }).fill("声学样本与处理说明");
  await dialog.getByLabel("交付要求", { exact: true }).fill("完成样本标注表");
  await dialog.getByLabel("验收标准", { exact: true }).fill("抽样复核全部通过");
  await dialog.getByLabel("验收人", { exact: true }).selectOption(reviewerId);
  const publication = page.waitForRequest(
    (request) => request.method() === "POST" && request.url().endsWith("/lab/bounties/")
  );
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  expect((await publication).postDataJSON()).toEqual({
    project_id: projectId,
    issue_id: issueId,
    budget: "10",
    public_summary: "声学样本与处理说明",
    deliverable: "完成样本标注表",
    public_deliverable: "完成样本标注表",
    criteria: "抽样复核全部通过",
    public_criteria: "抽样复核全部通过",
    reviewer_id: reviewerId,
    independent_reviewer_id: null,
    cash_commitment: 0,
    person_days: 0,
    route_or_safety: false,
  });
  await expect(dialog).toHaveCount(0);
  expect(taskRequests.length).toBeGreaterThan(0);
  const request = new URL(taskRequests[0]!);
  expect(request.searchParams.get("project_id")).toBe(projectId);
  expect(request.searchParams.get("publishable")).toBe("1");
  expect(request.searchParams.get("q")).toBe("");
  expect(errors).toEqual([]);
});

test("major review appears only at a threshold and advanced settings remain collapsed", async ({ page }) => {
  await mount(page);
  const dialog = await openPublication(page);
  await dialog.getByLabel("VC配额", { exact: true }).fill("20");
  await expect(dialog.getByLabel("复核人", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("VC配额", { exact: true }).fill("20.01");
  await expect(dialog.getByLabel("复核人", { exact: true })).toBeVisible();
  await dialog.getByLabel("验收人", { exact: true }).selectOption(reviewerId);
  await expect(dialog.getByLabel("复核人", { exact: true }).locator("option")).toHaveText(["请选择", "复核人"]);
  await dialog.getByLabel("VC配额", { exact: true }).fill("10");
  await expect(dialog.getByLabel("复核人", { exact: true })).toHaveCount(0);
  await dialog.getByText("更多设置", { exact: true }).click();
  await dialog.getByLabel("现金承诺（元）", { exact: true }).fill("5000");
  await expect(dialog.getByLabel("复核人", { exact: true })).toBeVisible();
  await dialog.getByLabel("现金承诺（元）", { exact: true }).fill("0");
  await dialog.getByLabel("预计人日", { exact: true }).fill("10");
  await expect(dialog.getByLabel("复核人", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("预计人日", { exact: true }).fill("10.01");
  await expect(dialog.getByLabel("复核人", { exact: true })).toBeVisible();
  await dialog.getByLabel("预计人日", { exact: true }).fill("0");
  await dialog.getByLabel("重大路线或安全事项", { exact: true }).check();
  await expect(dialog.getByLabel("复核人", { exact: true })).toBeVisible();
});

test("changing projects clears the old work item and a late task response cannot overwrite the current project", async ({
  page,
}) => {
  const held = deferred();
  const requested = deferred();
  const responseFinished = deferred();
  await mount(page, async () => {
    await page.route("**/lab/tasks/**", async (route) => {
      const request = new URL(route.request().url());
      if (request.searchParams.get("project_id") === projectId) {
        requested.complete();
        await held.promise;
      }
      await route.fulfill({ json: tasks.filter((task) => task.project_id === request.searchParams.get("project_id")) });
      if (request.searchParams.get("project_id") === projectId) responseFinished.complete();
    });
  });
  await page.getByRole("button", { name: "发布悬赏", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "发布悬赏", exact: true });
  await requested.promise;
  await dialog.getByLabel("项目", { exact: true }).selectOption(otherProjectId);
  await expect(dialog.getByLabel("工作项", { exact: true })).toBeEnabled();
  await dialog.getByLabel("工作项", { exact: true }).selectOption(otherIssueId);
  await expect(dialog.getByLabel("项目 VC 预算")).toHaveText("VC预算 60.00 · 已占用 5.00 · 剩余 55.00");
  held.complete();
  await responseFinished.promise;
  await page.evaluate(
    () => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())))
  );
  await expect(dialog.getByLabel("工作项", { exact: true }).locator("option")).toHaveText([
    "请选择工作项",
    "SEA-1 · 水下实验记录",
  ]);
  await expect(dialog.getByLabel("工作项", { exact: true })).toHaveValue(otherIssueId);
  await dialog.getByLabel("项目", { exact: true }).selectOption(projectId);
  await expect(dialog.getByLabel("工作项", { exact: true })).toHaveValue("");
});

test("a project without a budget shows the finance entry and cannot publish", async ({ page }) => {
  let publications = 0;
  await mount(page, async () => {
    await page.route("**/lab/bounties/budgets/", (route) =>
      route.fulfill({
        json: [
          {
            ...budgets[0],
            stage_id: null,
            stage_name: null,
            budget: null,
            reserved: null,
            available: null,
            configured: false,
          },
        ],
      })
    );
    await page.route("**/lab/bounties/", (route) => {
      if (route.request().method() === "POST") publications++;
      return route.fulfill({ json: [] });
    });
  });
  const dialog = await openPublication(page);
  await expect(dialog.getByText("项目尚未配置 VC 预算", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "资金与奖励", exact: true })).toHaveAttribute(
    "href",
    `/test/lab/finance?project_id=${projectId}`
  );
  await dialog.getByLabel("工作项", { exact: true }).selectOption(issueId);
  await dialog.getByLabel("VC配额", { exact: true }).fill("10");
  await dialog.getByLabel("任务资料", { exact: true }).fill("说明");
  await dialog.getByLabel("交付要求", { exact: true }).fill("交付");
  await dialog.getByLabel("验收标准", { exact: true }).fill("标准");
  await dialog.getByLabel("验收人", { exact: true }).selectOption(reviewerId);
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("项目尚未配置 VC 预算");
  expect(publications).toBe(0);
});

test("a rejected publication refreshes remaining VC and preserves materials for a corrected retry", async ({
  page,
}) => {
  let attempts = 0;
  await mount(page, async () => {
    await page.route("**/lab/bounties/budgets/", (route) =>
      route.fulfill({ json: attempts ? [{ ...budgets[0], reserved: "95.00", available: "5.00" }] : budgets })
    );
    await page.route("**/lab/bounties/", (route) => {
      if (route.request().method() !== "POST") return route.fulfill({ json: [] });
      attempts++;
      return attempts === 1
        ? route.fulfill({ status: 400, json: { detail: "项目剩余 VC 预算不足" } })
        : route.fulfill({ json: {} });
    });
  });
  const dialog = await openPublication(page);
  await dialog.getByLabel("工作项", { exact: true }).selectOption(issueId);
  await dialog.getByLabel("VC配额", { exact: true }).fill("10");
  await dialog.getByLabel("任务资料", { exact: true }).fill("声学样本说明");
  await dialog.getByLabel("交付要求", { exact: true }).fill("完成标注表");
  await dialog.getByLabel("验收标准", { exact: true }).fill("复核通过");
  await dialog.getByLabel("验收人", { exact: true }).selectOption(reviewerId);
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("项目剩余 VC 预算不足");
  await expect(dialog.getByLabel("项目 VC 预算")).toHaveText("VC预算 100.00 · 已占用 95.00 · 剩余 5.00");
  await expect(dialog.getByLabel("VC配额", { exact: true })).toHaveAttribute("max", "5.00");
  await expect(dialog.getByLabel("任务资料", { exact: true })).toHaveValue("声学样本说明");
  await expect(dialog.getByLabel("交付要求", { exact: true })).toHaveValue("完成标注表");
  await expect(dialog.getByLabel("验收标准", { exact: true })).toHaveValue("复核通过");
  await dialog.getByLabel("VC配额", { exact: true }).fill("4");
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toBe(2);
});
