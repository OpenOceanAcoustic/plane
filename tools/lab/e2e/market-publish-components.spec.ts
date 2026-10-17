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
  await page.route("**/lab/bounties/*/quotes/", (route) =>
    route.fulfill({
      json: {
        quotes: [],
        can_apply: true,
        available: "5.00",
        reviewers: [],
        file_size_limit: 5242880,
      },
    })
  );
  await page.route("**/lab/bounties/*/materials/**", (route) => route.fulfill({ json: { materials: [] } }));
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

const wallet = (project = "6.00", earned = "4.00") => ({
  project_available: project,
  earned_available: earned,
  earned_debt: "0.00",
  available: (Number(project) + Number(earned)).toFixed(2),
  project_granted: project,
  earned_total: earned,
  project_committed: "0.00",
  earned_committed: "0.00",
});

test("ordinary project member publishes using a combination of personal quota and earned VC", async ({ page }) => {
  let publication: Record<string, unknown> | undefined;
  const ordinaryPlanner = {
    ...planner,
    projects: planner.projects.map((row) => Object.assign({}, row, { lead: false })),
  };
  await mount(page, async () => {
    await page.addInitScript((value) => Object.assign(window, { labPlanner: value }), ordinaryPlanner);
    await page.route("**/lab/planner/", (route) => route.fulfill({ json: ordinaryPlanner }));
    await page.route("**/lab/bounties/budgets/", (route) =>
      route.fulfill({ json: [{ ...budgets[0], wallet: wallet(), can_allocate: false }] })
    );
    await page.route("**/lab/bounties/", (route) => {
      if (route.request().method() === "POST") publication = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: route.request().method() === "POST" ? { id: "new-bounty" } : [] });
    });
  });
  const dialog = await openPublication(page);
  await expect(dialog.getByLabel("我的可用 VC")).toContainText("项目分配可用 VC6.00");
  await dialog.getByLabel("工作项", { exact: true }).selectOption(issueId);
  await dialog.getByLabel("VC配额", { exact: true }).fill("10");
  await expect(dialog.getByLabel("项目额度支付 VC", { exact: true })).toHaveValue("6.00");
  await expect(dialog.getByLabel("悬赏收入支付 VC", { exact: true })).toHaveText("4.00");
  await dialog.getByLabel("任务资料", { exact: true }).fill("声学资料");
  await dialog.getByLabel("交付要求", { exact: true }).fill("分析报告");
  await dialog.getByLabel("验收标准", { exact: true }).fill("结果可复现");
  await dialog.getByLabel("验收人", { exact: true }).selectOption(reviewerId);
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(publication).toMatchObject({ project_id: projectId, budget: "10", project_vc: "6.00", earned_vc: "4.00" });
  expect(publication?.request_key).toMatch(/^[0-9a-f-]{36}$/);
});

test("publication validates each VC source as well as the combined personal balance", async ({ page }) => {
  await mount(page, async () => {
    await page.route("**/lab/bounties/budgets/", (route) =>
      route.fulfill({ json: [{ ...budgets[0], wallet: wallet(), can_allocate: false }] })
    );
  });
  const dialog = await openPublication(page);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("工作项", { exact: true }).selectOption(issueId);
  await dialog.getByLabel("VC配额", { exact: true }).fill("10");
  await dialog.getByLabel("项目额度支付 VC", { exact: true }).fill("3");
  await expect(dialog.getByLabel("悬赏收入支付 VC", { exact: true })).toHaveText("7.00");
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
  await dialog.getByLabel("项目额度支付 VC", { exact: true }).fill("");
  await expect(dialog.getByLabel("项目额度支付 VC", { exact: true })).toHaveValue("");
  await dialog.getByLabel("项目额度支付 VC", { exact: true }).fill("6");
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeEnabled();
  await dialog.getByLabel("VC配额", { exact: true }).fill("11");
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
});

test("member sees own balances without requesting administrator quota data", async ({ page }) => {
  let quotaReads = 0;
  await mount(page, async () => {
    await page.route("**/lab/bounties/budgets/", (route) =>
      route.fulfill({ json: [{ ...budgets[0], wallet: wallet(), can_allocate: false }] })
    );
    await page.route("**/lab/bounties/quotas/**", (route) => {
      quotaReads++;
      return route.fulfill({ status: 403, json: {} });
    });
  });
  await page.getByRole("button", { name: "我的 VC", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "我的 VC", exact: true });
  await expect(dialog.getByLabel("我的 VC 余额")).toContainText("合计可用 VC10.00");
  await expect(dialog.getByRole("button", { name: "分配额度", exact: true })).toHaveCount(0);
  expect(quotaReads).toBe(0);
});

