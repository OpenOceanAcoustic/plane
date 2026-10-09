/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function compose(args: string[], input?: string): string {
  const directory = process.env.LAB_E2E_DIRECTORY;
  if (process.env.LAB_E2E_PROJECT !== "ooa-plane-e2e" || !directory)
    throw new Error("Financial checks require isolated services and private configuration");
  return execFileSync(
    "docker",
    [
      "compose",
      "-p",
      "ooa-plane-e2e",
      "--env-file",
      resolve(directory, "root.env"),
      "-f",
      "compose.lab.yml",
      "-f",
      "compose.lab-e2e.yml",
      ...args,
    ],
    { encoding: "utf8", input }
  );
}
function code(uri: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("Test enrollment is missing its secret");
  const bits = Array.from(secret, (character) => alphabet.indexOf(character).toString(2).padStart(5, "0")).join("");
  const bytes = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
      Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)
    )
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  return String((digest.readUInt32BE(digest[19]! & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}

test("live cash and VC limits warn before submission, shared reviewers complete major work and flow stays readable", async ({
  page,
}) => {
  const exists = compose([
    "exec",
    "-T",
    "api",
    "python",
    "manage.py",
    "shell",
    "-c",
    "from plane.db.models import User; print(User.objects.filter(username='e2e-live-finance-admin').exists())",
  ])
    .trim()
    .endsWith("True");
  const args = exists
    ? ["reset", "--username", "e2e-live-finance-admin"]
    : ["bootstrap", "--workspace", "browser-money-lab"];
  const invitation = compose(["exec", "-T", "api", "python", "manage.py", "lab_access", ...args])
    .trim()
    .split("\n")
    .at(-1)!;
  try {
    await page.goto(invitation);
  } catch {
    throw new Error("Could not open isolated registration");
  }
  await page.getByLabel("用户名", { exact: true }).fill("e2e-live-finance-admin");
  await page.getByLabel("显示姓名", { exact: true }).fill("实时财务验收");
  await page.getByLabel("联系邮箱", { exact: true }).fill("live-finance@example.org");
  await page.getByRole("button", { name: "开始绑定", exact: true }).click();
  await page.getByText("无法扫码？查看本地绑定地址", { exact: true }).click();
  const uri = (await page.locator("details p").textContent())!;
  await page.getByLabel("六位动态码", { exact: true }).fill(code(uri));
  await page.getByRole("button", { name: "确认绑定", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("绑定成功");
  const output = compose(
    ["exec", "-T", "api", "python", "manage.py", "shell"],
    readFileSync("tools/lab/e2e/seed-live-finance.py", "utf8")
  );
  const fixture = JSON.parse(
    output
      .trim()
      .split("\n")
      .findLast((line) => line.startsWith("{"))!
  ) as {
    project: string;
    issue: string;
    lead: string;
    account: string;
    member: string;
  };
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 300);
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("e2e-live-finance-admin");
  await page.getByLabel("六位动态码", { exact: true }).fill(code(uri));
  const home = page.waitForURL(/\/browser-money-lab(?:\/|$)/, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await home;
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (!/^Minified React error #(418|423);/.test(error.message)) errors.push(error.message);
  });
  const base = "/api/workspaces/browser-money-lab/lab/";
  const mutations: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes(base)) mutations.push(request.url());
  });

  await page.goto(`/browser-money-lab/lab/finance?project_id=${fixture.project}`);
  await page.getByLabel("办理资金事项", { exact: true }).selectOption("expense");
  let dialog = page.getByRole("dialog", { name: "登记实际支出", exact: true });
  await dialog.getByLabel("支出账户", { exact: true }).selectOption(fixture.account);
  const expense = dialog.getByLabel("实际支出（元）", { exact: true });
  const beforeExpense = mutations.length;
  await expense.fill("12.51");
  await expect(expense).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toContainText("12.50");
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  expect(mutations).toHaveLength(beforeExpense);
  await expense.fill("3.25");
  await expect(expense).not.toHaveAttribute("aria-invalid", "true");
  await dialog.getByLabel("用途／公共职责依据", { exact: true }).fill("真实支出输入验证");
  await dialog.getByLabel("操作／核准依据", { exact: true }).fill("隔离金额实时核验");
  await dialog.getByLabel("凭证或证据引用", { exact: true }).fill("E2E-EXPENSE");
  const paid = page.waitForResponse(
    (response) => response.url().endsWith("/finance/expense/") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  expect((await paid).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  const funds = await page.request.get(`${base}finance/overview/?project_id=${fixture.project}`);
  expect(funds.status()).toBe(200);
  expect(
    ((await funds.json()) as { accounts: { id: string; available: string }[] }).accounts.find(
      (row) => row.id === fixture.account
    )?.available
  ).toBe("9.25");

  await page.goto("/browser-money-lab/lab/bounties");
  await page.getByRole("button", { name: "发布悬赏", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "发布悬赏", exact: true });
  await dialog.getByLabel("项目", { exact: true }).selectOption(fixture.project);
  await dialog.getByLabel("工作项", { exact: true }).selectOption(fixture.issue);
  const quota = dialog.getByLabel("VC配额", { exact: true });
  const beforePublish = mutations.length;
  await quota.fill("100.01");
  await expect(quota).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toContainText("100.00");
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
  expect(mutations).toHaveLength(beforePublish);
  await quota.fill("25");
  await dialog.getByLabel("任务资料", { exact: true }).fill("实时预算与角色验证资料");
  await dialog.getByLabel("交付要求", { exact: true }).fill("独立成员交付实验报告");
  await dialog.getByLabel("验收标准", { exact: true }).fill("实测结果可以复验");
  await dialog.getByLabel("验收人", { exact: true }).selectOption(fixture.lead);
  await dialog.getByLabel("复核人", { exact: true }).selectOption(fixture.lead);
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/lab/bounties/") && response.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const bounty = ((await response.json()) as { id: string }).id;
  await page.goto(`/browser-money-lab/lab/bounties?bounty_id=${bounty}`);
  const workflowResponse = await page.request.get(`${base}bounties/${bounty}/workflow/`);
  expect(workflowResponse.status()).toBe(200);
  const workflow = (await workflowResponse.json()) as { nodes: { id: string }[]; edges: { id: string }[] };
  await page.getByRole("button", { name: "查看流程图", exact: true }).click();
  const flow = page.getByRole("region", { name: "悬赏流程图", exact: true });
  await expect(flow).toBeVisible();
  await expect(flow.locator(".react-flow__node")).toHaveCount(workflow.nodes.length);
  const reducedEdges = await flow.locator(".react-flow__edge").count();
  expect(reducedEdges).toBeLessThan(workflow.edges.length);
  await flow.getByRole("button", { name: "全部流转", exact: true }).click();
  await expect(flow.locator(".react-flow__edge")).toHaveCount(workflow.edges.length);
  await flow.getByRole("button", { name: "主流程", exact: true }).click();
  await expect(flow.locator(".react-flow__edge")).toHaveCount(reducedEdges);
  await flow.getByRole("button", { name: "复核发布", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "复核发布", exact: true });
  await dialog.getByLabel("处理意见", { exact: true }).fill("同一负责人确认发布材料");
  const checked = page.waitForResponse(
    (item) => item.url().endsWith("/publication-review/") && item.request().method() === "POST"
  );
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  expect((await checked).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  const published = await page.request.get(`${base}bounties/${bounty}/detail/`);
  expect(published.status()).toBe(200);
  expect(((await published.json()) as { status: string }).status).toBe("open");
  expect(errors).toEqual([]);
});
