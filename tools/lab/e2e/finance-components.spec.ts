/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { networkInterfaces, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { LabBounty, LabFinanceOverview, LabPlanner } from "../../../packages/types/src/index";

const projectId = "11111111-1111-4111-8111-111111111111";
const stageId = "22222222-2222-4222-8222-222222222222";
const bountyId = "33333333-3333-4333-8333-333333333333";
const memberId = "44444444-4444-4444-8444-444444444444";
const formula = {
  id: "formula",
  project_id: projectId,
  version: 2,
  task_expression: "E * 0.2 * VC / B",
  member_expression: "E * VC / B",
  parameters: [],
  reason: "项目公式",
  actor: "负责人",
  created_at: "2026-10-09T08:00:00Z",
};
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
      members: [{ id: memberId, name: "成员甲" }],
      states: [],
      mapping: { todo: null, active: null, review: null, done: null },
    },
  ],
};
const bounty: LabBounty = {
  id: bountyId,
  stage_id: stageId,
  project_id: projectId,
  project: "声学实验",
  issue_id: "issue",
  issue_key: "LAB-1",
  title: "标注声学样本",
  public_summary: "公开摘要",
  deliverable: "标注表",
  criteria: "独立复核",
  budget: "100",
  reserved: "0",
  awarded: "0",
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
  access_level: "public",
  can_claim: true,
  can_manage_materials: false,
  category_color: "#f97316",
  reward_estimate: { amount: "1400.00", formula_version: 2 },
};
function overview(): LabFinanceOverview {
  return {
    manager_id: memberId,
    is_manager: true,
    projects: [{ id: projectId, name: "声学实验", is_lead: true }],
    members: [{ id: memberId, name: "成员甲" }],
    accounts: [
      {
        id: "execution",
        project_id: projectId,
        stage_id: stageId,
        kind: "execution",
        label: "成员执行奖励",
        balance: "70000.00",
        committed: "0.00",
        available: "70000.00",
        can_manage: true,
      },
    ],
    public_summary: [
      { kind: "risk", label: "公共池汇总", balance: "5000.00", committed: "0.00", available: "5000.00" },
    ],
    stages: [
      {
        id: "budget",
        stage_id: stageId,
        project_id: projectId,
        name: "第一阶段",
        B: "1000",
        E: "70000.00",
        purposes: [{ name: "样本处理", amount: "70000.00" }],
        members: [{ user_id: memberId, b: "0.1", r: "0.1", planned_vc: "100" }],
        upgraded: false,
        history: [],
        execution_funded: "70000.00",
        history_funded: "0.00",
        formula_version: 2,
        can_manage: true,
      },
    ],
    formulas: [formula],
    forecasts: [
      {
        id: "forecast",
        stage_id: stageId,
        kind: "member",
        basis: "budget",
        bounty_id: null,
        user_id: memberId,
        formula_id: "formula",
        formula_version: 2,
        expression: formula.member_expression,
        inputs: { E: "70000", B: "1000", VC: "20" },
        result: "1400.00",
        created_at: "2026-10-09T08:00:00Z",
      },
    ],
    batches: [],
    settlements: [],
    commitments: [],
    payments: [],
    operations: [],
    entries: [],
  };
}
let server: ReturnType<typeof createServer>;
let origin = "";
let httpOrigin = "";
let directory = "";
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "lab-finance-browser-"));
  const require = createRequire(resolve("apps/web/package.json"));
  const { build } = require("esbuild") as typeof import("esbuild");
  const source = `import React from 'react'; import { createRoot } from 'react-dom/client'; import { MemoryRouter } from 'react-router'; import { observer } from 'mobx-react'; import { LabStore } from '${resolve("packages/shared-state/src/lab.store.ts")}'; import { LabFinance } from '${resolve("apps/web/core/components/lab/finance.tsx")}'; import { LabMarket } from '${resolve("apps/web/core/components/lab/market.tsx")}'; import { LabPlannerBoard } from '${resolve("apps/web/core/components/lab/planner.tsx")}'; import { LabLedger } from '${resolve("apps/web/core/components/lab/ledger.tsx")}'; import { LabBountyWorkflow } from '${resolve("apps/web/core/components/lab/workflow.tsx")}'; const config = window.labConfig; const store = new LabStore('', 'test'); store.planner = config.planner; store.bounties = config.bounties; const Count = observer(() => <output aria-label="规划事项数量">{store.planner?.items.length}</output>); const view = config.view; createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={[config.route || '/test/lab/bounties']}><Count />{view === 'market' ? <LabMarket store={store} /> : view === 'planner' ? <LabPlannerBoard store={store} schedule={() => {}} /> : view === 'ledger' ? <LabLedger store={store} projectId="" /> : view === 'workflow' ? <LabBountyWorkflow store={store} bounty={config.bounties[0]} /> : <LabFinance store={store} />}</MemoryRouter>);`;
  await build({
    stdin: {
      contents: source,
      resolveDir: resolve("apps/web"),
      loader: "tsx",
      sourcefile: "lab-finance-component-harness.tsx",
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
    if (file) {
      response.end(await readFile(join(directory, file)));
    } else {
      response.end(
        '<!doctype html><html><head><link rel="stylesheet" href="/app.css"><style>body{font-family:sans-serif}button,input,select,textarea{margin:4px} [role=dialog]{background:white;border:1px solid #bbb;position:fixed;inset:8%;overflow:auto;padding:18px;z-index:100} table{border-collapse:collapse}td,th{padding:8px;border:1px solid #ddd}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
      );
    }
  });
  await new Promise<void>((resolveListening) => server.listen(0, "0.0.0.0", resolveListening));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const httpHost =
    process.env.LAB_BROWSER_HTTP_HOST ??
    Object.values(networkInterfaces())
      .flat()
      .find((address) => address && address.family === "IPv4" && !address.internal)?.address;
  if (!httpHost) throw new Error("An ordinary HTTP host is required for the finance browser regression tests");
  httpOrigin = `http://${httpHost}:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function mount(
  page: import("@playwright/test").Page,
  view: string,
  route = "/test/lab/bounties",
  customPlanner = planner,
  targetOrigin = origin,
  customBounties: LabBounty[] = [bounty]
) {
  await page.addInitScript(
    (config) => {
      Object.assign(window, { labConfig: config });
    },
    { planner: customPlanner, view, route, bounties: customBounties }
  );
  page.on("pageerror", (error) => {
    console.error("component browser error:", error.message);
  });
  await page.goto(targetOrigin);
}
async function common(page: import("@playwright/test").Page, bounties: LabBounty[] = [bounty]) {
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/lab/planner/", (route) => route.fulfill({ json: planner }));
  await page.route("**/lab/stages/", (route) =>
    route.fulfill({
      json: [
        {
          id: stageId,
          project_id: projectId,
          project: "声学实验",
          name: "第一阶段",
          budget: "1000",
          reserved: "100",
          frozen_at: "2026-10-09T08:00:00Z",
        },
      ],
    })
  );
  await page.route("**/lab/bounties/budgets/", (route) =>
    route.fulfill({
      json: [
        {
          project_id: projectId,
          project: "声学实验",
          stage_id: stageId,
          stage_name: "第一阶段",
          budget: "1000.00",
          reserved: "100.00",
          available: "900.00",
          configured: true,
        },
      ],
    })
  );
  await page.route("**/lab/bounties/", (route) => route.fulfill({ json: bounties }));
  await page.route("**/lab/inbox/", (route) => route.fulfill({ json: [] }));
  await page.route("**/lab/bounties/*/detail/", (route) =>
    route.fulfill({ json: bounties.find((row) => route.request().url().includes(row.id)) ?? bounty })
  );
}

test("bounty hall keeps publication without separate frozen budget or WIP administration", async ({ page }) => {
  await common(page);
  await mount(page, "market", "/test/lab/bounties", planner, httpOrigin);
  await expect(page.getByRole("button", { name: /发布.*悬赏/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "冻结阶段预算 B", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "批准 WIP 例外", exact: true })).toHaveCount(0);
  await expect(page.getByText("B", { exact: true })).toHaveCount(0);
  await expect(page.getByText("团队 T", { exact: false })).toHaveCount(0);
});

test("finance configures new project VC budget without rewriting previous yuan stages or forecasts", async ({
  page,
}) => {
  await common(page);
  const data = overview();
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: data }));
  const budget = {
    project_id: projectId,
    project: "声学实验",
    stage_id: stageId,
    stage_name: "第一阶段",
    budget: "1000.00",
    reserved: "100.00",
    available: "900.00",
    configured: true,
  };
  await page.route("**/lab/bounties/budgets/", (route) => route.fulfill({ json: [budget] }));
  let submitted: Record<string, unknown> | undefined;
  const originalForecasts = structuredClone(data.forecasts);
  const originalStages = structuredClone(data.stages);
  await page.route("**/lab/stages/", (route) => {
    if (route.request().method() === "POST") {
      submitted = route.request().postDataJSON() as Record<string, unknown>;
      Object.assign(budget, {
        stage_id: "55555555-5555-4555-8555-555555555555",
        stage_name: "新执行预算",
        budget: "25.00",
        reserved: "0.00",
        available: "25.00",
      });
      return route.fulfill({ status: 201, json: { id: budget.stage_id } });
    }
    return route.fulfill({
      json: [
        {
          id: stageId,
          project_id: projectId,
          project: "声学实验",
          name: "第一阶段",
          budget: "1000.00",
          reserved: "100.00",
          frozen_at: "2026-10-09T08:00:00Z",
        },
        ...(submitted
          ? [
              {
                id: budget.stage_id,
                project_id: projectId,
                project: "声学实验",
                name: budget.stage_name,
                budget: budget.budget,
                reserved: budget.reserved,
                frozen_at: "2026-10-09T10:00:00Z",
              },
            ]
          : []),
      ],
    });
  });
  await mount(page, "finance", `/test/lab/finance?project_id=${projectId}`, planner, httpOrigin);
  const current = page.getByRole("region", { name: "项目 VC 预算", exact: true });
  await expect(current).toContainText("1000.00");
  await expect(current).toContainText("100.00");
  await expect(current).toContainText("900.00");
  await page.getByRole("button", { name: "设置 VC 预算", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "设置项目 VC 预算", exact: true });
  await expect(dialog.getByLabel("负责项目", { exact: true })).toHaveValue(projectId);
  await expect(dialog.getByLabel("预算名称", { exact: true })).toHaveValue("当前预算");
  await dialog.getByLabel("预算名称", { exact: true }).fill("新执行预算");
  await dialog.getByLabel("VC 预算", { exact: true }).fill("25");
  await dialog.getByLabel("操作／核准依据", { exact: true }).fill("本轮执行预算批准");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted).toMatchObject({ project_id: projectId, name: "新执行预算", budget: "25" });
  await expect(current).toContainText("新执行预算");
  await expect(current).toContainText("25.00");
  expect(data.forecasts).toEqual(originalForecasts);
  expect(data.stages).toEqual(originalStages);
});

test("finance VC ledger keeps project-scoped exports and clears previous records when changing project", async ({
  page,
}) => {
  await common(page);
  const otherProjectId = "66666666-6666-4666-8666-666666666666";
  const data = overview();
  data.projects.push({ id: otherProjectId, name: "其他项目", is_lead: true });
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: data }));
  const budget = {
    project_id: projectId,
    project: "声学实验",
    stage_id: stageId,
    stage_name: "第一阶段",
    budget: "1000.00",
    reserved: "100.00",
    available: "900.00",
    configured: true,
  };
  await page.route("**/lab/bounties/budgets/", (route) => route.fulfill({ json: [budget] }));
  let corrected = false;
  const queried: string[] = [];
  await page.route("**/lab/ledger/**", (route) => {
    const project = new URL(route.request().url()).searchParams.get("project_id") ?? "";
    queried.push(project);
    return route.fulfill({
      json: [
        {
          id: `${project}-entry`,
          delta: "20.00",
          task: { title: project === projectId ? "原项目已授予贡献" : "另一项目已授予贡献", project: project },
          participant: { id: memberId, name: "成员甲" },
          actor: "独立验收人",
          reason: "成果已验收",
          can_reverse: project === projectId && !corrected,
        },
        ...(project === projectId && corrected
          ? [
              {
                id: "append-only-correction",
                delta: "-20.00",
                task: { title: "原项目贡献追加更正", project },
                participant: { id: memberId, name: "成员甲" },
                actor: "项目负责人",
                reason: "复验后更正贡献",
                reverses: `${projectId}-entry`,
                can_reverse: false,
              },
            ]
          : []),
      ],
    });
  });
  await page.route(`**/lab/ledger/${projectId}-entry/reverse/`, (route) => {
    const body = route.request().postDataJSON() as { reason: string; request_key: string };
    expect(body.reason).toBe("复验后更正贡献");
    expect(body.request_key).toMatch(/^[0-9a-f-]{36}$/);
    corrected = true;
    budget.reserved = "80.00";
    budget.available = "920.00";
    return route.fulfill({ json: { ok: true } });
  });
  await mount(page, "finance", `/test/lab/finance?project_id=${projectId}`);
  await page.getByRole("button", { name: "VC 明细", exact: true }).click();
  await expect(page.getByRole("link", { name: "导出项目 VC CSV", exact: true })).toHaveAttribute(
    "href",
    `/api/workspaces/test/lab/ledger/?format=csv&project_id=${projectId}`
  );
  await expect(page.getByRole("link", { name: "查看 VC JSON 与冲正记录", exact: true })).toHaveAttribute(
    "href",
    `/api/workspaces/test/lab/ledger/?project_id=${projectId}`
  );
  await page.getByRole("button", { name: "读取账本", exact: true }).click();
  await expect(page.getByRole("cell", { name: /原项目已授予贡献/ })).toBeVisible();
  await page.getByRole("button", { name: "冲正", exact: true }).click();
  const correction = page.getByRole("dialog", { name: "贡献冲正", exact: true });
  await correction.getByLabel("更正原因", { exact: true }).fill("复验后更正贡献");
  await correction.getByRole("button", { name: "保存", exact: true }).click();
  await expect(correction).toHaveCount(0);
  await expect(page.getByRole("cell", { name: /原项目已授予贡献/ })).toBeVisible();
  await expect(page.getByRole("cell", { name: /原项目贡献追加更正/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "项目 VC 预算", exact: true })).toContainText("920.00");
  await expect(page.getByRole("region", { name: "项目 VC 预算", exact: true })).toContainText("80.00");
  await page.getByLabel("资金项目", { exact: true }).selectOption(otherProjectId);
  await expect(page.getByRole("cell", { name: /原项目已授予贡献/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "导出项目 VC CSV", exact: true })).toHaveAttribute(
    "href",
    `/api/workspaces/test/lab/ledger/?format=csv&project_id=${otherProjectId}`
  );
  await page.getByRole("button", { name: "读取账本", exact: true }).click();
  await expect(page.getByRole("cell", { name: /另一项目已授予贡献/ })).toBeVisible();
  expect(queried).toEqual([projectId, projectId, otherProjectId]);
});

/* oxlint-disable no-await-in-loop -- The actions open and close the same dialog in sequence. */
test("ordinary HTTP finance and project workflow actions open their business forms without crashing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await common(page);
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: overview() }));
  const flow = {
    scope: "finance",
    project_id: projectId,
    title: "声学实验资金流程",
    active_node_ids: ["award"],
    nodes: [{ id: "award", label: "核准阶段金额", x: 0, y: 0, state: "current" }],
    edges: [],
    history: [],
    actions: (
      [
        ["stage", "冻结阶段奖励预算"],
        ["receipt", "登记真实到账"],
        ["settlement", "核准最终执行奖励"],
        ["commit", "安排现金支付"],
        ["payment", "登记线下支付"],
        ["risk-release", "释放原批次风险金"],
      ] as const
    ).map(([action, label]) => ({
      id: action,
      action,
      label,
      node_id: "award",
      body: { stage_id: stageId },
      enabled: true,
      reason: "",
    })),
  };
  await page.route("**/lab/finance/workflow/**", (route) => route.fulfill({ json: flow }));
  await page.route("**/lab/projects/*/workflow/", (route) => route.fulfill({ json: { ...flow, scope: "project" } }));
  await mount(page, "finance", `/test/lab/finance?project_id=${projectId}`, planner, httpOrigin);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByRole("button", { name: "资金与项目流程" }).click();
  for (const scope of ["资金流程图", "项目流程图"]) {
    const region = page.getByRole("region", { name: scope, exact: true });
    for (const action of flow.actions) {
      await region.getByRole("button", { name: action.label, exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect.poll(async () => errors.length + (await dialog.count())).toBeGreaterThan(0);
      expect(errors).toEqual([]);
      await expect(dialog).toHaveAccessibleName(action.label);
      if (["receipt", "settlement"].includes(action.action))
        await expect(dialog.getByLabel("阶段", { exact: true })).toHaveValue(stageId);
      await dialog.getByRole("button", { name: "取消", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
  }
});
/* oxlint-enable no-await-in-loop */

test("ordinary HTTP custom numeric parameter can be added and edited without crashing", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await common(page);
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: overview() }));
  await page.route("**/lab/finance/formulas/*/", (route) =>
    route.fulfill({ json: { templates: [], versions: [formula] } })
  );
  await mount(page, "finance", `/test/lab/finance?project_id=${projectId}`, planner, httpOrigin);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByRole("button", { name: "项目奖励公式", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "添加数值参数" }).click();
  const parameter = dialog.getByLabel("参数名（英文字母／数字／下划线）");
  await expect.poll(async () => errors.length + (await parameter.count())).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await parameter.fill("performance");
  await dialog.getByLabel("单位", { exact: true }).fill("倍");
  await dialog.getByLabel("来源", { exact: true }).fill("阶段绩效核准");
  await expect(parameter).toHaveValue("performance");
});

test("ordinary HTTP saved custom formula parameters load, keep their metadata and save a new version", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await common(page);
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: overview() }));
  const custom = {
    ...formula,
    parameters: [{ name: "performance", scope: "task", unit: "倍", source: "阶段绩效核准", default: "1.25" }],
  };
  let saved: Record<string, unknown> | undefined;
  await page.route("**/lab/finance/formulas/*/", (route) => {
    if (route.request().method() === "POST") {
      saved = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: { ...custom, version: 3 } });
    }
    return route.fulfill({ json: { templates: [], versions: [custom] } });
  });
  await mount(page, "finance", `/test/lab/finance?project_id=${projectId}`, planner, httpOrigin);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByRole("button", { name: "项目奖励公式", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("参数名（英文字母／数字／下划线）")).toHaveValue("performance");
  await expect(dialog.getByLabel("默认数值（可选）")).toHaveValue("1.25");
  await dialog.getByLabel("默认数值（可选）").fill("1.5");
  await dialog.getByLabel("新版本原因").fill("阶段绩效系数修订");
  await dialog.getByRole("button", { name: "保存新公式版本" }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved?.parameters).toEqual([
    { name: "performance", scope: "task", unit: "倍", source: "阶段绩效核准", default: "1.5" },
  ]);
  expect(errors).toEqual([]);
});

/* oxlint-disable no-await-in-loop -- Each action must close its dialog before the next action opens. */
test("ordinary HTTP direct finance toolbar opens the same business form", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await common(page);
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: overview() }));
  await mount(page, "finance", "/test/lab/finance", planner, httpOrigin);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByLabel("办理资金事项").selectOption("settlement");
  await expect.poll(async () => errors.length + (await page.getByRole("dialog").count())).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  await expect(page.getByRole("dialog")).toHaveAccessibleName("核准最终执行奖励");
  await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
  const toolbar = page.getByLabel("办理资金事项");
  const actions = await toolbar
    .locator("option")
    .evaluateAll((options) =>
      options
        .map((option) => ({ action: (option as HTMLOptionElement).value, label: option.textContent ?? "" }))
        .filter((row) => row.action)
    );
  for (const action of actions) {
    await toolbar.selectOption(action.action);
    await expect(page.getByRole("dialog")).toHaveAccessibleName(action.label);
    expect(errors).toEqual([]);
    await page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

test("financial amount warns immediately when exceeding the selected source balance", async ({ page }) => {
  await common(page);
  const data = overview();
  data.accounts[0]!.available = "0.30";
  data.accounts[0]!.kind = "project";
  data.accounts.push({
    ...data.accounts[0]!,
    id: "retained",
    kind: "retained",
    label: "留存资金",
    balance: "100.00",
    available: "100.00",
  });
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: data }));
  let posts = 0;
  await page.route("**/lab/finance/transfer/", (route) => {
    posts += 1;
    return route.fulfill({ json: { ok: true } });
  });
  await mount(page, "finance");
  await page.getByLabel("办理资金事项").selectOption("transfer");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("转出账户").selectOption("execution");
  await dialog.getByLabel("转入账户").selectOption("retained");
  await dialog.getByLabel("划拨金额（元）").fill("0.31");
  await expect(dialog.getByRole("alert")).toContainText("0.30");
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  expect(posts).toBe(0);
  await dialog.getByLabel("划拨金额（元）").fill("0.30");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  await dialog.getByLabel("划拨金额（元）").fill("10.00");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByLabel("转出账户").selectOption("retained");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
});
/* oxlint-enable no-await-in-loop */

test("ordinary HTTP published team bounty can be deleted without removing personal planning references", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const managed = {
    ...bounty,
    is_lead: true,
    access_level: "project" as const,
    can_manage_materials: true,
    can_delete: true,
  };
  const rows = [managed];
  const retained: LabPlanner = {
    ...planner,
    items: [
      {
        id: "retained-planning-item",
        title: managed.title,
        status: "todo",
        kind: "project",
        public: true,
        folder_id: null,
        issue_id: managed.issue_id,
        project_id: projectId,
        project_name: managed.project,
        issue_key: managed.issue_key,
        priority: null,
        target_date: null,
        category_color: "#06b6d4",
        category_name: "本人自定义",
        bounty_id: bountyId,
        schedule: { future_count: 0, next_start: null, next_end: null, week_minutes: 0, total_count: 0 },
      },
    ],
  };
  await common(page, rows);
  await page.route("**/lab/planner/", (route) => route.fulfill({ json: retained }));
  await page.route("**/lab/bounties/*/materials/**", (route) => route.fulfill({ json: { materials: [] } }));
  let body: Record<string, unknown> | undefined;
  await page.route("**/lab/bounties/*/detail/", (route) => {
    if (route.request().method() === "DELETE") {
      body = route.request().postDataJSON() as Record<string, unknown>;
      rows.splice(0);
      retained.items[0]!.bounty_id = null;
      return route.fulfill({ status: 204 });
    }
    return route.fulfill({ json: managed });
  });
  await mount(page, "market", `/test/lab/bounties?bounty_id=${managed.id}`, retained, httpOrigin);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await expect(page.getByLabel("规划事项数量")).toHaveText("1");
  await expect(page.getByRole("button", { name: `查看悬赏 ${managed.title}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "删除悬赏", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("删除悬赏");
  await dialog.getByLabel("删除原因").fill("测试发布作废");
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(body?.reason).toBe("测试发布作废");
  await expect(page.getByRole("button", { name: `查看悬赏 ${managed.title}`, exact: true })).toHaveCount(0);
  await expect(page.locator(`#bounty-${bountyId}`)).toHaveCount(0);
  await expect(page.getByLabel("规划事项数量")).toHaveText("1");
  expect(retained.items[0]?.category_color).toBe("#06b6d4");
  expect(errors).toEqual([]);
});

