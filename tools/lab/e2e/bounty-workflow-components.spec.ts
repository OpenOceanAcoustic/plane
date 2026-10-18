/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { LabBounty } from "../../../packages/types/src/index";
import type { LabWorkflow } from "../../../apps/web/core/components/lab/workflow-types";

const nodeRows = [
  ["publication", "发布团队任务", 0, 0],
  ["publication_review", "重大发布复核", 250, 0],
  ["claim", "成员认领与批准", 500, 0],
  ["confirm", "本人确认分工", 750, 0],
  ["active", "团队开工", 0, 130],
  ["submit", "提交成果证据", 250, 130],
  ["acceptance", "独立验收", 500, 130],
  ["major_review", "重大验收复核", 750, 130],
  ["done", "完成与 VC 记账", 0, 260],
  ["partial", "部分通过", 250, 260],
  ["rework", "返工", 500, 260],
  ["rejected", "不通过", 750, 260],
  ["cancelled", "取消并释放预算", 250, 390],
  ["reversal", "贡献更正与冲正", 500, 390],
  ["deleted", "删除悬赏", 750, 390],
] as const;
const relations = [
  ["publication", "publication_review"],
  ["publication", "claim"],
  ["publication_review", "claim"],
  ["claim", "confirm"],
  ["confirm", "active"],
  ["active", "submit"],
  ["submit", "acceptance"],
  ["acceptance", "major_review"],
  ["acceptance", "done"],
  ["acceptance", "partial"],
  ["acceptance", "rework"],
  ["acceptance", "rejected"],
  ["major_review", "done"],
  ["major_review", "partial"],
  ["major_review", "rework"],
  ["major_review", "rejected"],
  ["partial", "submit"],
  ["rework", "submit"],
  ["done", "reversal"],
  ["partial", "reversal"],
  ["active", "cancelled"],
  ["claim", "cancelled"],
  ["reversal", "acceptance"],
  ["publication", "deleted"],
  ["active", "deleted"],
  ["done", "deleted"],
] as const;
const spine = [
  "publication",
  "publication_review",
  "claim",
  "confirm",
  "active",
  "submit",
  "acceptance",
  "major_review",
  "done",
];
function workflow(major = true, actions: LabWorkflow["actions"] = []): LabWorkflow {
  const nodes = nodeRows
    .filter(([id]) => major || !["publication_review", "major_review"].includes(id))
    .map(([id, label, x, y]) => ({
      id,
      label,
      x,
      y,
      state: id === "acceptance" ? ("current" as const) : ("completed" as const),
    }));
  const ids = new Set(nodes.map((node) => node.id));
  const edges = relations
    .filter(
      ([source, target]) =>
        ids.has(source) &&
        ids.has(target) &&
        !(major && source === "publication" && target === "claim") &&
        !(major && source === "acceptance" && ["done", "partial", "rework", "rejected"].includes(target))
    )
    .map(([source, target]) => ({ id: `${source}-${target}`, source, target }));
  return {
    bounty_id: "bounty",
    title: "声学样本悬赏",
    status: "review",
    major,
    current_node: "acceptance",
    nodes,
    edges,
    actions,
    history: [
      {
        id: "event",
        label: "贡献冲正",
        node_id: "reversal",
        actor: "负责人",
        created_at: "2026-10-09T08:00:00Z",
        reason: "样本质量复核",
        result: null,
      },
    ],
  };
}
const bounty = {
  id: "bounty",
  status: "review",
  budget: "10.00",
  awarded: "2.00",
  allocations: [
    {
      id: "allocation-a",
      user_id: "member-a",
      name: "成员甲",
      planned: "6.00",
      awarded: "2.00",
      approved: true,
      confirmed: true,
      closed: false,
    },
    {
      id: "allocation-b",
      user_id: "member-b",
      name: "成员乙",
      planned: "4.00",
      awarded: "0.00",
      approved: true,
      confirmed: true,
      closed: false,
    },
  ],
  acceptances: [],
  evidence: "样本链接",
} as LabBounty;
let server: ReturnType<typeof createServer>;
let origin = "";
let directory = "";
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "lab-bounty-workflow-"));
  const require = createRequire(resolve("apps/web/package.json"));
  const { build } = require("esbuild") as typeof import("esbuild");
  await build({
    stdin: {
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { LabStore } from '${resolve("packages/shared-state/src/lab.store.ts")}'; import { LabBountyWorkflow } from '${resolve("apps/web/core/components/lab/workflow.tsx")}'; const store = new LabStore('', 'test'); store.planner = { user_id: 'member-c', items: [], projects: [{id: window.labBounty.project_id, members: [{id:'reviewer',name:'复核人'}]}] }; function Root(){ const [bounty, setBounty] = React.useState(window.labBounty); Object.assign(window,{setLabBounty:setBounty}); return <LabBountyWorkflow store={store} bounty={bounty} />; } createRoot(document.getElementById('root')).render(<Root />);`,
      resolveDir: resolve("apps/web"),
      loader: "tsx",
      sourcefile: "bounty-workflow-harness.tsx",
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
  if (!globalStyle) throw new Error("The workflow visual fixture requires the current production global stylesheet");
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
          : '<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/app.css"><style>body{font-family:Inter,sans-serif;background:#f7f8fa;padding:24px}#root{max-width:1180px;margin:auto}[role=dialog]{background:white;position:fixed;inset:5%;transform:none;translate:none;overflow:auto;padding:24px;z-index:100}.lab-bounty-flow{height:430px}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
    );
  });
  await new Promise<void>((resolveListening) => server.listen(0, "127.0.0.1", resolveListening));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function mount(
  page: import("@playwright/test").Page,
  data = workflow(),
  customBounty = bounty,
  quoteData?: import("../../../packages/types/src/index").LabBountyQuotes
) {
  page.on("pageerror", (error) => console.error("workflow browser error:", error.message));
  page.on("console", (message) => {
    if (message.type() === "warn" || message.type() === "error") console.error("workflow console:", message.text());
  });
  await page.addInitScript((value) => Object.assign(window, { labBounty: value }), customBounty);
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/lab/bounties/*/workflow/**", (route) => route.fulfill({ json: data }));
  await page.route("**/lab/bounties/*/quotes/", (route) =>
    route.fulfill({
      json: quoteData ?? {
        quotes: [],
        can_apply: customBounty.status === "open",
        available: customBounty.claim_available ?? "10.00",
        reviewers: [],
        file_size_limit: 5242880,
      },
    })
  );
  await page.route("**/lab/stages/", (route) => route.fulfill({ json: [] }));
  await page.route("**/lab/bounties/", (route) => route.fulfill({ json: [customBounty] }));
  await page.route("**/lab/inbox/", (route) => route.fulfill({ json: [] }));
  await page.route("**/lab/planner/", (route) =>
    route.fulfill({ json: { user_id: "member-c", items: [], projects: [] } })
  );
  await page.goto(origin);
  await expect(page.locator(".react-flow__node")).toHaveCount(data.nodes.length);
  await expect(page.locator(".react-flow__edge-path").first()).toHaveAttribute("d", /^M/);
}

for (const major of [false, true]) {
  test(`${major ? "major" : "ordinary"} bounty keeps a straight readable main flow and reveals all original transitions on demand`, async ({
    page,
  }) => {
    const data = workflow(major);
    await mount(page, data);
    const suffix = process.env.LAB_WORKFLOW_SCREENSHOT_SUFFIX ?? "after";
    await page
      .getByRole("region", { name: "悬赏流程图", exact: true })
      .screenshot({ path: `/tmp/lab-bounty-flow-${major ? "major" : "ordinary"}-${suffix}.png` });
    const rows = await page
      .locator(".react-flow__node")
      .evaluateAll(
        (elements, ids) =>
          elements
            .filter((element) => ids.includes(element.getAttribute("data-id") ?? ""))
            .map((element) => element.getBoundingClientRect().top),
        spine
      );
    expect(Math.max(...rows) - Math.min(...rows)).toBeLessThan(2);
    const mainNode = page.locator('.react-flow__node[data-id="claim"]');
    expect((await mainNode.boundingBox())?.width).toBeGreaterThan(80);
    expect(await page.locator(".react-flow__edge").count()).toBeLessThan(data.edges.length);
    await page.getByRole("button", { name: "全部流转", exact: true }).click();
    await expect(page.locator(".react-flow__edge")).toHaveCount(data.edges.length);
    await Promise.all(
      data.edges.map((edge) => expect(page.locator(`.react-flow__edge[data-id="${edge.id}"]`)).toHaveCount(1))
    );
    await page.getByRole("button", { name: "主流程", exact: true }).click();
    await page.locator('.react-flow__node[data-id="reversal"]').click();
    await expect(page.getByText("样本质量复核", { exact: true })).toBeVisible();
    await expect(page.locator('.react-flow__edge[data-id="reversal-acceptance"]')).toHaveCount(1);
    await page.setViewportSize({ width: 860, height: 900 });
    await page.getByRole("button", { name: "查看全部节点", exact: true }).click();
    await page
      .getByRole("region", { name: "悬赏流程图", exact: true })
      .screenshot({ path: `/tmp/lab-bounty-flow-${major ? "major" : "ordinary"}-narrow-${suffix}.png` });
    expect((await mainNode.boundingBox())?.width).toBeGreaterThan(70);
    await expect(page.locator(".react-flow__node")).toHaveCount(data.nodes.length);
  });
}

test("web workflow offers a fixed original price and permits a supported higher quote", async ({ page }) => {
  await mount(page, workflow(false), { ...bounty, status: "open", claim_available: "4.00", allocations: [] });
  await page.getByRole("button", { name: "按原价申请 · 4.00 VC", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "按原价申请", exact: true });
  await expect(dialog.getByLabel("原价（VC）", { exact: true })).toHaveValue("4.00");
  await expect(dialog.getByLabel("原价（VC）", { exact: true })).toHaveAttribute("readonly", "");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "议价申请", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "议价申请", exact: true });
  await dialog.getByLabel("本人交付内容", { exact: true }).fill("新增分析");
  await dialog.getByLabel("报价（VC）", { exact: true }).fill("8");
  await expect(dialog.getByRole("button", { name: "提交申请", exact: true })).toBeDisabled();
  await dialog.getByLabel("报价依据", { exact: true }).fill("工作量增加");
  await expect(dialog.getByRole("button", { name: "提交申请", exact: true })).toBeEnabled();
});

test("acceptance warns immediately for planned and previously awarded bounds and keeps cumulative amounts valid", async ({
  page,
}) => {
  const data = workflow(false, [
    { id: "accept", action: "accept", label: "验收成果", node_id: "acceptance", body: {}, enabled: true, reason: "" },
  ]);
  await mount(page, data);
  await page.getByRole("button", { name: "验收成果", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "验收成果", exact: true });
  const first = dialog.getByLabel("成员甲 累计通过 VC（已授予 2.00／计划 6.00）", { exact: true });
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  await first.fill("6.01");
  await expect(dialog.getByRole("alert").filter({ hasText: "超过可用额度 6.00 VC" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await dialog.getByLabel("验收结果", { exact: true }).selectOption("partial");
  await first.fill("1.99");
  await expect(dialog.getByRole("alert")).toHaveText("不能低于 2.00 VC");
  await first.fill("5.50");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  await dialog.getByLabel("验收结果", { exact: true }).selectOption("rework");
  await expect(first).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
});

test("acceptance also validates the combined cumulative quota when individually valid inputs exceed the task", async ({
  page,
}) => {
  const data = workflow(false, [
    { id: "accept", action: "accept", label: "验收成果", node_id: "acceptance", body: {}, enabled: true, reason: "" },
  ]);
  await mount(page, data, { ...bounty, budget: "9.00" });
  await page.getByRole("button", { name: "验收成果", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "验收成果", exact: true });
  await expect(dialog.getByRole("alert")).toHaveText("累计通过 VC 超过悬赏配额 9.00 VC");
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await dialog.getByLabel("验收结果", { exact: true }).selectOption("partial");
  await dialog.getByLabel("成员甲 累计通过 VC（已授予 2.00／计划 6.00）", { exact: true }).fill("5.00");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
});

function quoteFixture(): import("../../../packages/types/src/index").LabBountyQuotes {
  return {
    can_apply: false,
    available: "20.00",
    funding_source: "project",
    project_available: "980.00",
    quote_limit: "1000.00",
    reviewers: [{ id: "reviewer", name: "复核人" }],
    file_size_limit: 5242880,
    quotes: [
      {
        id: "quote-one",
        user_id: "applicant",
        name: "申请人",
        revision: 1,
        kind: "negotiated",
        vc: "45.00",
        available_at_submission: "20.00",
        deliverable: "完整分析报告",
        basis: "新增分析工作",
        status: "pending",
        created_at: "2026-10-15T05:00:00Z",
        reviewer_id: null,
        allocation_id: null,
        attachments: [],
        history: [],
        budget_snapshot: { budget: "20.00", stage_available: "980.00", allocations: [] },
        adjustment: {
          additional: "25.00",
          next_budget: "45.00",
          source_available: "980.00",
          requires_review: true,
          funded: true,
        },
        can_approve: true,
        can_reject: true,
        can_review: false,
      },
    ],
  };
}

test("original application retains delivery text and refreshes a changed price before retry", async ({ page }) => {
  let requests = 0;
  const quoteData = { ...quoteFixture(), quotes: [], can_apply: true };
  await page.route("**/lab/bounties/bounty/quotes/", (route) => route.fulfill({ json: quoteData }));
  await mount(page, workflow(false), { ...bounty, status: "open" }, quoteData);
  await page.route("**/lab/bounties/bounty/quotes/", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: quoteData });
    const body = route.request().postDataJSON();
    requests++;
    expect(body.deliverable).toBe("需要保留的交付内容");
    if (requests === 1) {
      expect(body.vc).toBe("20.00");
      quoteData.available = "18.00";
      return route.fulfill({ status: 409, json: { detail: "剩余 VC 已变化，请刷新并确认原价" } });
    }
    expect(body.vc).toBe("18.00");
    quoteData.can_apply = false;
    return route.fulfill({ status: 201, json: {} });
  });
  await page.getByRole("button", { name: "按原价申请 · 20.00 VC" }).click();
  const dialog = page.getByRole("dialog", { name: "按原价申请", exact: true });
  await dialog.getByLabel("本人交付内容").fill("需要保留的交付内容");
  await dialog.getByRole("button", { name: "提交申请" }).click();
  await expect(dialog.getByRole("alert")).toContainText("剩余 VC 已变化");
  await expect(dialog.getByLabel("原价（VC）")).toHaveValue("18.00");
  await expect(dialog.getByLabel("本人交付内容")).toHaveValue("需要保留的交付内容");
  await dialog.getByRole("button", { name: "提交申请" }).click();
  await expect(dialog).toHaveCount(0);
  expect(requests).toBe(2);
});

test("file evidence alone permits a quote above the remaining VC and uploads before submission", async ({ page }) => {
  const quoteData = { ...quoteFixture(), quotes: [], can_apply: true };
  let uploaded = false;
  let submitted = false;
  await mount(page, workflow(false), { ...bounty, status: "open" }, quoteData);
  await page.route("**/lab/bounties/bounty/quote-attachments/", async (route) => {
    expect(route.request().postData()).toContain("proof.pdf");
    uploaded = true;
    return route.fulfill({
      status: 201,
      json: { id: "evidence", name: "proof.pdf", size: 10, download_path: "file/" },
    });
  });
  await page.route("**/lab/bounties/bounty/quotes/", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: quoteData });
    expect(uploaded).toBe(true);
    expect(route.request().postDataJSON()).toMatchObject({
      kind: "negotiated",
      vc: "30",
      basis: "",
      attachment_ids: ["evidence"],
    });
    submitted = true;
    quoteData.can_apply = false;
    return route.fulfill({ status: 201, json: {} });
  });
  await page.getByRole("button", { name: "议价申请", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "议价申请", exact: true });
  await dialog.getByLabel("本人交付内容").fill("分析报告");
  await dialog.getByLabel("报价（VC）").fill("30");
  await expect(dialog.getByRole("button", { name: "提交申请" })).toBeDisabled();
  await dialog
    .getByLabel("依据附件")
    .setInputFiles({ name: "proof.pdf", mimeType: "application/pdf", buffer: Buffer.from("proof data") });
  await expect(dialog.getByRole("button", { name: "提交申请" })).toBeEnabled();
  await dialog.getByRole("button", { name: "提交申请" }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted).toBe(true);
});

test("major top-up approval requires a reviewer and sends the displayed budget snapshot", async ({ page }) => {
  const quoteData = quoteFixture();
  let submitted = false;
  await mount(page, workflow(false), { ...bounty, status: "open" }, quoteData);
  await page.route("**/lab/bounties/bounty/quotes/quote-one/approve/", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      reviewer_id: "reviewer",
      expected_budget: quoteData.quotes[0]!.budget_snapshot,
    });
    submitted = true;
    quoteData.quotes[0]!.status = "pending_review";
    quoteData.quotes[0]!.can_approve = false;
    return route.fulfill({ json: quoteData.quotes[0] });
  });
  await page.getByRole("button", { name: "审批报价", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "审批报价", exact: true });
  await expect(dialog.getByText("25.00", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "同意并提交复核" })).toBeDisabled();
  await dialog.getByLabel("加价复核人").selectOption("reviewer");
  await dialog.getByRole("button", { name: "同意并提交复核" }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted).toBe(true);
  await expect(page.getByText(/申请人 · 45.00 VC.*待加价复核/)).toBeVisible();
});

test("rejection requires an opinion and a zero balance still exposes negotiation", async ({ page }) => {
  const quoteData = quoteFixture();
  quoteData.can_apply = true;
  quoteData.available = "0.00";
  await mount(page, workflow(false), { ...bounty, status: "open" }, quoteData);
  await expect(page.getByRole("button", { name: /按原价申请/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "议价申请", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "驳回申请", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "驳回申请", exact: true });
  await expect(dialog.getByRole("button", { name: "确认驳回" })).toBeDisabled();
  await dialog.getByLabel("处理意见").fill("请补充交付范围");
  await expect(dialog.getByRole("button", { name: "确认驳回" })).toBeEnabled();
});

test("live quote approval completes through the browser and real Django API", async ({ browser }) => {
  test.skip(!process.env.LAB_QUOTES_LIVE_FIXTURE, "Run through the Django live-server browser contract");
  const fixture = JSON.parse(await readFile(process.env.LAB_QUOTES_LIVE_FIXTURE!, "utf8")) as {
    server: string;
    base: string;
    bounty_id: string;
    original_vc: string;
    quote_vc: string;
    quote_limit: string | null;
    major: boolean;
    sessions: Record<string, { id: string; cookie: { name: string; value: string } }>;
  };
  const contexts: import("@playwright/test").BrowserContext[] = [];
  async function open(role: string) {
    const context = await browser.newContext();
    contexts.push(context);
    const session = fixture.sessions[role]!;
    await context.addCookies([
      { ...session.cookie, url: fixture.server },
      { ...session.cookie, url: origin },
    ]);
    const response = await context.request.get(`${fixture.server}${fixture.base}bounties/${fixture.bounty_id}/detail/`);
    expect(response.status()).toBe(200);
    const record = await response.json();
    const page = await context.newPage();
    await page.addInitScript((value) => Object.assign(window, { labBounty: value }), record);
    async function proxy(route: import("@playwright/test").Route) {
      const url = new URL(route.request().url());
      const headers: Record<string, string> = {
        ...route.request().headers(),
        origin: fixture.server,
        referer: fixture.server + "/",
      };
      delete headers.host;
      const proxied = await route.fetch({
        url: fixture.server + url.pathname.replace("/api/workspaces/test/lab/", fixture.base) + url.search,
        headers,
      });
      await route.fulfill({ response: proxied });
    }
    await page.route("**/api/**", proxy);
    await page.route("**/auth/**", proxy);
    await page.goto(origin);
    return { context, page };
  }
  try {
    const applicant = await open("member");
    await applicant.page.getByRole("button", { name: "议价申请", exact: true }).click();
    let dialog = applicant.page.getByRole("dialog", { name: "议价申请", exact: true });
    await dialog.getByLabel("本人交付内容").fill("真实端到端分析报告");
    if (fixture.quote_limit) await expect(dialog.getByLabel("报价（VC）")).toHaveAttribute("max", fixture.quote_limit);
    await dialog.getByLabel("报价（VC）").fill(fixture.quote_vc);
    await dialog.getByLabel("依据附件").setInputFiles({
      name: "quote-proof.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("private quote evidence"),
    });
    await dialog.getByRole("button", { name: "提交申请", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(applicant.page.getByText(/第 1 次.*待审批/)).toBeVisible();

    const lead = await open("lead");
    await lead.page.getByRole("button", { name: "审批报价", exact: true }).click();
    dialog = lead.page.getByRole("dialog", { name: "审批报价", exact: true });
    if (fixture.major) {
      await dialog.getByLabel("加价复核人").selectOption(fixture.sessions.independent!.id);
      await dialog.getByRole("button", { name: "同意并提交复核", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      const before = await lead.context.request.get(
        `${fixture.server}${fixture.base}bounties/${fixture.bounty_id}/detail/`
      );
      expect((await before.json()).reserved).toBe(fixture.original_vc);
      const reviewer = await open("independent");
      await reviewer.page.getByRole("button", { name: "复核加价", exact: true }).click();
      dialog = reviewer.page.getByRole("dialog", { name: "复核加价", exact: true });
    } else {
      await expect(dialog.getByLabel("加价复核人")).toHaveCount(0);
    }
    await dialog.getByRole("button", { name: "批准承接", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const final = await lead.context.request.get(
      `${fixture.server}${fixture.base}bounties/${fixture.bounty_id}/detail/`
    );
    const record = await final.json();
    expect(record).toMatchObject({
      budget: fixture.quote_vc,
      reserved: fixture.quote_vc,
      awarded: "0",
      major: fixture.major,
    });
    expect(record.allocations).toHaveLength(1);
    expect(record.allocations[0]).toMatchObject({ planned: fixture.quote_vc, approved: true, confirmed: true });
    const planner = await applicant.context.request.get(`${fixture.server}${fixture.base}planner/`);
    expect((await planner.json()).items.some((item: { issue_id: string }) => item.issue_id === record.issue_id)).toBe(
      true
    );
  } finally {
    await Promise.all(
      contexts.flatMap((context) => context.pages().map((page) => page.unrouteAll({ behavior: "ignoreErrors" })))
    );
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("a 5000 VC bounty accepts a 6000 VC negotiated application", async ({ page }) => {
  const data = {
    ...quoteFixture(),
    available: "5000.00",
    project_available: "5000.00",
    quote_limit: "10000.00",
    funding_source: "project" as const,
    can_apply: true,
    quotes: [],
  };
  await mount(page, workflow(false), { ...bounty, status: "open", budget: "5000.00", allocations: [] }, data);
  let submitted = false;
  await page.route("**/lab/bounties/bounty/quotes/", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: data });
    expect(route.request().postDataJSON()).toMatchObject({ kind: "negotiated", vc: "6000" });
    submitted = true;
    return route.fulfill({ status: 201, json: {} });
  });
  await page.getByRole("button", { name: "议价申请", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "议价申请", exact: true });
  await dialog.getByLabel("本人交付内容").fill("完整交付");
  await dialog.getByLabel("报价依据").fill("补充分析工作");
  await dialog.getByLabel("报价（VC）").fill("10000.01");
  await expect(dialog.getByRole("button", { name: "提交申请" })).toBeDisabled();
  await expect(dialog.getByRole("alert")).toContainText("10000.00");
  await dialog.getByLabel("报价（VC）").fill("6000");
  await expect(dialog.getByRole("button", { name: "提交申请" })).toBeEnabled();
  await dialog.getByRole("button", { name: "提交申请" }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted).toBe(true);
});

test("a changed project ceiling refreshes after rejection and retains the negotiated draft", async ({ page }) => {
  const data = {
    ...quoteFixture(),
    available: "5000.00",
    project_available: "5000.00",
    quote_limit: "10000.00",
    can_apply: true,
    quotes: [],
  };
  await mount(page, workflow(false), { ...bounty, status: "open", budget: "5000.00", allocations: [] }, data);
  let attempts = 0;
  await page.route("**/lab/bounties/bounty/quotes/", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: data });
    attempts += 1;
    if (attempts === 1) {
      data.project_available = "1000.00";
      data.quote_limit = "6000.00";
      return route.fulfill({ status: 409, json: { detail: "项目余额已变化" } });
    }
    expect(route.request().postDataJSON()).toMatchObject({
      vc: "5500",
      deliverable: "补充完整报告",
      basis: "新增工作量",
    });
    return route.fulfill({ status: 201, json: {} });
  });
  await page.getByRole("button", { name: "议价申请", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "议价申请", exact: true });
  await dialog.getByLabel("本人交付内容").fill("补充完整报告");
  await dialog.getByLabel("报价依据").fill("新增工作量");
  await dialog.getByLabel("报价（VC）").fill("7000");
  await dialog.getByRole("button", { name: "提交申请" }).click();
  await expect(dialog.getByLabel("报价（VC）")).toHaveAttribute("max", "6000.00");
  await expect(dialog.getByLabel("报价（VC）")).toHaveValue("7000");
  await expect(dialog.getByRole("button", { name: "提交申请" })).toBeDisabled();
  await dialog.getByLabel("报价（VC）").fill("5500");
  await dialog.getByRole("button", { name: "提交申请" }).click();
  await expect(dialog).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("personal-funded quote approval identifies the publisher balance rather than the project pool", async ({
  page,
}) => {
  const data = quoteFixture();
  data.funding_source = "personal";
  data.project_available = null;
  data.quote_limit = null;
  data.quotes[0]!.budget_snapshot!.funding = "personal";
  data.quotes[0]!.adjustment!.source_available = "0.00";
  data.quotes[0]!.adjustment!.funded = false;
  await mount(page, workflow(false), { ...bounty, status: "open" }, data);
  await page.getByRole("button", { name: "审批报价", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("发布人可用 VC", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("个人可用 VC 不足");
  await expect(dialog.getByRole("button", { name: "同意并提交复核", exact: true })).toBeDisabled();
});

test("publisher changes importance before work starts using the displayed state", async ({ page }) => {
  const record = {
    ...bounty,
    status: "open" as const,
    major: false,
    can_change_importance: true,
    importance_state: { major: false, status: "open", independent_reviewer_id: null },
  };
  await mount(page, workflow(false), record);
  let submitted = false;
  await page.route("**/lab/bounties/bounty/importance/", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({
      major: true,
      independent_reviewer_id: "reviewer",
      expected_state: record.importance_state,
      request_key: expect.any(String),
    });
    submitted = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.getByRole("button", { name: "调整重要级别", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "调整重要级别", exact: true });
  await dialog.getByLabel("重要级别", { exact: true }).selectOption("major");
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await dialog.getByLabel("复核人", { exact: true }).selectOption("reviewer");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(submitted).toBe(true);
});

test("importance adjustment is absent when the server denies editing", async ({ page }) => {
  await mount(page, workflow(false), { ...bounty, can_change_importance: false });
  await expect(page.getByRole("button", { name: "调整重要级别", exact: true })).toHaveCount(0);
});

test("importance changes refresh review nodes even when the open status stays the same", async ({ page }) => {
  const record = { ...bounty, major: true, status: "open" as const };
  await mount(page, workflow(true), record);
  await expect(page.locator('.react-flow__node[data-id="publication_review"]')).toHaveCount(1);
  await page.route("**/lab/bounties/*/workflow/**", (route) => route.fulfill({ json: workflow(false) }));
  await page.evaluate(
    (value) => {
      (window as unknown as { setLabBounty: (record: LabBounty) => void }).setLabBounty(value);
    },
    { ...record, major: false }
  );
  await expect(page.locator('.react-flow__node[data-id="publication_review"]')).toHaveCount(0);
});
