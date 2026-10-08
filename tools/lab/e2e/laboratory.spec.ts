/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { verifyDocumentsWorkflow } from "./documents-workflow";
import { verifyFieldsAndGantt } from "./fields-gantt";
import { verifyAnalytics } from "./analytics";

const project = process.env.LAB_E2E_PROJECT;
function milestone(label: string): void {
  // Static labels only: invitation fragments and Authenticator URIs never enter output.
  process.stdout.write(`[lab-e2e] ${label}\n`);
}
function compose(args: string[], input?: string): string {
  if (project !== "ooa-plane-e2e") throw new Error("Real browser tests require an isolated ooa-plane-e2e project");
  return execFileSync("docker", ["compose", "-p", project, "-f", "compose.lab.yml", ...args], {
    encoding: "utf8",
    input,
  });
}
function ssh(args: string[], input?: string): string {
  return compose(["exec", "-T", "api", "python", "manage.py", ...args], input);
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

test("SSH bootstrap, TOTP login, project cover upload, original layouts and personal schedule", async ({ page }) => {
  test.setTimeout(420000);
  // Keep bearer tokens and provisioning secrets in memory; no traces, screenshots or CLI output.
  if (project !== "ooa-plane-e2e") throw new Error("SSH bootstrap requires an isolated ooa-plane-e2e project");
  const output = execFileSync("sh", [resolve("backend.sh"), "bootstrap", "--workspace", "browser-lab"], {
    cwd: tmpdir(),
    env: { ...process.env, LAB_COMPOSE_PROJECT: project },
    encoding: "utf8",
  });
  const invitation = output.trim().split("\n").at(-1)!;
  try {
    await page.goto(invitation);
  } catch {
    throw new Error("Could not open the registration page; check the isolated test service address");
  }
  await page.getByLabel("用户名", { exact: true }).fill("e2e-admin");
  await page.getByLabel("显示姓名").fill("浏览器验收管理员");
  await page.getByLabel("联系邮箱").fill("e2e@example.org");
  await page.getByRole("button", { name: "开始绑定", exact: true }).click();
  await page.getByText("无法扫码？查看本地绑定地址", { exact: true }).click();
  const uri = (await page.locator("details p").textContent())!;
  await page.getByLabel("六位动态码").fill(dynamicCode(uri));
  await page.getByRole("button", { name: "确认绑定", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("绑定成功");
  milestone("invitation binding confirmed");
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
    (response) => response.url().endsWith("/auth/lab/sign-in/") && response.status() === 200,
    { timeout: 30000 }
  );
  const workspaceHome = page.waitForURL(/\/browser-lab(?:\/|$)/, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await signedIn;
  await workspaceHome;
  milestone("TOTP session authenticated");
  // A default project cover goes through the real signed POST before creation.
  await page.goto("/browser-lab/projects");
  await page.getByRole("button", { name: /^(添加项目|Add Project)$/ }).click();
  const projectDialog = page.getByRole("dialog");
  await projectDialog.locator('input[name="name"]').fill("Uploaded cover project");
  await projectDialog.locator('input[name="identifier"]').fill("COVER");
  const coverUploaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/uploads" && response.request().method() === "POST",
    { timeout: 30000 }
  );
  const projectCreated = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/workspaces/browser-lab/projects/") && response.request().method() === "POST",
    { timeout: 30000 }
  );
  await projectDialog.getByRole("button", { name: /^(创建项目|Create project)$/i }).click();
  expect([200, 201, 204]).toContain((await coverUploaded).status());
  const createdResponse = await projectCreated;
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()) as { id: string };
  await expect(projectDialog.getByRole("link", { name: /^(打开项目|Open project)$/i })).toBeVisible();
  const projectDetail = await page.request.get(`/api/workspaces/browser-lab/projects/${created.id}/`);
  expect(projectDetail.status()).toBe(200);
  const detail = (await projectDetail.json()) as { cover_image_url: string | null };
  expect(detail.cover_image_url).toContain("/api/assets/");
  milestone("native project and cover persisted");
  await page.goto("/browser-lab/lab/planner");
  await expect(page.getByRole("heading", { name: "个人规划", exact: true })).toBeVisible();
  // Keyboard sorting persists, using the same accessible handle as pointer dragging.
  const foldersSorted = page.waitForResponse(
    (response) => response.url().endsWith("/lab/folders/") && response.request().method() === "PUT",
    { timeout: 30000 }
  );
  const folderHandle = page.getByRole("button", { name: "拖动排序文件夹 A", exact: true });
  await folderHandle.focus();
  await page.keyboard.press("Space");
  await expect(folderHandle).toHaveAttribute("aria-pressed", "true");
  // The sensor attaches its keyboard listener and measures droppable tabs after
  // activation. Wait for layout frames before sending the synthetic next key.
  await page.evaluate(
    () =>
      new Promise<void>((ready) => {
        requestAnimationFrame(() => requestAnimationFrame(() => ready()));
      })
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText("移动到B", { exact: true })).toHaveCount(1);
  await page.keyboard.press("Space");
  expect((await foldersSorted).status()).toBe(200);
  const orderedPlanner = await (await page.request.get("/api/workspaces/browser-lab/lab/planner/")).json();
  expect(orderedPlanner.folders.map((folder: { name: string }) => folder.name)).toEqual(["B", "A", "C", "D"]);
  milestone("folder keyboard ordering persisted");
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
  const source = await page.getByRole("button", { name: "拖动 Original project task", exact: true }).boundingBox();
  const target = await page.getByRole("button", { name: "拖动排序文件夹 B", exact: true }).boundingBox();
  expect(source).not.toBeNull();
  expect(target).not.toBeNull();
  const movedFolder = page.waitForResponse(
    (response) => response.url().includes("/lab/items/") && response.request().method() === "PATCH",
    { timeout: 30000 }
  );
  await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 15 });
  await page.mouse.up();
  expect((await movedFolder).status()).toBe(200);
  const movedPlanner = await (await page.request.get("/api/workspaces/browser-lab/lab/planner/")).json();
  expect(movedPlanner.items[0].folder_id).toBe(
    movedPlanner.folders.find((folder: { name: string }) => folder.name === "B").id
  );
  await page.getByLabel("B 文件夹操作", { exact: true }).click();
  await page.getByRole("button", { name: "改名", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("研究 B");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: "拖动排序文件夹 研究 B", exact: true })).toBeVisible();
  await page.getByLabel("研究 B 文件夹操作", { exact: true }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.getByRole("button", { name: "拖动排序文件夹 研究 B", exact: true })).toHaveCount(0);
  await expect(page.locator("article").filter({ hasText: "Original project task" })).toBeVisible();
  milestone("task reference, pointer move and folder deletion verified");
  await page.goto(`/browser-lab/projects/${fixture.project}/issues`);
  await expect(page.getByText("Original project task", { exact: true }).first()).toBeVisible();
  // Assert the native layout changed, not just shared task text.
  const kanban = page.getByRole("button", { name: /看板|Kanban/i }).first();
  await kanban.click();
  await expect(kanban).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Original project task", { exact: true }).first()).toBeVisible();
  const gantt = page.getByRole("button", { name: /时间线|Timeline|甘特|Gantt/i }).first();
  await gantt.click();
  await expect(gantt).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("lab-project-gantt")).toBeVisible();
  await expect(page.getByText("Original project task", { exact: true }).first()).toBeVisible();
  milestone("native kanban and gantt loaded");
  await page.goto("/browser-lab/lab/planner");
  await page.getByRole("button", { name: "个人事项", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("事项名称").fill("科研学习排期");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("button", { name: "安排科研学习排期", exact: true }).click();
  dialog = page.getByRole("dialog");
  const shanghaiDate = await page.evaluate(() => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10));
  await dialog.getByLabel("开始（上海）", { exact: true }).fill(`${shanghaiDate}T09:00`);
  await dialog.getByLabel("结束（上海）", { exact: true }).fill(`${shanghaiDate}T10:00`);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("heading", { name: "个人周历", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^科研学习排期 / }).first()).toBeVisible();
  milestone("personal time block created");
  // Drag and resize save real dates in fifteen-minute increments.
  let calendarEvent = page.getByRole("button", { name: /^科研学习排期 / });
  await calendarEvent.scrollIntoViewIfNeeded();
  let box = await calendarEvent.boundingBox();
  expect(box).not.toBeNull();
  const movedBlock = page.waitForResponse(
    (response) => response.url().includes("/lab/calendar/") && response.request().method() === "PATCH",
    { timeout: 30000 }
  );
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 45, { steps: 12 });
  await page.mouse.up();
  const moveResponse = await movedBlock;
  expect(moveResponse.status()).toBe(200);
  const moveBody = moveResponse.request().postDataJSON() as { start: string; end: string };
  expect(new Date(moveBody.start).getTime() % 900000).toBe(0);
  expect(new Date(moveBody.end).getTime() - new Date(moveBody.start).getTime()).toBe(3600000);
  milestone("calendar pointer move persisted");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  calendarEvent = page.getByRole("button", { name: /^科研学习排期 / });
  // Use the native end handle of pinned FullCalendar 7.1.1. Its transparent
  // hit area extends beyond the event, so guessing the outer bottom can move it.
  const endHandle = calendarEvent.locator(".fc-qd.fc-2I");
  await expect(endHandle).toHaveCSS("cursor", "s-resize");
  await endHandle.scrollIntoViewIfNeeded();
  box = await endHandle.boundingBox();
  expect(box).not.toBeNull();
  const resizedBlock = page.waitForResponse(
    (response) => response.url().includes("/lab/calendar/") && response.request().method() === "PATCH",
    { timeout: 30000 }
  );
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2 + 45, { steps: 12 });
  await page.mouse.up();
  const resizeResponse = await resizedBlock;
  expect(resizeResponse.status()).toBe(200);
  const resizeBody = resizeResponse.request().postDataJSON() as { start: string; end: string };
  expect(new Date(resizeBody.end).getTime() % 900000).toBe(0);
  expect(resizeBody.start).toBe(moveBody.start);
  expect(new Date(resizeBody.end).getTime() - new Date(resizeBody.start).getTime()).toBeGreaterThan(3600000);
  milestone("calendar resize persisted");
  // FullCalendar switches real views and splits the same backend block.
  await page.getByRole("button", { name: "月", exact: true }).click();
  await expect(page.getByRole("button", { name: "月", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "日", exact: true }).click();
  await expect(page.getByRole("button", { name: "日", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "周", exact: true }).click();
  await page
    .getByRole("button", { name: /^科研学习排期 / })
    .first()
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "拆分时间块", exact: true }).click();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("button", { name: /^科研学习排期 / })).toHaveCount(2);
  await page.goto("/browser-lab/lab/team");
  await expect(page.getByRole("button", { name: "人员时间轴", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^科研学习排期 / }).first()).toBeVisible();
  await page.getByRole("button", { name: "人员分列", exact: true }).click();
  await expect(page.getByRole("button", { name: "人员分列", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("combobox", { name: "筛选成员", exact: true }).click();
  await page.getByRole("option", { name: "浏览器验收管理员", exact: true }).click();
  await expect(page.getByRole("button", { name: /^科研学习排期 / }).first()).toBeVisible();
  milestone("calendar split and team resource views verified");
  await verifyFieldsAndGantt(page, fixture);
  milestone("custom fields and gantt dependencies verified");
  await verifyDocumentsWorkflow({ page, fixture });
  milestone("native documents, attachment and bounty flow verified");
  await verifyAnalytics(page, fixture);
  milestone("twelve analytics charts and exports verified");
  // Public bootstrap endpoints cannot recreate an administrator after the SSH invitation was consumed.
  expect((await page.request.post("/api/instances/admins/sign-up/", { data: {} })).status()).toBe(403);
});

for (const path of ["/god-mode/", "/spaces/"]) {
  test(`${path} serves the invitation-only Authenticator entry`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
    await expect(page.getByLabel("六位动态码")).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
  });
}

test("the sixth submission remains limited after the API service restarts", async ({ request }) => {
  // The earlier successful sign-in already used one of this account's five submissions.
  const csrf = (await (await request.get("/auth/get-csrf-token/")).json()) as { csrf_token: string };
  const options = { headers: { "X-CSRFToken": csrf.csrf_token }, data: { username: "E2E-ADMIN", code: "invalid" } };
  const attempts = await Promise.all(Array.from({ length: 4 }, () => request.post("/auth/lab/sign-in/", options)));
  for (const attempt of attempts) expect(attempt.status()).toBe(401);
  compose(["restart", "api"]);
  await expect
    .poll(
      async () => {
        try {
          return (await request.get("/api/instances/")).status();
        } catch {
          return 0;
        }
      },
      { timeout: 45000 }
    )
    .toBe(200);
  const sixth = await request.post("/auth/lab/sign-in/", options);
  expect(sixth.status()).toBe(429);
  expect(Number(sixth.headers()["retry-after"])).toBeGreaterThan(0);
});
