/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

const project = process.env.LAB_E2E_PROJECT;
function ssh(args: string[], input?: string): string {
  if (project !== "ooa-plane-e2e") throw new Error("Real browser tests require an isolated ooa-plane-e2e project");
  return execFileSync(
    "docker",
    ["compose", "-p", project, "-f", "compose.lab.yml", "exec", "-T", "api", "python", "manage.py", ...args],
    { encoding: "utf8", input }
  );
}
function dynamicCode(uri: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("Binding address is missing a secret");
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

test("SSH bootstrap, real TOTP login, original task layouts and personal schedule", async ({ page }) => {
  // Keep bearer tokens and provisioning secrets in memory; no traces, screenshots or CLI output.
  const output = ssh(["lab_access", "bootstrap", "--workspace", "browser-lab"]);
  const invitation = output.trim().split("\n").at(-1)!;
  await page.goto(invitation);
  await page.getByLabel("用户名", { exact: true }).fill("e2e-admin");
  await page.getByLabel("显示姓名").fill("浏览器验收管理员");
  await page.getByLabel("联系邮箱").fill("e2e@example.org");
  await page.getByRole("button", { name: "开始绑定", exact: true }).click();
  await page.getByText("无法扫码？查看本地绑定地址", { exact: true }).click();
  const uri = (await page.locator("details p").textContent())!;
  await page.getByLabel("六位动态码").fill(dynamicCode(uri));
  await page.getByRole("button", { name: "确认绑定", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("绑定成功");
  const seededOutput = ssh(["shell"], readFileSync("tools/lab/e2e/seed.py", "utf8"));
  const fixture = JSON.parse(
    seededOutput
      .trim()
      .split("\n")
      .findLast((line) => line.startsWith("{"))!
  ) as { project: string; issue: string };
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 300);
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("E2E-ADMIN");
  await page.getByLabel("六位动态码").fill(dynamicCode(uri));
  const signedIn = page.waitForResponse(
    (response) => response.url().endsWith("/auth/lab/sign-in/") && response.status() === 200
  );
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await signedIn;
  await page.goto("/browser-lab/lab/planner");
  await expect(page.getByRole("heading", { name: "个人规划", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "引用项目任务", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("搜索任务").fill("Original");
  await expect(dialog.getByLabel("选择任务").locator("option")).toHaveCount(2);
  await dialog.getByLabel("选择任务").selectOption(fixture.issue);
  await dialog.getByLabel("文件夹").selectOption({ label: "A" });
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("article").filter({ hasText: "Original project task" })).toBeVisible();
  await page.getByLabel("Original project task状态", { exact: true }).selectOption("active");
  await expect(page.getByLabel("Original project task状态", { exact: true })).toHaveValue("active");
  await page.goto(`/browser-lab/projects/${fixture.project}/issues`);
  await expect(page.getByText("Original project task", { exact: true }).first()).toBeVisible();
  // Assert the native layout changed, not just shared task text.
  const kanban = page.getByRole("button", { name: /看板|Kanban/i }).first();
  await kanban.click();
  await expect(kanban).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Original project task", { exact: true }).first()).toBeVisible();
  const gantt = page.getByRole("button", { name: /甘特|Gantt/i }).first();
  await gantt.click();
  await expect(gantt).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#gantt-container")).toBeVisible();
  await expect(page.getByText("Original project task", { exact: true }).first()).toBeVisible();
  await page.goto("/browser-lab/lab/planner");
  await page.getByRole("button", { name: "个人事项", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("事项名称").fill("科研学习排期");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "安排科研学习排期", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: "个人周历", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^科研学习排期 / }).first()).toBeVisible();
  // Public bootstrap endpoints cannot recreate an administrator after the SSH invitation was consumed.
  expect((await page.request.post("/api/instances/admins/sign-up/", { data: {} })).status()).toBe(403);
});