test("administrator allocates project quota and refreshes member and project balances", async ({ page }) => {
  let assigned = false;
  let request: Record<string, unknown> | undefined;
  await mount(page, async () => {
    await page.route("**/lab/bounties/budgets/", (route) =>
      route.fulfill({
        json: [
          {
            ...budgets[0],
            available: assigned ? "75.00" : "80.00",
            wallet: wallet("0.00", "0.00"),
            can_allocate: true,
          },
        ],
      })
    );
    await page.route(`**/lab/bounties/quotas/${projectId}/`, (route) => {
      if (route.request().method() === "POST") {
        request = route.request().postDataJSON() as Record<string, unknown>;
        assigned = true;
        return route.fulfill({ status: 201, json: { id: "grant-record" } });
      }
      return route.fulfill({
        json: {
          members: [{ id: reviewerId, name: "验收人", wallet: wallet(assigned ? "5.00" : "0.00", "0.00") }],
          history: [],
        },
      });
    });
  });
  await page.getByRole("button", { name: "我的 VC", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "我的 VC", exact: true });
  await dialog.getByLabel("成员", { exact: true }).selectOption(reviewerId);
  await dialog.getByLabel("额度 VC", { exact: true }).fill("5");
  await dialog.getByLabel("原因", { exact: true }).fill("数据处理任务额度");
  await dialog.getByRole("button", { name: "分配额度", exact: true }).click();
  await expect(dialog.getByText("额度已分配", { exact: true })).toBeVisible();
  await expect(dialog.getByText("项目未分配 VC：75.00", { exact: true })).toBeVisible();
  await expect(dialog.getByText("成员项目额度余额：5.00 VC", { exact: true })).toBeVisible();
  expect(request).toMatchObject({
    user_id: reviewerId,
    stage_id: "stage-a",
    amount: "5",
    kind: "grant",
    reason: "数据处理任务额度",
  });
});

test("bounty hall exposes a single publication entry without separate frozen B or WIP controls", async ({ page }) => {
  await mount(page);
  await expect(page.getByRole("button", { name: "冻结阶段预算 B", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "批准 WIP 例外", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "发布悬赏", exact: true })).toHaveCount(1);
  await expect(page.getByText("导出项目 VC CSV", { exact: true })).toHaveCount(0);
});

