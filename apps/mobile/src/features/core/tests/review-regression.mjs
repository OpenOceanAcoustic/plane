import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const mode = process.argv[2] ?? "project";
const fixturePath = process.env.MOBILE_TEST_CREDENTIALS ?? "/mnt/repo/ly/.android-release/test-credentials.json";
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
if (fixture.server !== "http://127.0.0.1:18100") throw new Error("Use the isolated 18100 backend only");
const cookies = JSON.parse(
  fs.readFileSync(
    process.env.MOBILE_TEST_COOKIES ?? path.join(path.dirname(fixturePath), "core-test-browser-cookies.json"),
    "utf8"
  )
);
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
await context.addCookies(cookies);
const page = await context.newPage();
const origin = process.env.MOBILE_PREVIEW_URL ?? "http://127.0.0.1:4330";
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
async function api(endpoint, method = "GET", data) {
  const csrf = await (await context.request.get(`${origin}/auth/get-csrf-token/`)).json();
  const response = await context.request.fetch(`${origin}${endpoint}`, {
    method,
    data,
    headers: { "X-CSRFToken": csrf.csrf_token },
  });
  expect(response.ok(), `${method} ${endpoint}: ${response.status()}`).toBe(true);
  return response.status() === 204 ? null : response.json();
}
try {
  const account = fixture.accounts.independent;
  expect((await api("/api/lab/session/")).user.id).toBe(account.user_id);
  const workspace = `/api/workspaces/${fixture.workspace_slug}`;
  const stamp = Date.now();
  const description = `需要保留的项目描述 ${stamp}`;
  const project = await api(`${workspace}/projects/`, "POST", {
    name: `Review ${mode} ${stamp}`,
    identifier: `R${String(stamp).slice(-8)}`,
    description,
    project_lead: account.user_id,
    intake_view: false,
  });
  const base = `${workspace}/projects/${project.id}/`;
  await page.goto(
    `${origin}/src/features/core/tests/review-harness.html?workspace=${fixture.workspace_slug}&project=${project.id}`
  );
  if (mode === "project") {
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const routePattern = `${origin}${base}`;
    await page.route(routePattern, async (route) => {
      await gate;
      await route.continue();
    });
    await page.getByRole("button", { name: `${project.name}项目操作`, exact: true }).click();
    await expect(page.getByRole("dialog").getByRole("status")).toContainText("正在加载");
    await expect(page.getByRole("button", { name: "编辑项目", exact: true })).toBeDisabled();
    release();
    await expect(page.getByRole("dialog")).toContainText(description);
    await page.unroute(routePattern);
    await page.getByRole("button", { name: "编辑项目", exact: true }).click();
    await expect(page.getByLabel("项目描述", { exact: true })).toHaveValue(description);
    const updatedDescription = `${description} · 连续编辑更新`;
    await page.getByLabel("项目描述", { exact: true }).fill(updatedDescription);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await api(base)).description).toBe(updatedDescription);
    // A slow background GET must not make the next editor reuse the pre-save cache.
    await page.route(routePattern, async (route) => {
      if (route.request().method() === "GET") await new Promise((resolve) => setTimeout(resolve, 1000));
      await route.continue();
    });
    await page.getByRole("button", { name: `${project.name}项目操作`, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(updatedDescription, { timeout: 500 });
    await page.getByRole("button", { name: "编辑项目", exact: true }).click();
    await expect(page.getByLabel("项目描述", { exact: true })).toHaveValue(updatedDescription);
    const newName = `${project.name} renamed`;
    await page.getByLabel("项目名称", { exact: true }).fill(newName);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const saved = await api(base);
    expect(saved.name).toBe(newName);
    expect(saved.description).toBe(updatedDescription);
    await page.getByRole("button", { name: `${newName}项目操作`, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(updatedDescription);
  } else if (mode === "feature") {
    await page.getByRole("button", { name: "功能测试", exact: true }).click();
    const checkbox = page.getByLabel("收件箱", { exact: true });
    await expect(checkbox).not.toBeChecked();
    await checkbox.click();
    await expect(checkbox).toBeChecked();
    expect((await api(base)).intake_view).toBe(true);
    expect((await api(base)).inbox_view).toBe(true);
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();
    expect((await api(base)).intake_view).toBe(false);
    expect((await api(base)).inbox_view).toBe(false);
  } else if (mode === "space") {
    const states = await api(`${base}states/`);
    const state = states.find((item) => item.default);
    const label = await api(`${base}issue-labels/`, "POST", { name: "共享验收标签", color: "#226688" });
    const issue = await api(`${base}issues/`, "POST", {
      name: `共享属性 ${stamp}`,
      state_id: state.id,
      assignee_ids: [account.user_id],
      label_ids: [label.id],
      priority: "high",
      start_date: "2026-10-10",
      target_date: "2026-10-20",
    });
    const board = await api(`${base}project-deploy-boards/`, "POST", {});
    await page.getByRole("button", { name: "共享测试", exact: true }).click();
    await page.getByLabel("共享链接或标识").fill(board.anchor);
    await page.getByRole("button", { name: "打开", exact: true }).click();
    await page.getByRole("button", { name: issue.name, exact: true }).click();
    const properties = page.locator("dl.record-fields").first();
    await expect(properties).toContainText("状态");
    await expect(properties).toContainText(state.name);
    await expect(properties).toContainText("负责人");
    await expect(properties).toContainText("安卓复核人");
    await expect(properties).toContainText("标签");
    await expect(properties).toContainText(label.name);
    await expect(properties).toContainText("优先级");
    await expect(properties).toContainText("高");
    await expect(properties).toContainText("开始日期");
    await expect(properties).toContainText("2026-10-10");
    await expect(properties).toContainText("截止日期");
    await expect(properties).toContainText("2026-10-20");
  } else throw new Error("Unknown regression mode");
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: mode, backend: fixture.server, viewport: 412 }));
} finally {
  await browser.close();
}