test("ordinary HTTP task acceptance and workflow actions keep secure random request keys", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const reviewed = { ...bounty, status: "review" as const, is_reviewer: true, access_level: "project" as const };
  await common(page, [reviewed]);
  await page.route("**/lab/bounties/*/materials/**", (route) => route.fulfill({ json: { materials: [] } }));
  await mount(page, "market", `/test/lab/bounties?bounty_id=${bountyId}`, planner, httpOrigin);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByRole("button", { name: "独立验收", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("独立验收与累计贡献");
  let acceptance: Record<string, unknown> | undefined;
  await page.route("**/lab/bounties/*/accept/", (route) => {
    acceptance = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { ok: true } });
  });
  await page.getByRole("dialog").getByLabel("验收意见").fill("按约定交付验收通过");
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(acceptance?.request_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const cardRequestKey = acceptance?.request_key;
  const workflow = {
    current_node: "review",
    nodes: [{ id: "review", label: "独立验收", x: 0, y: 0, state: "current" }],
    edges: [],
    history: [],
    actions: [
      {
        id: "accept",
        action: "accept",
        label: "办理独立验收",
        node_id: "review",
        enabled: true,
        reason: "",
        body: {},
      },
    ],
  };
  await page.route("**/lab/bounties/*/workflow/", (route) => route.fulfill({ json: workflow }));
  await mount(page, "workflow", "/test/lab/bounties", planner, httpOrigin, [reviewed]);
  await page.getByRole("button", { name: "办理独立验收", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("办理独立验收");
  await page.getByRole("dialog").getByLabel("处理意见").fill("流程节点独立验收通过");
  await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(acceptance?.request_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(acceptance?.request_key).not.toBe(cardRequestKey);
  expect(acceptance?.reason).toBe("流程节点独立验收通过");
  expect(acceptance?.result).toBe("pass");
  expect(errors).toEqual([]);
});

test("ordinary HTTP VC correction opens and preserves the original contribution entry", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const managed = { ...bounty, is_lead: true, access_level: "project" as const };
  await common(page, [managed]);
  let reversed = false;
  const original = {
    id: "entry",
    created_at: "2026-10-09T08:00:00Z",
    delta: "20",
    bounty_id: bountyId,
    task: { title: bounty.title, project: bounty.project },
    participant: { name: "成员甲" },
    actor: "验收人",
    reason: "验收通过",
    reverses: null,
    can_reverse: true,
  };
  await page.route("**/lab/ledger/", (route) =>
    route.fulfill({
      json: reversed
        ? [
            { ...original, can_reverse: false },
            { ...original, id: "correction", delta: "-20", reason: "修正验收", reverses: "entry", can_reverse: false },
          ]
        : [original],
    })
  );
  let body: Record<string, unknown> | undefined;
  await page.route("**/lab/ledger/entry/reverse/", (route) => {
    body = route.request().postDataJSON() as Record<string, unknown>;
    reversed = true;
    return route.fulfill({ json: { ok: true } });
  });
  await mount(page, "ledger", "/test/lab/bounties", planner, httpOrigin, [managed]);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByRole("button", { name: "读取账本", exact: true }).click();
  await page.getByRole("button", { name: "冲正", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("贡献冲正");
  await dialog.getByLabel("更正原因").fill("修正验收");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(body?.request_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await expect(page.getByRole("table")).toContainText("验收通过");
  await expect(page.getByRole("table")).toContainText("修正验收");
  await expect(page.getByRole("button", { name: "冲正", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("ordinary HTTP deleted bounty contribution stays correctable using ledger permission", async ({ page }) => {
  await common(page, []);
  const original = {
    id: "deleted-bounty-entry",
    created_at: "2026-10-09T08:00:00Z",
    delta: "20",
    bounty_id: bountyId,
    task: { title: bounty.title, project: bounty.project },
    participant: { name: "成员甲" },
    actor: "验收人",
    reason: "删除前已验收贡献",
    reverses: null,
    can_reverse: true,
  };
  let corrected = false;
  await page.route("**/lab/ledger/", (route) =>
    route.fulfill({
      json: corrected
        ? [
            { ...original, can_reverse: false },
            { ...original, id: "correction", delta: "-20", reverses: original.id, can_reverse: false },
          ]
        : [original],
    })
  );
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/lab/ledger/deleted-bounty-entry/reverse/", (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    if (bodies.length === 1) return route.fulfill({ status: 400, json: { detail: "请补充有效更正依据" } });
    corrected = true;
    return route.fulfill({ json: { ok: true } });
  });
  await mount(page, "ledger", "/test/lab/bounties", planner, httpOrigin, []);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByRole("button", { name: "读取账本", exact: true }).click();
  await expect(page.getByRole("button", { name: "冲正", exact: true })).toBeVisible({ timeout: 1500 });
  await page.getByRole("button", { name: "冲正", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("更正原因").fill("更正依据");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("补充有效更正依据");
  await dialog.getByLabel("更正原因").fill("复核记录更正已删除卡片的验收贡献");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(bodies[0]?.request_key).toBe(bodies[1]?.request_key);
  expect(bodies[1]?.reason).toBe("复核记录更正已删除卡片的验收贡献");
  await expect(page.getByRole("table")).toContainText("删除前已验收贡献");
  await expect(page.getByRole("button", { name: "冲正", exact: true })).toHaveCount(0);
  await page.route("**/lab/ledger/", (route) => route.fulfill({ json: [{ ...original, can_reverse: false }] }));
  await mount(page, "ledger", "/test/lab/bounties", planner, httpOrigin, [{ ...bounty, is_lead: true }]);
  await page.getByRole("button", { name: "读取账本", exact: true }).click();
  await expect(page.getByRole("table")).toContainText("删除前已验收贡献");
  await expect(page.getByRole("button", { name: "冲正", exact: true })).toHaveCount(0);
});

test("project formula sample, validation and version save use decimal inputs and distinct expressions", async ({
  page,
}) => {
  await common(page);
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: overview() }));
  let saved: Record<string, unknown> | undefined;
  await page.route("**/lab/finance/formulas/*/", (route) => {
    if (route.request().method() === "POST") {
      saved = route.request().postDataJSON() as Record<string, unknown>;
      return route.fulfill({ json: { ...formula, version: 3 } });
    }
    return route.fulfill({ json: { templates: [{ name: "原制度模板", ...formula }], versions: [formula] } });
  });
  let attempts = 0;
  await page.route("**/lab/finance/preview/*/", (route) => {
    attempts++;
    const body = route.request().postDataJSON() as { inputs: Record<string, string>; task_expression: string };
    expect(body.inputs.E).toBe("70000");
    expect(body.inputs.VC).toBe("100");
    expect(body.task_expression).toBe("E * VC / B");
    return route.fulfill(
      attempts === 1 ? { status: 400, json: { detail: "预算 B 不能为零" } } : { json: { result: "7000.00" } }
    );
  });
  await mount(page, "finance");
  await page.getByLabel("资金项目", { exact: true }).selectOption(projectId);
  await page.getByRole("button", { name: "项目奖励公式", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("任务预计奖励公式", { exact: true }).fill("E * VC / B");
  await dialog.getByRole("button", { name: "计算样例预计金额" }).click();
  await expect(dialog.getByRole("alert")).toContainText("预算 B 不能为零");
  await dialog.getByRole("button", { name: "计算样例预计金额" }).click();
  await expect(dialog.getByRole("status")).toContainText("7000.00");
  await dialog.getByLabel("新版本原因").fill("该项目采用按贡献计算");
  await dialog.getByRole("button", { name: "保存新公式版本" }).click();
  await expect(dialog).toHaveCount(0);
  expect(saved?.task_expression).toBe("E * VC / B");
  expect(saved?.member_expression).toBe("E * VC / B");
  expect(saved?.reason).toBe("该项目采用按贡献计算");
});

test("final reward can differ from forecast and failed retry preserves idempotency key", async ({ page }) => {
  await common(page);
  const data = overview();
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: data }));
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/lab/finance/settlement/", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    bodies.push(body);
    if (bodies.length === 1) return route.fulfill({ status: 400, json: { detail: "累计核准金额超过实际阶段额度" } });
    data.settlements.push({
      id: "settlement",
      stage_id: stageId,
      user_id: memberId,
      user_name: "成员甲",
      kind: "execution",
      revision: 1,
      amount: "1800.00",
      forecast_id: "forecast",
      forecast_amount: "1400.00",
      difference: "400.00",
      performance_basis: String(body.performance_basis),
      paid: "0.00",
      withheld: "0.00",
      net_paid: "0.00",
      outstanding: "1800.00",
      committed: "0.00",
      can_manage: true,
    });
    return route.fulfill({ json: { ok: true } });
  });
  await mount(page, "finance", "/test/lab/finance", planner, httpOrigin);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByLabel("办理资金事项").selectOption("settlement");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("阶段", { exact: true }).selectOption(stageId);
  await dialog.getByLabel("奖励成员").selectOption(memberId);
  await dialog.getByLabel("个人阶段累计最终核准金额（元）").fill("1800.00");
  await dialog.getByLabel("绩效与核准依据").fill("按实际质量追加奖励");
  await dialog.getByLabel("关联参考预测（可选）").selectOption("forecast");
  await dialog.getByLabel("操作／核准依据").fill("负责人核准");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("超过实际阶段额度");
  await dialog.getByLabel("个人阶段累计最终核准金额（元）").fill("1800.00");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(bodies[0]?.request_key).toBe(bodies[1]?.request_key);
  expect(bodies[1]?.request_key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(bodies[1]?.amount).toBe("1800.00");
  await page.getByRole("button", { name: "核准与付款", exact: true }).click();
  const table = page.getByRole("region", { name: "最终核准与预测差异" });
  await expect(table).toContainText("¥1400.00");
  await expect(table).toContainText("¥1800.00");
  await expect(table).toContainText("¥400.00");
});

test("open card default, personal participation and direct task detail preserve public tier", async ({ page }) => {
  const active = {
    ...bounty,
    id: "55555555-5555-4555-8555-555555555555",
    title: "我参与的采样",
    status: "active" as const,
    access_level: "task" as const,
    can_claim: false,
    allocations: [
      {
        id: "allocation",
        user_id: memberId,
        name: "成员甲",
        deliverable: "采样表",
        planned: "100",
        awarded: "0",
        approved: true,
        confirmed: true,
        closed: false,
      },
    ],
  };
  await common(page, [bounty, active]);
  await page.route("**/lab/bounties/*/materials/**", (route) => route.fulfill({ json: { materials: [] } }));
  await mount(page, "market", `/test/lab/bounties?bounty_id=${active.id}`);
  await expect(page.getByRole("button", { name: "查看悬赏 标注声学样本", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看悬赏 我参与的采样", exact: true })).toHaveCount(0);
  await expect(page.locator(`#bounty-${active.id}`)).toContainText("我参与的采样");
  await expect(page.locator(`#bounty-${active.id} a[href*='/projects/']`)).toHaveCount(0);
  await page.getByRole("button", { name: "我的参与", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看悬赏 我参与的采样", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开放认领", exact: true }).click();
  const card = page.getByRole("button", { name: "查看悬赏 标注声学样本", exact: true });
  await expect(card).toContainText("预计 ¥1400.00");
  await expect(card.getByLabel("悬赏任务")).toHaveCount(1);
  expect(await card.evaluate((element) => getComputedStyle(element).borderColor)).toBe("rgb(249, 115, 22)");
  await card.click();
  await expect(page.locator(`#bounty-${bounty.id}`)).toContainText("标注表");
  await expect(page.getByRole("button", { name: "申请认领", exact: true })).toBeVisible();
});

test("cross-project planning cards keep custom color and route through task detail with disabled native status", async ({
  page,
}) => {
  await common(page);
  const cross: LabPlanner = {
    ...planner,
    projects: [],
    items: [
      {
        id: "personal-reference",
        title: "跨项目悬赏",
        status: "todo",
        kind: "project",
        public: true,
        folder_id: null,
        issue_id: "native-issue",
        project_id: projectId,
        project_name: "跨项目",
        issue_key: "LAB-9",
        priority: null,
        target_date: null,
        category_color: "#06b6d4",
        category_name: "本人自定义",
        bounty_id: bountyId,
        can_edit_issue: false,
        schedule: { future_count: 0, next_start: null, next_end: null, week_minutes: 0, total_count: 0 },
      },
    ],
  };
  await mount(page, "planner", "/test/lab/planner", cross);
  const card = page.locator(".lab-planner-card");
  await expect(card.getByLabel("悬赏任务")).toBeVisible();
  await expect(card).toContainText("本人自定义");
  await expect(card.getByRole("combobox", { name: "跨项目悬赏状态" })).toBeDisabled();
  await expect(card.getByRole("link", { name: "跨项目悬赏", exact: true })).toHaveAttribute(
    "href",
    `/test/lab/bounties?bounty_id=${bountyId}`
  );
  expect(await card.evaluate((element) => getComputedStyle(element).borderColor)).toBe("rgb(6, 182, 212)");
});

test("confirming the delivery agreement refreshes the same planning item immediately", async ({ page }) => {
  const mine = {
    ...bounty,
    access_level: "task" as const,
    can_claim: false,
    can_confirm: true,
    allocations: [
      {
        id: "allocation",
        user_id: memberId,
        name: "成员甲",
        deliverable: "标注表",
        planned: "100",
        awarded: "0",
        approved: true,
        confirmed: false,
        closed: false,
      },
    ],
  };
  await common(page, [mine]);
  await page.route("**/lab/bounties/*/materials/**", (route) => route.fulfill({ json: { materials: [] } }));
  let confirmed = false;
  await page.route("**/lab/bounties/*/confirm/", (route) => {
    confirmed = true;
    mine.can_confirm = false;
    mine.allocations[0]!.confirmed = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/lab/planner/", (route) =>
    route.fulfill({
      json: confirmed
        ? {
            ...planner,
            items: [
              {
                id: "same-item",
                title: mine.title,
                status: "todo",
                kind: "project",
                public: true,
                folder_id: null,
                issue_id: mine.issue_id,
                project_name: mine.project,
                issue_key: mine.issue_key,
                priority: null,
                target_date: null,
                bounty_id: mine.id,
                schedule: { future_count: 0, next_start: null, next_end: null, week_minutes: 0, total_count: 0 },
              },
            ],
          }
        : planner,
    })
  );
  await mount(page, "market", `/test/lab/bounties?bounty_id=${mine.id}`);
  await expect(page.getByLabel("规划事项数量")).toHaveText("0");
  await page.getByRole("button", { name: "确认交付约定", exact: true }).click();
  await expect(page.getByLabel("规划事项数量")).toHaveText("1");
  await expect(page.getByRole("button", { name: "确认交付约定", exact: true })).toHaveCount(0);
});

test("explicit sharing reads a frozen document through the controlled task endpoint and can revoke it", async ({
  page,
}) => {
  const managed = { ...bounty, access_level: "project" as const, is_lead: true, can_manage_materials: true };
  await common(page, [managed]);
  const materials: { id: string; kind: string; label: string }[] = [];
  let posted: Record<string, unknown> | undefined;
  await page.route("**/lab/bounties/*/materials/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (method === "POST") {
      posted = route.request().postDataJSON() as Record<string, unknown>;
      materials.push({ id: "shared-version", kind: "document_version", label: String(posted.label) });
      return route.fulfill({ json: { ok: true } });
    }
    if (method === "DELETE") {
      materials.splice(0);
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith("/shared-version/"))
      return route.fulfill({
        json: {
          name: "执行方案 v3",
          description_html: "<p>冻结的采样规程</p><script>alert('unsafe')</script>",
          created_at: "2026-10-09T08:00:00Z",
        },
      });
    return route.fulfill({
      json: {
        materials,
        sources: {
          document_versions: [{ id: "version-3", name: "执行方案 v3", created_at: "2026-10-09T08:00:00Z" }],
          attachments: [],
        },
      },
    });
  });
  await mount(page, "market", `/test/lab/bounties?bounty_id=${managed.id}`);
  await page.getByRole("button", { name: "共享附件／文档版本" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("选择具体资料").selectOption("version-3");
  await dialog.getByLabel("给参与成员显示的名称").fill("采样规范固定版本");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(posted?.kind).toBe("document_version");
  expect(posted?.page_version_id).toBe("version-3");
  await page.getByRole("button", { name: "读取共享版本" }).click();
  await expect(page.getByRole("dialog")).toContainText("冻结的采样规程");
  await expect(page.getByRole("dialog").locator("script")).toHaveCount(0);
  await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "撤回共享", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "撤回共享", exact: true }).click();
  await expect(page.getByRole("region", { name: "悬赏共享资料" })).toContainText("尚无已共享");
});

test("project source links, formula snapshots and parallel active finance nodes open concrete business forms", async ({
  page,
}) => {
  await common(page);
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: overview() }));
  const flow = {
    scope: "finance",
    project_id: projectId,
    title: "声学实验资金流程",
    active_node_ids: ["award", "risk"],
    nodes: [
      { id: "award", label: "核准阶段金额", x: 0, y: 0, state: "current" },
      { id: "risk", label: "处理原批次风险金", x: 320, y: 120, state: "current" },
    ],
    edges: [],
    history: [
      {
        id: "event",
        label: "预算预测快照",
        node_id: "award",
        actor: "负责人",
        created_at: "2026-10-09T08:00:00Z",
        occurred_at: "2026-10-08T08:00:00Z",
        reason: "核算贡献",
        evidence: "凭证 A-01",
        snapshot: {
          formula_version: 2,
          expression: "E * VC / B",
          inputs: { E: "70000", VC: "20", B: "1000" },
          result: "1400.00",
        },
        source: { path: `/test/lab/bounties?bounty_id=${bountyId}`, label: "打开源悬赏" },
      },
    ],
    actions: [
      {
        id: "settle",
        action: "settlement",
        label: "办理最终核准",
        node_id: "award",
        body: { stage_id: stageId },
        enabled: true,
        reason: "",
      },
    ],
  };
  await page.route("**/lab/finance/workflow/**", (route) => route.fulfill({ json: flow }));
  await page.route("**/lab/projects/*/workflow/", (route) =>
    route.fulfill({ json: { ...flow, scope: "project", title: "声学实验项目流程", history: [], actions: [] } })
  );
  await mount(page, "finance", `/test/lab/finance?project_id=${projectId}`);
  await expect(page.getByLabel("资金项目", { exact: true })).toHaveValue(projectId);
  await page.getByRole("button", { name: "资金与项目流程" }).click();
  const region = page.getByRole("region", { name: "资金流程图", exact: true });
  await expect(region.getByRole("link", { name: "打开源悬赏" })).toHaveAttribute(
    "href",
    `/test/lab/bounties?bounty_id=${bountyId}`
  );
  await expect(region).toContainText("凭证 A-01");
  await expect(region).toContainText("事实发生于");
  await region.getByText("查看计算与业务快照", { exact: true }).click();
  await expect(region).toContainText('"formula_version": 2');
  await expect(region).toContainText('"result": "1400.00"');
  await region.getByRole("button", { name: "办理最终核准" }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("核准最终执行奖励");
  await expect(page.getByRole("dialog").getByLabel("阶段", { exact: true })).toHaveValue(stageId);
});

test("stage budget freezes purpose entries and source-qualified historical VC without client-assigned shares", async ({
  page,
}) => {
  await common(page);
  const data = overview();
  data.stages = [];
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: data }));
  let body: Record<string, unknown> | undefined;
  await page.route("**/lab/finance/stage/", (route) => {
    body = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({ json: { ok: true } });
  });
  await mount(page, "finance", "/test/lab/finance", planner, httpOrigin);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(false);
  await page.getByLabel("办理资金事项").selectOption("stage");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("事前冻结的 VC 阶段 B").selectOption(stageId);
  await dialog.getByLabel("阶段执行奖励预算 E（元）").fill("70000.00");
  await dialog.getByLabel("用途", { exact: true }).fill("样本处理奖励");
  await dialog.getByLabel("用途金额（元）").fill("70000.00");
  await dialog.getByRole("button", { name: "添加用途条目", exact: true }).click();
  await expect(dialog.getByLabel("用途", { exact: true })).toHaveCount(2);
  await dialog.getByRole("button", { name: "删除用途", exact: true }).last().click();
  await expect(dialog.getByLabel("用途", { exact: true })).toHaveValue("样本处理奖励");
  await dialog.getByLabel("成员", { exact: true }).selectOption(memberId);
  await dialog.getByLabel("计划 VC", { exact: true }).fill("100");
  await dialog.getByLabel("基础份额 b（0–1）").fill("0.1");
  await dialog.getByLabel("职责份额 r（0–1）").fill("0.1");
  await dialog.getByRole("button", { name: "添加成员参数", exact: true }).click();
  await expect(dialog.getByLabel("成员", { exact: true })).toHaveCount(2);
  await dialog.getByRole("button", { name: "删除成员参数", exact: true }).last().click();
  await expect(dialog.getByLabel("成员", { exact: true })).toHaveValue(memberId);
  await dialog.getByLabel("升级项目，冻结历史孵化资格").check();
  await dialog.getByLabel("历史成员", { exact: true }).selectOption(memberId);
  await dialog.getByLabel("历史有效 VC", { exact: true }).fill("300");
  await dialog.getByLabel("具体资金来源（与到账来源一致）").fill("专项执行到账");
  await dialog.getByLabel("资格形成日期").fill("2025-10-09");
  await dialog.getByLabel("资格依据", { exact: true }).fill("早期孵化验收记录");
  await dialog.getByRole("button", { name: "添加历史资格", exact: true }).click();
  await expect(dialog.getByLabel("历史成员", { exact: true })).toHaveCount(2);
  await dialog.getByRole("button", { name: "删除历史资格", exact: true }).last().click();
  await expect(dialog.getByLabel("历史成员", { exact: true })).toHaveValue(memberId);
  await dialog.getByLabel("操作／核准依据").fill("事前冻结阶段方案");
  await dialog.getByLabel("凭证或证据引用").fill("孵化验收凭证 H-01");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(body?.E).toBe("70000.00");
  expect(body?.purposes).toEqual([{ name: "样本处理奖励", amount: "70000.00" }]);
  expect(body?.history).toEqual([
    {
      user_id: memberId,
      vc: "300",
      funding_source: "专项执行到账",
      qualified_at: "2025-10-09",
      basis: "早期孵化验收记录",
    },
  ]);
  expect(body?.members).toEqual([{ user_id: memberId, b: "0.1", r: "0.1", planned_vc: "100" }]);
});

test("public duties keep approval, commitment, withholding and offline payment as separate records", async ({
  page,
}) => {
  await common(page);
  const data = overview();
  data.public_awards = [];
  data.public_commitments = [];
  data.public_payments = [];
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: data }));
  await page.route("**/lab/finance/public-duty/", (route) => {
    const body = route.request().postDataJSON() as Record<string, string>;
    expect(body.amount).toBe("1200.00");
    data.public_awards!.push({
      id: "duty-award",
      group_key: "group",
      revision: 1,
      user_id: memberId,
      user_name: "成员甲",
      period: body.period!,
      duty: body.duty!,
      amount: "1200.00",
      paid: "0.00",
      outstanding: "1200.00",
      committed: "0.00",
      withheld: "0.00",
      net_paid: "0.00",
      can_manage: true,
    });
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/lab/finance/public-commit/", (route) => {
    const body = route.request().postDataJSON() as Record<string, string>;
    expect(body.award_id).toBe("duty-award");
    expect(body.amount).toBe("600.00");
    data.public_commitments!.push({
      id: "public-commitment",
      award_id: "duty-award",
      user_id: memberId,
      user_name: "成员甲",
      account_id: "public",
      amount: "600.00",
      paid: "0.00",
      remaining: "600.00",
      cancelled: false,
      can_manage: true,
    });
    data.public_awards![0]!.committed = "600.00";
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/lab/finance/public-payment/", (route) => {
    const body = route.request().postDataJSON() as Record<string, string>;
    expect(body.commitment_id).toBe("public-commitment");
    expect(body.gross).toBe("500.00");
    expect(body.withheld).toBe("50.00");
    data.public_payments!.push({
      id: "public-payment",
      commitment_id: "public-commitment",
      award_id: "duty-award",
      user_id: memberId,
      gross: "500.00",
      withheld: "50.00",
      net: "450.00",
      evidence: body.evidence!,
      reference: body.reference!,
      created_at: "2026-10-09T08:00:00Z",
      occurred_at: "2026-10-09T08:00:00Z",
      reversed: false,
    });
    data.public_commitments![0]!.paid = "500.00";
    data.public_commitments![0]!.remaining = "100.00";
    Object.assign(data.public_awards![0]!, {
      paid: "500.00",
      outstanding: "700.00",
      committed: "100.00",
      withheld: "50.00",
      net_paid: "450.00",
    });
    return route.fulfill({ json: { ok: true } });
  });
  await mount(page, "finance");
  await page.getByLabel("办理资金事项").selectOption("public-duty");
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("公共职责成员").selectOption(memberId);
  await dialog.getByLabel("履职月份").fill("2026-10");
  await dialog.getByLabel("职责与履职核准依据").fill("设备维护按月完成");
  await dialog.getByLabel("本月累计固定奖励（元）").fill("1200.00");
  await dialog.getByLabel("操作／核准依据").fill("履职审核通过");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "核准与付款", exact: true }).click();
  await page.getByRole("button", { name: "安排公共职责支付", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("本次公共职责支付安排（元）").fill("600.00");
  await dialog.getByLabel("操作／核准依据").fill("首次分期支付安排");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "登记公共职责支付", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("本次核销应付（元）").fill("500.00");
  await dialog.getByLabel("本次扣缴（元）").fill("50.00");
  await dialog.getByLabel("线下付款凭证号").fill("P-2026-10");
  await dialog.getByLabel("操作／核准依据").fill("线下实际完成付款");
  await dialog.getByLabel("凭证或证据引用").fill("银行付款及扣缴凭据");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("region", { name: "公共职责线下支付记录" })).toContainText("¥450.00");
  await expect(page.getByRole("region", { name: "公共职责奖励明细" })).toContainText("¥700.00");
  await expect(page.getByRole("region", { name: "公共职责支付安排" })).toContainText("¥100.00");
});

