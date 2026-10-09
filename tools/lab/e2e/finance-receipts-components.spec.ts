/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import type {
  LabFinanceBatch,
  LabFinanceOverview,
  LabFinanceStage,
  LabPlanner,
} from "../../../packages/types/src/index";

const projectId = "11111111-1111-4111-8111-111111111111";
const stageId = "22222222-2222-4222-8222-222222222222";
const emptyStageId = "33333333-3333-4333-8333-333333333333";
const memberId = "44444444-4444-4444-8444-444444444444";
const firstBatchId = "55555555-5555-4555-8555-555555555555";
const secondBatchId = "66666666-6666-4666-8666-666666666666";
type DeletionKind = "receipt" | "stage" | "project";
type Body = Record<string, unknown>;
type Batch = LabFinanceBatch & {
  kind?: "receipt" | "opening";
  operation_id: string;
  occurred_at: string;
  reversed: boolean;
  can_delete: boolean;
  delete_reason: string | null;
};
type Stage = LabFinanceStage & {
  deleted: boolean;
  can_restore: boolean;
  can_delete: boolean;
  delete_reason: string | null;
};
type Project = LabFinanceOverview["projects"][number] & {
  finance_deleted: boolean;
  deleted: boolean;
  can_manage: boolean;
  can_restore: boolean;
  can_delete: boolean;
  delete_reason: string | null;
};
type Overview = Omit<LabFinanceOverview, "batches" | "stages" | "projects"> & {
  batches: Batch[];
  stages: Stage[];
  projects: Project[];
};
type MockState = {
  data: Overview;
  receipts: Body[];
  deletions: { kind: DeletionKind; body: Body }[];
  restorations: { kind: "stage" | "project"; body: Body }[];
  reject: Partial<Record<DeletionKind, string>>;
  marketError?: string;
  overviewReads: number;
  unexpected: string[];
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
      members: [],
      states: [],
      mapping: { todo: null, active: null, review: null, done: null },
    },
  ],
};

function stage(id: string, name: string): Stage {
  return {
    id: `budget-${id}`,
    stage_id: id,
    project_id: projectId,
    name,
    B: "1000.00",
    E: id === stageId ? "1960.00" : "500.00",
    purposes: [{ name: "样本处理", amount: id === stageId ? "1960.00" : "500.00" }],
    members: [],
    upgraded: false,
    history: [],
    execution_funded: "0.00",
    history_funded: "0.00",
    formula_version: null,
    can_manage: true,
    deleted: false,
    can_restore: false,
    can_delete: true,
    delete_reason: null,
  };
}

function batch(second = false): Batch {
  return {
    id: second ? secondBatchId : firstBatchId,
    operation_id: second ? "operation-two" : "operation-one",
    stage_id: stageId,
    project_id: projectId,
    gross: second ? "2000.00" : "1000.00",
    costs: "100.00",
    D: second ? "1900.00" : "900.00",
    source: second ? "第二笔合作到账" : "第一笔合作到账",
    execution: second ? "1330.00" : "630.00",
    risk: second ? "95.00" : "45.00",
    history: "0.00",
    risk_released: "0.00",
    risk_used: "0.00",
    risk_remaining: second ? "95.00" : "45.00",
    history_snapshot: [],
    created_at: second ? "2026-10-09T09:00:00Z" : "2026-10-09T08:00:00Z",
    occurred_at: second ? "2026-10-08T09:00:00Z" : "2026-10-07T08:00:00Z",
    can_manage: true,
    reversed: false,
    can_delete: true,
    delete_reason: null,
  };
}

function state(withReceipts = false, canManage = true): MockState {
  const data: Overview = {
    manager_id: memberId,
    is_manager: canManage,
    projects: [
      {
        id: projectId,
        name: "声学实验",
        is_lead: canManage,
        can_manage: canManage,
        deleted: false,
        finance_deleted: false,
        can_restore: false,
        can_delete: canManage,
        delete_reason: null,
      },
    ],
    members: [{ id: memberId, name: "负责人" }],
    accounts: [
      {
        id: "execution",
        project_id: projectId,
        stage_id: stageId,
        kind: "execution",
        label: "第一阶段执行奖励",
        balance: "0.00",
        committed: "0.00",
        available: "0.00",
        can_manage: canManage,
      },
    ],
    stages: [stage(stageId, "第一阶段"), stage(emptyStageId, "探索阶段")].map((row) =>
      Object.assign(row, { can_manage: canManage, can_delete: canManage })
    ),
    formulas: [],
    forecasts: [],
    batches: withReceipts
      ? [batch(), batch(true)].map((row) => Object.assign(row, { can_manage: canManage, can_delete: canManage }))
      : [],
    settlements: [],
    commitments: [],
    payments: [],
    operations: [],
    entries: [],
  };
  const result = { data, receipts: [], deletions: [], restorations: [], reject: {}, overviewReads: 0, unexpected: [] };
  updateFunding(result);
  return result;
}

