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
      contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { LabStore } from '${resolve("packages/shared-state/src/lab.store.ts")}'; import { LabBountyWorkflow } from '${resolve("apps/web/core/components/lab/workflow.tsx")}'; const store = new LabStore('', 'test'); store.planner = { user_id: 'member-c', items: [], projects: [] }; createRoot(document.getElementById('root')).render(<LabBountyWorkflow store={store} bounty={window.labBounty} />);`,
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
          : '<!doctype html><html data-theme="light"><head><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/app.css"><style>body{font-family:Inter,sans-serif;background:#f7f8fa;padding:24px}#root{max-width:1180px;margin:auto}[role=dialog]{background:white;position:fixed;inset:5%;overflow:auto;padding:24px;z-index:100}.lab-bounty-flow{height:430px}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
    );
  });
  await new Promise<void>((resolveListening) => server.listen(0, "127.0.0.1", resolveListening));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()));
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function mount(page: import("@playwright/test").Page, data = workflow(), customBounty = bounty) {
  page.on("pageerror", (error) => console.error("workflow browser error:", error.message));
  page.on("console", (message) => {
    if (message.type() === "warn" || message.type() === "error") console.error("workflow console:", message.text());
  });
  await page.addInitScript((value) => Object.assign(window, { labBounty: value }), customBounty);
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/lab/bounties/*/workflow/", (route) => route.fulfill({ json: data }));
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

test("claim warns against the current remaining quota before submission, including public summaries", async ({
  page,
}) => {
  const data = workflow(false, [
    { id: "claim", action: "claim", label: "申请认领", node_id: "claim", body: {}, enabled: true, reason: "" },
  ]);
  await mount(page, data, { ...bounty, claim_available: "4.00", allocations: [] });
  await page.getByRole("button", { name: "申请认领", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "申请认领", exact: true });
  await dialog.getByLabel("计划 VC", { exact: true }).fill("4.01");
  await expect(dialog.getByRole("alert")).toHaveText("超过可用额度 4.00 VC");
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await dialog.getByLabel("计划 VC", { exact: true }).fill("4.00");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
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