test("retained funds allocate only to another frozen stage in the same project without creating an award", async ({
  page,
}) => {
  await common(page);
  const data = overview();
  const nextStageId = "66666666-6666-4666-8666-666666666666";
  data.accounts.push({
    id: "retained-source",
    project_id: projectId,
    stage_id: stageId,
    kind: "retained",
    label: "第一阶段未用留存",
    balance: "3000.00",
    available: "3000.00",
    committed: "0.00",
    can_manage: true,
  });
  data.stages.push({
    ...data.stages[0]!,
    id: "next-budget",
    stage_id: nextStageId,
    name: "第二阶段",
    execution_funded: "0.00",
  });
  data.stages.push({
    ...data.stages[0]!,
    id: "other-budget",
    stage_id: "77777777-7777-4777-8777-777777777777",
    project_id: "88888888-8888-4888-8888-888888888888",
    name: "其他项目阶段",
  });
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: data }));
  let body: import("../../../packages/types/src/lab-finance").LabStageAllocationRequest | undefined;
  let settlementRequests = 0;
  await page.route("**/lab/finance/stage-allocation/", (route) => {
    body = route
      .request()
      .postDataJSON() as import("../../../packages/types/src/lab-finance").LabStageAllocationRequest;
    data.accounts.find((account) => account.id === "retained-source")!.available = "1500.00";
    data.stages.find((stage) => stage.stage_id === nextStageId)!.execution_funded = "1500.00";
    return route.fulfill({ json: { ok: true } });
  });
  await page.route("**/lab/finance/settlement/", (route) => {
    settlementRequests++;
    return route.fulfill({ json: { ok: true } });
  });
  await mount(page, "finance");
  await page.getByRole("button", { name: "拨付新阶段奖励", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveAccessibleName("拨付留存至新阶段奖励");
  await expect(dialog.getByLabel("同项目留存来源账户", { exact: true })).toHaveValue("retained-source");
  const targets = dialog.getByLabel("已冻结的新阶段", { exact: true });
  await expect(targets.locator("option")).toHaveCount(2);
  await expect(targets).not.toContainText("其他项目阶段");
  await expect(targets).not.toContainText("第一阶段");
  await targets.selectOption(nextStageId);
  await dialog.getByLabel("留存拨付执行奖励（元）").fill("1500.00");
  await dialog.getByLabel("操作／核准依据").fill("第一阶段结转资金用于第二阶段执行奖励");
  await dialog.getByLabel("凭证或证据引用").fill("结转核准单 C-01");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(body?.from_account_id).toBe("retained-source");
  expect(body?.stage_id).toBe(nextStageId);
  expect(body?.amount).toBe("1500.00");
  expect(body?.reason).toBe("第一阶段结转资金用于第二阶段执行奖励");
  expect(body?.evidence).toBe("结转核准单 C-01");
  expect(body?.request_key).toMatch(/^[0-9a-f-]{36}$/);
  expect(settlementRequests).toBe(0);
});