test("deleted funding sources cannot be selected or used to publish a bounty", async ({ page }) => {
  let publications = 0;
  await mount(page, async () => {
    await page.route("**/lab/bounties/budgets/", (route) =>
      route.fulfill({
        json: budgets.map((budget) => Object.assign({}, budget, { deleted: true, project_deleted: true })),
      })
    );
    await page.route("**/lab/bounties/", (route) => {
      if (route.request().method() === "POST") ++publications;
      return route.fulfill({ json: [] });
    });
  });
  await page.getByRole("button", { name: "发布悬赏", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "发布悬赏", exact: true });
  await expect(dialog.getByText("项目尚未配置 VC 预算", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("项目", { exact: true }).locator("option")).toHaveText(["请选择项目"]);
  await expect(dialog.getByLabel("项目", { exact: true })).toHaveValue("");
  await dialog.getByLabel("VC配额", { exact: true }).fill("10");
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
  expect(publications).toBe(0);
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
    request_key: expect.any(String),
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
  await expect(dialog.getByLabel("复核人", { exact: true }).locator("option")).toHaveText([
    "请选择",
    "负责人",
    "验收人",
    "复核人",
  ]);
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

test("VC quota warns while typing and updates when switching project budgets", async ({ page }) => {
  let publications = 0;
  await mount(page, async () => {
    await page.route("**/lab/bounties/", (route) => {
      if (route.request().method() === "POST") publications++;
      return route.fulfill({ json: [] });
    });
  });
  const dialog = await openPublication(page);
  const quota = dialog.getByLabel("VC配额", { exact: true });
  await quota.fill("80.01");
  await expect(quota).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toContainText("80");
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
  expect(publications).toBe(0);
  await dialog.getByLabel("工作项", { exact: true }).selectOption(issueId);
  await dialog.getByLabel("任务资料", { exact: true }).fill("任务资料");
  await dialog.getByLabel("交付要求", { exact: true }).fill("交付要求");
  await dialog.getByLabel("验收标准", { exact: true }).fill("验收标准");
  await dialog.getByLabel("验收人", { exact: true }).selectOption(reviewerId);
  await dialog.getByLabel("复核人", { exact: true }).selectOption(independentId);
  await quota.fill("80.00");
  await expect(quota).not.toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeEnabled();
  await dialog.getByLabel("项目", { exact: true }).selectOption(otherProjectId);
  await expect(dialog.getByRole("alert")).toContainText("55");
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
  await quota.fill("55");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(publications).toBe(0);
});

test("publisher can also be both reviewers on a major bounty", async ({ page }) => {
  let body: Record<string, unknown> | undefined;
  await mount(page, async () => {
    await page.route("**/lab/bounties/", (route) => {
      if (route.request().method() !== "POST") return route.fulfill({ json: [] });
      body = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: {} });
    });
  });
  const dialog = await openPublication(page);
  await dialog.getByLabel("工作项", { exact: true }).selectOption(issueId);
  await dialog.getByLabel("VC配额", { exact: true }).fill("40");
  await dialog.getByLabel("任务资料", { exact: true }).fill("资料");
  await dialog.getByLabel("交付要求", { exact: true }).fill("交付");
  await dialog.getByLabel("验收标准", { exact: true }).fill("标准");
  await expect(dialog.getByLabel("验收人", { exact: true }).locator("option")).toHaveText([
    "请选择",
    "负责人",
    "验收人",
    "复核人",
  ]);
  await dialog.getByLabel("验收人", { exact: true }).selectOption(memberId);
  await dialog.getByLabel("复核人", { exact: true }).selectOption(memberId);
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(body?.reviewer_id).toBe(memberId);
  expect(body?.independent_reviewer_id).toBe(memberId);
});

test("major review threshold compares exact decimal VC at twenty percent", async ({ page }) => {
  await mount(page, async () => {
    await page.route("**/lab/bounties/budgets/", (route) =>
      route.fulfill({ json: [{ ...budgets[0], budget: "0.35", reserved: "0.00", available: "0.35" }] })
    );
  });
  const dialog = await openPublication(page);
  await dialog.getByLabel("VC配额", { exact: true }).fill("0.07");
  await expect(dialog.getByLabel("复核人", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("VC配额", { exact: true }).fill("0.08");
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
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
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
  await expect(dialog.getByRole("alert").filter({ hasText: "项目剩余 VC 预算不足" })).toBeVisible();
  await expect(dialog.getByLabel("项目 VC 预算")).toHaveText("VC预算 100.00 · 已占用 95.00 · 剩余 5.00");
  await expect(dialog.getByLabel("VC配额", { exact: true })).toHaveAttribute("max", "5.00");
  await expect(dialog.getByLabel("VC配额", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("任务资料", { exact: true })).toHaveValue("声学样本说明");
  await expect(dialog.getByLabel("交付要求", { exact: true })).toHaveValue("完成标注表");
  await expect(dialog.getByLabel("验收标准", { exact: true })).toHaveValue("复核通过");
  await dialog.getByLabel("VC配额", { exact: true }).fill("4");
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toBe(2);
});

const bountyRecord = {
  id: "bounty-a",
  stage_id: "stage-a",
  project_id: projectId,
  project: "声学实验",
  issue_id: issueId,
  issue_key: "LAB-1",
  title: "标注声学样本",
  deliverable: "标注表",
  criteria: "复核全部通过",
  budget: "20.00",
  claim_available: "5.00",
  reserved: "20.00",
  awarded: "3.00",
  status: "open",
  major: false,
  major_reasons: [],
  evidence: "",
  due_at: null,
  overdue: false,
  is_lead: false,
  is_reviewer: false,
  is_independent_reviewer: false,
  allocations: [],
  acceptances: [],
};

test("hall opens the shared fixed-price application and negotiation forms", async ({ page }) => {
  await mount(page, async () => {
    await page.route("**/lab/bounties/", (route) => route.fulfill({ json: [bountyRecord] }));
    await page.route("**/lab/bounties/bounty-a/detail/", (route) => route.fulfill({ json: bountyRecord }));
  });
  await page.getByRole("button", { name: "查看悬赏 标注声学样本", exact: true }).click();
  await page.getByRole("button", { name: "按原价申请 · 5.00 VC", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "按原价申请", exact: true });
  await expect(dialog.getByLabel("原价（VC）")).toHaveValue("5.00");
  await expect(dialog.getByLabel("原价（VC）")).toHaveAttribute("readonly", "");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "议价申请", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "议价申请", exact: true });
  await dialog.getByLabel("本人交付内容").fill("分工报告");
  await dialog.getByLabel("报价（VC）").fill("8");
  await expect(dialog.getByRole("button", { name: "提交申请" })).toBeDisabled();
  await dialog.getByLabel("报价依据").fill("新增分析内容");
  await expect(dialog.getByRole("button", { name: "提交申请" })).toBeEnabled();
});

test("acceptance cumulative VC warns above plan and below previously awarded contribution", async ({ page }) => {
  const reviewing = {
    ...bountyRecord,
    status: "review",
    is_reviewer: true,
    allocations: [
      {
        id: "allocation-a",
        user_id: reviewerId,
        name: "成员",
        deliverable: "标注表",
        planned: "10.00",
        awarded: "3.00",
        approved: true,
        confirmed: true,
        closed: false,
      },
    ],
  };
  await mount(page, async () => {
    await page.route("**/lab/bounties/", (route) => route.fulfill({ json: [reviewing] }));
    await page.route("**/lab/bounties/bounty-a/detail/", (route) => route.fulfill({ json: reviewing }));
  });
  await page.getByRole("button", { name: "全部悬赏", exact: true }).click();
  await page.getByRole("button", { name: "查看悬赏 标注声学样本", exact: true }).click();
  await page.getByRole("button", { name: "独立验收", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "独立验收与累计贡献", exact: true });
  const cumulative = dialog.getByLabel("成员 累计通过 VC（已授予 3.00 / 计划 10.00）", { exact: true });
  await expect(cumulative).toHaveValue("10.00");
  await cumulative.fill("10.01");
  await expect(cumulative).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toContainText("10.00 VC");
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await cumulative.fill("2.99");
  await expect(dialog.getByRole("alert")).toContainText("3.00 VC");
  await cumulative.fill("3.00");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
});