// Fixed server outcomes cover the two independent batches and each reversal.
function updateFunding(mock: MockState) {
  const activeIds = new Set(mock.data.batches.filter((row) => !row.reversed).map((row) => row.id));
  const funded = activeIds.has(firstBatchId)
    ? activeIds.has(secondBatchId)
      ? "1960.00"
      : "630.00"
    : activeIds.has(secondBatchId)
      ? "1330.00"
      : "0.00";
  mock.data.accounts[0]!.balance = funded;
  mock.data.accounts[0]!.available = funded;
  mock.data.stages.find((row) => row.stage_id === stageId)!.execution_funded = funded;
}

let server: ReturnType<typeof createServer>;
let directory = "";
let origin = "";
let pageErrors: string[] = [];
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "lab-finance-receipts-"));
  const require = createRequire(resolve("apps/web/package.json"));
  const { build } = require("esbuild") as typeof import("esbuild");
  await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { MemoryRouter } from 'react-router'; import { LabStore } from '${resolve("packages/shared-state/src/lab.store.ts")}'; import { LabFinance } from '${resolve("apps/web/core/components/lab/finance.tsx")}'; const store = new LabStore('', 'test'); store.planner = window.labConfig.planner; createRoot(document.getElementById('root')).render(<MemoryRouter initialEntries={['/test/lab/finance?project_id=${projectId}']}><LabFinance store={store} /></MemoryRouter>);`,
      resolveDir: resolve("apps/web"),
      loader: "tsx",
      sourcefile: "lab-finance-receipts-harness.tsx",
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
        : '<!doctype html><html><head><link rel="stylesheet" href="/app.css"><style>body{font-family:sans-serif}button,input,select,textarea{margin:4px}[role=dialog]{background:white;border:1px solid #bbb;position:fixed;inset:8%;overflow:auto;padding:18px;z-index:100;transform:none}table{border-collapse:collapse}td,th{padding:8px;border:1px solid #ddd}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
    );
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((closed) => server.close(() => closed()));
  if (directory) await rm(directory, { recursive: true, force: true });
});
test.beforeEach(({ page }) => {
  pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
});
test.afterEach(() => expect(pageErrors).toEqual([]));

async function mount(page: Page, mock: MockState) {
  await page.addInitScript((config) => Object.assign(window, { labConfig: config }), { planner });
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/api/workspaces/test/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.split("/lab/")[1] ?? "";
    if (request.method() === "GET") {
      if (path === "finance/overview/") {
        ++mock.overviewReads;
        await route.fulfill({ json: mock.data });
        return;
      }
      if (["bounties/budgets/", "stages/", "bounties/", "inbox/"].includes(path)) {
        if (path === "stages/" && mock.marketError) {
          await route.fulfill({ status: 503, json: { error: mock.marketError } });
          return;
        }
        await route.fulfill({ json: [] });
        return;
      }
    }
    if (request.method() === "POST" && path === "finance/receipt/") {
      const body = request.postDataJSON() as Body;
      mock.receipts.push(body);
      mock.data.batches.push(batch(body.source === "第二笔合作到账"));
      updateFunding(mock);
      await route.fulfill({ json: { id: mock.data.batches.at(-1)!.id } });
      return;
    }
    const restoration = /^finance\/(stage|project)-restore\/$/.exec(path);
    if (request.method() === "POST" && restoration) {
      const kind = restoration[1] as "stage" | "project";
      const body = request.postDataJSON() as Body;
      mock.restorations.push({ kind, body });
      if (kind === "stage") {
        const row = mock.data.stages.find((candidate) => candidate.stage_id === body.stage_id)!;
        row.deleted = false;
        row.can_delete = row.can_manage;
        row.can_restore = false;
        row.delete_reason = null;
      } else {
        const row = mock.data.projects.find((candidate) => candidate.id === body.project_id)!;
        row.deleted = false;
        row.finance_deleted = false;
        row.can_delete = row.can_manage;
        row.can_restore = false;
        row.delete_reason = null;
      }
      await route.fulfill({ json: { id: body.stage_id ?? body.project_id } });
      return;
    }
    const deletion = /^finance\/(receipt|stage|project)-delete\/$/.exec(path);
    if (request.method() === "POST" && deletion) {
      const kind = deletion[1] as DeletionKind;
      const body = request.postDataJSON() as Body;
      mock.deletions.push({ kind, body });
      if (mock.reject[kind]) {
        await route.fulfill({ status: 400, json: { error: mock.reject[kind] } });
        return;
      }
      if (kind === "receipt") {
        const row = mock.data.batches.find((candidate) => candidate.id === body.batch_id)!;
        row.reversed = true;
        row.can_delete = false;
        row.delete_reason = "到账记录已删除";
        updateFunding(mock);
      } else if (kind === "stage") {
        const row = mock.data.stages.find((candidate) => candidate.stage_id === body.stage_id)!;
        row.deleted = true;
        row.can_delete = false;
        row.can_restore = row.can_manage;
        row.delete_reason = "阶段预算已删除";
      } else {
        const row = mock.data.projects.find((candidate) => candidate.id === body.project_id)!;
        row.deleted = true;
        row.finance_deleted = true;
        row.can_delete = false;
        row.can_restore = row.can_manage;
        row.delete_reason = "资金项目已删除";
      }
      await route.fulfill({ json: { id: body.batch_id ?? body.stage_id ?? body.project_id } });
      return;
    }
    mock.unexpected.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.fulfill({ status: 404, json: { error: "未预期的 API" } });
  });
  await page.goto(origin);
  await expect(page.getByRole("region", { name: "真实到账批次" })).toBeVisible();
}

function receiptRow(page: Page, second = false) {
  return page
    .getByRole("region", { name: "真实到账批次" })
    .getByRole("row")
    .filter({ hasText: second ? "第二笔合作到账" : "第一笔合作到账" });
}
function stageCard(page: Page, id = emptyStageId) {
  return page
    .getByRole("region", { name: "冻结阶段预算" })
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: id === emptyStageId ? "探索阶段" : "第一阶段", exact: true }) });
}
async function summary(page: Page, count: number, gross: string, D: string) {
  const totals = page.getByLabel("到账汇总");
  await Promise.all(
    [
      ["到账笔数", `${count} 笔`],
      ["累计到账", `¥${gross}`],
      ["累计核准 D", `¥${D}`],
    ].map(([label, value]) =>
      expect(totals.getByText(label!, { exact: true }).locator("..").locator("dd")).toHaveText(value!)
    )
  );
}
async function registerReceipt(page: Page, second = false) {
  await page.getByRole("button", { name: "登记一笔到账", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "登记真实到账", exact: true });
  await dialog.getByLabel("阶段", { exact: true }).selectOption(stageId);
  await dialog.getByLabel("本次真实到账（元）", { exact: true }).fill(second ? "2000.00" : "1000.00");
  await dialog.getByLabel("本次成本扣除（元）", { exact: true }).fill("100.00");
  await dialog.getByLabel("本次核准可分配 D（元）", { exact: true }).fill(second ? "1900.00" : "900.00");
  await dialog.getByLabel("到账来源", { exact: true }).fill(second ? "第二笔合作到账" : "第一笔合作到账");
  await dialog.getByLabel("操作／核准依据", { exact: true }).fill("确认本次实际到账及可分配金额");
  await dialog.getByLabel("凭证或证据引用", { exact: true }).fill(second ? "receipt-002.pdf" : "receipt-001.pdf");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function fillDeletion(dialog: Locator, reason = "重复登记，更正此笔到账") {
  await dialog.getByLabel("删除原因", { exact: true }).fill(reason);
}
function expectRequestKey(body: Body) {
  expect(body.request_key).toEqual(expect.stringMatching(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i));
}

test("two separate receipts accumulate and deleting one preserves the other and its audit row", async ({ page }) => {
  const mock = state();
  await mount(page, mock);
  await summary(page, 0, "0.00", "0.00");
  await registerReceipt(page);
  await summary(page, 1, "1000.00", "900.00");
  await registerReceipt(page, true);
  await summary(page, 2, "3000.00", "2800.00");
  expect(mock.receipts).toHaveLength(2);
  expect(mock.receipts[0]).toMatchObject({
    stage_id: stageId,
    gross: "1000.00",
    costs: "100.00",
    D: "900.00",
    source: "第一笔合作到账",
    evidence: "receipt-001.pdf",
  });
  expect(mock.receipts[1]).toMatchObject({
    stage_id: stageId,
    gross: "2000.00",
    costs: "100.00",
    D: "1900.00",
    source: "第二笔合作到账",
    evidence: "receipt-002.pdf",
  });
  for (const body of mock.receipts) expectRequestKey(body);
  expect(mock.receipts[0]!.request_key).not.toBe(mock.receipts[1]!.request_key);

  await receiptRow(page).getByRole("button", { name: "删除到账记录", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "删除到账记录", exact: true });
  await expect(dialog).toContainText("第一笔合作到账 · ¥1000.00");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(mock.deletions).toHaveLength(0);
  await summary(page, 2, "3000.00", "2800.00");

  const reads = mock.overviewReads;
  await receiptRow(page).getByRole("button", { name: "删除到账记录", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "删除到账记录", exact: true });
  await fillDeletion(dialog);
  await dialog.getByLabel("凭证", { exact: true }).fill("correction-001.pdf");
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await summary(page, 1, "2000.00", "1900.00");
  await expect(receiptRow(page)).toHaveCount(0);
  await expect(receiptRow(page, true).getByRole("cell").nth(1)).toHaveText("¥2000.00");
  await expect(receiptRow(page, true).getByRole("cell").nth(3)).toHaveText("¥1900.00");
  const account = page
    .getByRole("region", { name: "可见账户明细" })
    .getByRole("row")
    .filter({ hasText: "第一阶段执行奖励" });
  await expect(account.getByRole("cell").nth(2)).toHaveText("¥1330.00");
  expect(mock.overviewReads).toBeGreaterThan(reads);
  expect(mock.deletions).toHaveLength(1);
  expect(mock.deletions[0]).toMatchObject({
    kind: "receipt",
    body: { batch_id: firstBatchId, reason: "重复登记，更正此笔到账", evidence: "correction-001.pdf" },
  });
  expectRequestKey(mock.deletions[0]!.body);

  await page.getByRole("checkbox", { name: "显示已删除记录", exact: true }).check();
  await expect(receiptRow(page)).toContainText("已删除");
  await expect(receiptRow(page).getByRole("button", { name: "删除到账记录", exact: true })).toHaveCount(0);
  await expect(receiptRow(page, true).getByRole("button", { name: "删除到账记录", exact: true })).toBeVisible();
  await summary(page, 1, "2000.00", "1900.00");
  expect(mock.unexpected).toEqual([]);
});

test("a rejected receipt deletion retains the amount and entered form, and retry reuses its request key", async ({
  page,
}) => {
  const mock = state(true);
  mock.reject.receipt = "该到账批次已有支付安排，不能删除";
  await mount(page, mock);
  await receiptRow(page).getByRole("button", { name: "删除到账记录", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除到账记录", exact: true });
  await fillDeletion(dialog, "核对原始到账后更正");
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(mock.reject.receipt);
  await expect(dialog.getByLabel("删除原因", { exact: true })).toHaveValue("核对原始到账后更正");
  await expect(page.getByLabel("到账汇总")).toContainText("¥3000.00");
  expect(mock.data.batches.every((row) => !row.reversed)).toBe(true);
  expect(mock.deletions).toHaveLength(1);
  mock.reject.receipt = undefined;
  mock.marketError = "阶段资料暂时不可读取";
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("删除已完成，刷新记录失败：阶段资料暂时不可读取");
  await expect(dialog.getByLabel("删除原因", { exact: true })).toHaveAttribute("readonly", "");
  expect(mock.deletions).toHaveLength(2);
  mock.marketError = undefined;
  await dialog.getByRole("button", { name: "刷新记录", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await summary(page, 1, "2000.00", "1900.00");
  expect(mock.deletions).toHaveLength(2);
  expect(mock.deletions[1]!.body).toEqual(mock.deletions[0]!.body);
  expect(mock.unexpected).toEqual([]);
});

test("opening reserve balances remain distinct from new receipts and have no receipt deletion entrance", async ({
  page,
}) => {
  const mock = state(true);
  mock.data.batches.push(
    Object.assign(batch(), {
      id: "77777777-7777-4777-8777-777777777777",
      kind: "opening" as const,
      operation_id: "operation-opening",
      source: "期初风险准备金",
      gross: "9999.00",
      costs: "0.00",
      D: "0.00",
      risk: "9999.00",
      risk_remaining: "9999.00",
      execution: "0.00",
      can_delete: false,
      delete_reason: "期初余额不能作为到账记录删除",
    })
  );
  await mount(page, mock);
  await summary(page, 2, "3000.00", "2800.00");
  const row = page.getByRole("region", { name: "真实到账批次" }).getByRole("row").filter({ hasText: "期初风险准备金" });
  await expect(row).toBeVisible();
  await expect(row.getByRole("button", { name: "删除到账记录", exact: true })).toHaveCount(0);
  await expect(row.getByRole("button", { name: "释放原批次风险金", exact: true })).toBeVisible();
  expect(mock.deletions).toHaveLength(0);
  expect(mock.unexpected).toEqual([]);
});

test("read-only members can inspect receipts and budgets without registration or deletion entrances", async ({
  page,
}) => {
  const mock = state(true, false);
  await mount(page, mock);
  await summary(page, 2, "3000.00", "2800.00");
  await expect(page.getByRole("button", { name: "登记一笔到账", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "删除到账记录", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "删除资金项目", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "预算与参考预测", exact: true }).click();
  await expect(stageCard(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "删除阶段预算", exact: true })).toHaveCount(0);
  expect(mock.receipts).toHaveLength(0);
  expect(mock.deletions).toHaveLength(0);
  expect(mock.unexpected).toEqual([]);
});

test("stage budget deletion supports cancellation, rejection, logical removal and explicit restoration", async ({
  page,
}) => {
  const mock = state(true);
  await mount(page, mock);
  await page.getByRole("button", { name: "预算与参考预测", exact: true }).click();
  await stageCard(page).getByRole("button", { name: "删除阶段预算", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "删除阶段预算", exact: true });
  await expect(dialog).toContainText("探索阶段 · ¥500.00");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(mock.deletions).toHaveLength(0);
  await expect(stageCard(page)).toBeVisible();

  mock.reject.stage = "阶段仍有未完成悬赏，不能删除";
  await stageCard(page).getByRole("button", { name: "删除阶段预算", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "删除阶段预算", exact: true });
  await fillDeletion(dialog, "取消尚未执行的探索预算");
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(mock.reject.stage);
  await expect(dialog.getByLabel("删除原因", { exact: true })).toHaveValue("取消尚未执行的探索预算");
  expect(mock.data.stages.find((row) => row.stage_id === emptyStageId)!.deleted).toBe(false);
  mock.reject.stage = undefined;
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(stageCard(page)).toHaveCount(0);
  await expect(stageCard(page, stageId)).toBeVisible();
  expect(mock.deletions[0]).toMatchObject({
    kind: "stage",
    body: { stage_id: emptyStageId, reason: "取消尚未执行的探索预算" },
  });
  expect(mock.deletions[1]!.body).toEqual(mock.deletions[0]!.body);
  await page.getByRole("checkbox", { name: "显示已删除记录", exact: true }).check();
  await expect(stageCard(page)).toContainText("已删除");
  await expect(stageCard(page).getByRole("button", { name: "删除阶段预算", exact: true })).toHaveCount(0);
  await stageCard(page).getByRole("button", { name: "恢复阶段预算", exact: true }).click();
  const restoration = page.getByRole("dialog", { name: "恢复阶段预算", exact: true });
  await restoration.getByLabel("操作／核准依据", { exact: true }).fill("恢复探索阶段预算");
  await restoration.getByRole("button", { name: "保存", exact: true }).click();
  await expect(restoration).toHaveCount(0);
  await expect(stageCard(page).getByRole("button", { name: "删除阶段预算", exact: true })).toBeVisible();
  await expect(stageCard(page).getByRole("button", { name: "恢复阶段预算", exact: true })).toHaveCount(0);
  expect(mock.restorations).toHaveLength(1);
  expect(mock.restorations[0]).toMatchObject({
    kind: "stage",
    body: { stage_id: emptyStageId, reason: "恢复探索阶段预算" },
  });
  expectRequestKey(mock.restorations[0]!.body);
  expect(mock.receipts).toHaveLength(0);
  expect(mock.data.batches).toHaveLength(2);
  await page.getByRole("button", { name: "真实余额与到账", exact: true }).click();
  await summary(page, 2, "3000.00", "2800.00");
  expect(mock.unexpected).toEqual([]);
});

test("finance project deletion supports cancellation, rejection and explicit restoration of its configuration", async ({
  page,
}) => {
  const mock = state();
  await mount(page, mock);
  await page.getByRole("button", { name: "删除资金项目", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "删除资金项目", exact: true });
  await expect(dialog).toContainText("声学实验");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  expect(mock.deletions).toHaveLength(0);
  await expect(page.getByLabel("资金项目", { exact: true })).toHaveValue(projectId);

  mock.reject.project = "项目存在未结清核准，不能删除";
  await page.getByRole("button", { name: "删除资金项目", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "删除资金项目", exact: true });
  await fillDeletion(dialog, "撤销未使用的资金项目配置");
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(mock.reject.project);
  await expect(dialog.getByLabel("删除原因", { exact: true })).toHaveValue("撤销未使用的资金项目配置");
  expect(mock.data.projects[0]!.deleted).toBe(false);
  mock.reject.project = undefined;
  await dialog.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("资金项目", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("资金项目", { exact: true }).locator(`option[value="${projectId}"]`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "删除资金项目", exact: true })).toHaveCount(0);
  expect(mock.deletions[0]).toMatchObject({
    kind: "project",
    body: { project_id: projectId, reason: "撤销未使用的资金项目配置" },
  });
  expect(mock.deletions[1]!.body).toEqual(mock.deletions[0]!.body);
  await page.getByRole("checkbox", { name: "显示已删除记录", exact: true }).check();
  await expect(page.getByLabel("资金项目", { exact: true }).locator(`option[value="${projectId}"]`)).toHaveText(
    "声学实验 · 已删除"
  );
  await page.getByLabel("资金项目", { exact: true }).selectOption(projectId);
  await expect(page.getByRole("button", { name: "恢复资金项目", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "删除资金项目", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "恢复资金项目", exact: true }).click();
  const restoration = page.getByRole("dialog", { name: "恢复资金项目", exact: true });
  await restoration.getByLabel("操作／核准依据", { exact: true }).fill("重新启用资金项目配置");
  await restoration.getByRole("button", { name: "保存", exact: true }).click();
  await expect(restoration).toHaveCount(0);
  await expect(page.getByLabel("资金项目", { exact: true })).toHaveValue(projectId);
  await expect(page.getByRole("button", { name: "删除资金项目", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复资金项目", exact: true })).toHaveCount(0);
  expect(mock.restorations).toHaveLength(1);
  expect(mock.restorations[0]).toMatchObject({
    kind: "project",
    body: { project_id: projectId, reason: "重新启用资金项目配置" },
  });
  expectRequestKey(mock.restorations[0]!.body);
  expect(mock.receipts).toHaveLength(0);
  expect(mock.data.batches).toHaveLength(0);
  await summary(page, 0, "0.00", "0.00");
  expect(mock.unexpected).toEqual([]);
});

test("known stage and project financial dependencies show the specific refusal before any delete request", async ({
  page,
}) => {
  const mock = state(true);
  const stageReason = "阶段已有资金使用，不能删除";
  const projectReason = "项目存在未完成悬赏，不能删除";
  mock.data.stages.find((row) => row.stage_id === stageId)!.delete_reason = stageReason;
  mock.data.stages.find((row) => row.stage_id === stageId)!.can_delete = false;
  mock.data.projects[0]!.delete_reason = projectReason;
  mock.data.projects[0]!.can_delete = false;
  await mount(page, mock);
  await page.getByRole("button", { name: "删除资金项目", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "删除资金项目", exact: true });
  await expect(dialog.getByRole("alert")).toHaveText(projectReason);
  await expect(dialog.getByRole("button", { name: "确认删除", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "预算与参考预测", exact: true }).click();
  await stageCard(page, stageId).getByRole("button", { name: "删除阶段预算", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "删除阶段预算", exact: true });
  await expect(dialog.getByRole("alert")).toHaveText(stageReason);
  await expect(dialog.getByRole("button", { name: "确认删除", exact: true })).toBeDisabled();
  expect(mock.deletions).toHaveLength(0);
  expect(mock.unexpected).toEqual([]);
});