function financialLimitOverview(): LabFinanceOverview {
  const data = overview();
  data.future_plan_limits = { "2026": "90.00", "2025": "50.00" };
  data.members.push({ id: "member-two", name: "成员乙" });
  Object.assign(data.accounts[0]!, { balance: "100.00", available: "80.00", committed: "20.00" });
  Object.assign(data.stages[0]!, { execution_funded: "100.00" });
  for (const [kind, balance, available] of [
    ["project", "10.00", "10.00"],
    ["retained", "100.00", "70.00"],
    ["risk", "40.00", "30.00"],
    ["dispute", "40.00", "30.00"],
    ["withholding", "10.00", "10.00"],
    ["public", "100.00", "80.00"],
    ["future_exploration", "50.00", "40.00"],
    ["future_pool", "100.00", "100.00"],
  ]) {
    data.accounts.push({
      id: kind!,
      kind: kind!,
      balance: balance!,
      available: available!,
      committed: "0.00",
      label: kind!,
      project_id: ["public", "future_pool", "future_exploration"].includes(kind!) ? null : projectId,
      stage_id: ["public", "future_pool", "future_exploration"].includes(kind!) ? null : stageId,
      can_manage: true,
    });
  }
  data.settlements = [
    {
      id: "settlement-one",
      stage_id: stageId,
      user_id: memberId,
      user_name: "成员甲",
      kind: "execution",
      revision: 1,
      amount: "60.00",
      forecast_id: null,
      forecast_amount: null,
      difference: null,
      performance_basis: "绩效",
      paid: "10.00",
      outstanding: "50.00",
      committed: "20.00",
      withheld: "0.00",
      net_paid: "10.00",
      can_manage: true,
    },
    {
      id: "settlement-two",
      stage_id: stageId,
      user_id: "member-two",
      user_name: "成员乙",
      kind: "execution",
      revision: 1,
      amount: "20.00",
      forecast_id: null,
      forecast_amount: null,
      difference: null,
      performance_basis: "绩效",
      paid: "0.00",
      outstanding: "20.00",
      committed: "0.00",
      withheld: "0.00",
      net_paid: "0.00",
      can_manage: true,
    },
  ];
  data.commitments = [
    {
      id: "commitment",
      settlement_id: "settlement-one",
      account_id: "execution",
      user_id: memberId,
      amount: "20.00",
      paid: "0.00",
      remaining: "20.00",
      cancelled: false,
      can_manage: true,
    },
  ];
  data.batches = [
    {
      id: "batch",
      stage_id: stageId,
      project_id: projectId,
      gross: "400",
      costs: "0",
      D: "400",
      source: "到账批次",
      risk: "40.00",
      execution: "280.00",
      history: "0.00",
      risk_released: "0.00",
      risk_remaining: "40.00",
      history_snapshot: [],
      created_at: "2026-10-09T08:00:00Z",
      can_manage: true,
    },
  ];
  data.public_awards = [
    {
      id: "public-award",
      group_key: "public-group",
      revision: 1,
      user_id: memberId,
      user_name: "成员甲",
      period: "2026-10",
      duty: "设备管理",
      amount: "60.00",
      paid: "10.00",
      outstanding: "50.00",
      committed: "20.00",
      withheld: "0.00",
      net_paid: "10.00",
      can_manage: true,
    },
    {
      id: "public-award-two",
      group_key: "public-group-two",
      revision: 1,
      user_id: "member-two",
      user_name: "成员乙",
      period: "2026-10",
      duty: "资料管理",
      amount: "20.00",
      paid: "0.00",
      outstanding: "20.00",
      committed: "0.00",
      withheld: "0.00",
      net_paid: "0.00",
      can_manage: true,
    },
  ];
  data.public_commitments = [
    {
      id: "public-commitment",
      award_id: "public-award",
      account_id: "public",
      user_id: memberId,
      user_name: "成员甲",
      amount: "20.00",
      paid: "0.00",
      remaining: "20.00",
      cancelled: false,
      can_manage: true,
    },
  ];
  data.funding_targets = [
    { stage_id: stageId, project_id: projectId, project: "声学实验", name: "探索阶段", E: "100.00" },
  ];
  data.operations.push({
    id: "future-opening",
    kind: "opening",
    actor: "负责人",
    reason: "期初",
    evidence: "凭证",
    payload: {},
    created_at: "2026-10-09T08:00:00Z",
    occurred_at: "2026-10-09T08:00:00Z",
    reverses_id: null,
    reversed: false,
    can_manage: true,
  });
  data.entries.push({
    id: "future-entry",
    operation_id: "future-opening",
    account_id: "future_pool",
    project_id: null,
    stage_id: null,
    kind: "future_pool",
    delta: "90.00",
    reason: "期初",
    evidence: "凭证",
    actor: "负责人",
    created_at: "2026-10-09T08:00:00Z",
    occurred_at: "2026-10-09T08:00:00Z",
    reverses_id: null,
  });
  return data;
}

for (const scenario of [
  { action: "expense", selector: "支出账户", source: "project", label: "实际支出（元）", limit: "10.00" },
  {
    action: "tax-remit",
    selector: "扣缴待上缴账户",
    source: "withholding",
    label: "线下上缴金额（元）",
    limit: "10.00",
  },
  { action: "risk-release", selector: "原到账批次", source: "batch", label: "释放金额（元）", limit: "30.00" },
  {
    action: "risk-use",
    selector: "原到账风险准备金批次",
    source: "batch",
    label: "已批准的实际支出（元）",
    limit: "30.00",
  },
  {
    action: "commit",
    selector: "已核准奖励",
    source: "settlement-one",
    label: "本次支付安排金额（元）",
    limit: "30.00",
  },
  {
    action: "payment",
    selector: "已批准的现金支付安排",
    source: "commitment",
    label: "本次核销应付（元）",
    limit: "20.00",
  },
  {
    action: "public-commit",
    selector: "已核准公共职责奖励",
    source: "public-award",
    label: "本次公共职责支付安排（元）",
    limit: "30.00",
  },
  {
    action: "public-payment",
    selector: "公共职责未付支付安排",
    source: "public-commitment",
    label: "本次核销应付（元）",
    limit: "20.00",
  },
  { action: "dispute", selector: "原阶段执行账户", source: "execution", label: "预留争议金额（元）", limit: "20.00" },
  { action: "carryover", selector: "原阶段执行账户", source: "execution", label: "未用余额结转（元）", limit: "20.00" },
  { action: "resolve-dispute", selector: "原争议账户", source: "dispute", label: "释放金额（元）", limit: "30.00" },
  {
    action: "stage-allocation",
    selector: "同项目留存来源账户",
    source: "retained",
    label: "留存拨付执行奖励（元）",
    limit: "70.00",
  },
  {
    action: "exploration-allocation",
    selector: "探索阶段",
    source: stageId,
    label: "探索奖励拨付（元）",
    limit: "40.00",
  },
  {
    action: "public-duty",
    selector: "公共职责成员",
    source: memberId,
    label: "本月累计固定奖励（元）",
    limit: "30.00",
  },
  { action: "future-plan", selector: "", source: "", label: "该年度尚未编列的新增未来池资金（元）", limit: "90.00" },
]) {
  test(`financial ${scenario.action} checks the actual remaining amount while typing`, async ({ page }) => {
    await common(page);
    await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: financialLimitOverview() }));
    let writes = 0;
    await page.route(`**/lab/finance/${scenario.action}/`, (route) => {
      writes += 1;
      return route.fulfill({ json: { ok: true } });
    });
    await mount(page, "finance");
    await page.getByLabel("办理资金事项").selectOption(scenario.action);
    const dialog = page.getByRole("dialog");
    if (scenario.selector) await dialog.getByLabel(scenario.selector, { exact: true }).selectOption(scenario.source);
    if (scenario.action === "future-plan") await dialog.getByLabel("编列年度", { exact: true }).fill("2026");
    await dialog.getByLabel(scenario.label, { exact: true }).fill(String(Number(scenario.limit) + 1));
    await expect(dialog.getByRole("alert")).toContainText(scenario.limit);
    await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    expect(writes).toBe(0);
    await dialog.getByLabel(scenario.label, { exact: true }).fill(scenario.limit);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  });
}

for (const action of ["payment", "public-payment"]) {
  test(`financial ${action} checks withholding against gross immediately and after gross changes`, async ({ page }) => {
    await common(page);
    await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: financialLimitOverview() }));
    await mount(page, "finance");
    await page.getByLabel("办理资金事项").selectOption(action);
    const dialog = page.getByRole("dialog");
    await dialog
      .getByLabel(action === "payment" ? "已批准的现金支付安排" : "公共职责未付支付安排", { exact: true })
      .selectOption(action === "payment" ? "commitment" : "public-commitment");
    await dialog.getByLabel("本次核销应付（元）").fill("10.00");
    await dialog.getByLabel("本次扣缴（元）").fill("10.01");
    await expect(dialog.getByRole("alert")).toContainText("10.00");
    await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
    await dialog.getByLabel("本次扣缴（元）").fill("10.00");
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await dialog.getByLabel("本次核销应付（元）").fill("5.00");
    await expect(dialog.getByRole("alert")).toContainText("5.00");
    await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  });
}

test("financial cumulative approval respects other members and existing payments without using forecast as a ceiling", async ({
  page,
}) => {
  await common(page);
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: financialLimitOverview() }));
  await mount(page, "finance");
  await page.getByLabel("办理资金事项").selectOption("settlement");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("阶段", { exact: true }).selectOption(stageId);
  await dialog.getByLabel("奖励成员").selectOption(memberId);
  await dialog.getByLabel("个人阶段累计最终核准金额（元）").fill("80.01");
  await expect(dialog.getByRole("alert")).toContainText("80.00");
  await dialog.getByLabel("个人阶段累计最终核准金额（元）").fill("80.00");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("个人阶段累计最终核准金额（元）").fill("29.99");
  await expect(dialog.getByRole("alert")).toContainText("30.00");
  await dialog.getByLabel("个人阶段累计最终核准金额（元）").fill("40.01");
  await dialog.getByLabel("奖励成员").selectOption("member-two");
  await expect(dialog.getByRole("alert")).toContainText("40.00");
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
});

test("financial receipt limits costs and D to the entered real receipt while gross remains unrestricted", async ({
  page,
}) => {
  await common(page);
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: financialLimitOverview() }));
  await mount(page, "finance");
  await page.getByLabel("办理资金事项").selectOption("receipt");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("阶段", { exact: true }).selectOption(stageId);
  await dialog.getByLabel("本次真实到账（元）").fill("1000000.00");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("本次真实到账（元）").fill("0.30");
  await dialog.getByLabel("本次成本扣除（元）").fill("0.31");
  await expect(dialog.getByRole("alert")).toContainText("0.30");
  await dialog.getByLabel("本次成本扣除（元）").fill("0.10");
  await dialog.getByLabel("本次核准可分配 D（元）").fill("0.21");
  await expect(dialog.getByRole("alert")).toContainText("0.20");
  await dialog.getByLabel("本次核准可分配 D（元）").fill("0.20");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
});

test("financial stage purposes and selected member VC share the same exact budget", async ({ page }) => {
  await common(page);
  const data = financialLimitOverview();
  data.stages = [];
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: data }));
  await mount(page, "finance");
  await page.getByLabel("办理资金事项").selectOption("stage");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("事前冻结的 VC 阶段 B").selectOption(stageId);
  await dialog.getByLabel("阶段执行奖励预算 E（元）").fill("0.30");
  await dialog.getByLabel("用途金额（元）").fill("0.10");
  await dialog.getByRole("button", { name: "添加用途条目" }).click();
  await dialog.getByLabel("用途金额（元）").nth(1).fill("0.20");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("用途金额（元）").nth(1).fill("0.21");
  await expect(dialog.getByRole("alert").filter({ hasText: "0.20" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "删除用途" }).nth(1).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("成员", { exact: true }).selectOption(memberId);
  await dialog.getByLabel("计划 VC").fill("600.00");
  await dialog.getByRole("button", { name: "添加成员参数" }).click();
  await dialog.getByLabel("成员", { exact: true }).nth(1).selectOption("member-two");
  await dialog.getByLabel("计划 VC").nth(1).fill("400.00");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("计划 VC").nth(1).fill("400.01");
  await expect(dialog.getByRole("alert").filter({ hasText: "400.00" })).toBeVisible();
  await dialog.getByLabel("计划 VC").nth(1).fill("400.00");
  await dialog.getByLabel("基础份额 b（0–1）").first().fill("0.6");
  await dialog.getByLabel("基础份额 b（0–1）").nth(1).fill("0.4");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("基础份额 b（0–1）").nth(1).fill("0.4001");
  await expect(dialog.getByRole("alert").filter({ hasText: "0.4000" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
});

test("financial annual limits come from the server and update with the selected year", async ({ page }) => {
  await common(page);
  const data = financialLimitOverview();
  data.operations = [];
  data.entries = [];
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: data }));
  await mount(page, "finance");
  await page.getByLabel("办理资金事项").selectOption("future-plan");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("编列年度").fill("2026");
  await dialog.getByLabel("该年度尚未编列的新增未来池资金（元）").fill("90.00");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("编列年度").fill("2025");
  await expect(dialog.getByRole("alert")).toContainText("50.00");
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await dialog.getByLabel("该年度尚未编列的新增未来池资金（元）").fill("50.00");
  await dialog.getByLabel("编列年度").fill("2024");
  await expect(dialog.getByRole("alert")).toContainText("0 元");
});

test("financial payment respects cash balance even when an existing commitment has no available cash", async ({
  page,
}) => {
  await common(page);
  const data = financialLimitOverview();
  Object.assign(data.accounts[0]!, { balance: "5.00", available: "0.00" });
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: data }));
  await mount(page, "finance");
  await page.getByLabel("办理资金事项").selectOption("payment");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("已批准的现金支付安排").selectOption("commitment");
  await dialog.getByLabel("本次核销应付（元）").fill("5.01");
  await expect(dialog.getByRole("alert")).toContainText("5.00");
  await dialog.getByLabel("本次核销应付（元）").fill("5.00");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
});

test("financial public pool protects approved duties and uses public totals when project filtering hides accounts", async ({
  page,
}) => {
  await common(page);
  const data = financialLimitOverview();
  data.accounts = data.accounts.filter((row) => row.project_id !== null);
  data.public_summary = [
    { kind: "public", label: "公共贡献池", balance: "100.00", available: "80.00", committed: "20.00" },
  ];
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: data }));
  await mount(page, "finance", `/test/lab/finance?project_id=${projectId}`);
  await page.getByLabel("办理资金事项").selectOption("public-duty");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("公共职责成员").selectOption(memberId);
  await dialog.getByLabel("本月累计固定奖励（元）").fill("30.01");
  await expect(dialog.getByRole("alert")).toContainText("30.00");
  await dialog.getByLabel("追加修订的原核准（可选）").selectOption("public-award");
  await dialog.getByLabel("本月累计固定奖励（元）").fill("90.00");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByLabel("本月累计固定奖励（元）").fill("29.99");
  await expect(dialog.getByRole("alert")).toContainText("30.00");
});

test("financial new budgets and opening balances do not inherit an unrelated account ceiling", async ({ page }) => {
  await common(page);
  await page.route("**/lab/finance/overview/**", (route) => route.fulfill({ json: financialLimitOverview() }));
  await mount(page, "finance");
  await page.getByRole("button", { name: "设置 VC 预算", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("VC 预算", { exact: true }).fill("1000000.00");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByLabel("办理资金事项").selectOption("opening");
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("期初实际余额（元）").fill("1000000.00");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
});
