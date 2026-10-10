/* oxlint-disable no-await-in-loop -- one browser page must navigate and assert sequentially */
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import { createHmac } from "node:crypto";
const fixture = JSON.parse(
  fs.readFileSync(process.env.MOBILE_TEST_CREDENTIALS || "/mnt/repo/ly/.android-release/test-credentials.json", "utf8")
);
function totp(secret) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.toUpperCase().replace(/=+$/, "")) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g).map((v) => parseInt(v, 2))),
    counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", key).update(counter).digest(),
    offset = hash[19] & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const context = await browser.newContext({ viewport: { width: 412, height: 915 } });
const page = await context.newPage(),
  errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const origin = process.env.MOBILE_PREVIEW_URL || "http://127.0.0.1:4319";
async function api(path, method = "GET", data) {
  const csrf = await (await page.request.get(`${origin}/auth/get-csrf-token/`)).json();
  const response = await page.request.fetch(`${origin}${path}`, {
    method,
    data,
    headers: { "X-CSRFToken": csrf.csrf_token },
  });
  expect(response.ok(), `API ${method} ${path} (${response.status()})`).toBeTruthy();
  return response.status() === 204 ? null : response.json();
}
async function home(label) {
  await page.getByRole("button", { name: "首页", exact: true }).click();
  await page.getByRole("button", { name: label, exact: true }).click();
}
try {
  await page.goto(origin);
  await page.getByLabel("服务器地址").fill(fixture.server);
  await page.getByRole("button", { name: "连接", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(fixture.accounts.admin.username);
  await page.getByLabel("六位动态码").fill(totp(fixture.accounts.admin.totp_secret));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "工作", exact: true }).waitFor({ timeout: 20000 });
  checks.push("server compatibility + real dynamic-code sign-in");
  const session = await api("/api/lab/session/");
  expect(session.client_platform).toBe("android");
  expect(session.capabilities.data_export).toBe(false);
  const projects = await api(`/api/workspaces/${fixture.workspace_slug}/projects/`);
  const project = projects.find((p) => p.id === fixture.project_id);
  expect(project).toBeTruthy();
  await home("项目");
  await page.locator("main").getByRole("button", { name: project.name, exact: true }).click();
  await page.getByRole("heading", { name: project.name, exact: true }).waitFor();
  expect(await page.getByRole("alert").allTextContents()).toEqual([]);
  checks.push("real project -> tasks route");
  await page.screenshot({ path: "/tmp/ooa-mobile-tasks.png", fullPage: true });
  const issue = await api(
    `/api/workspaces/${fixture.workspace_slug}/projects/${fixture.project_id}/issues/${fixture.issue_id}/`
  );
  await page.locator("main").getByRole("button", { name: issue.name, exact: true }).click();
  await page.getByRole("heading", { name: issue.name, exact: true }).waitFor();
  await page.screenshot({ path: "/tmp/ooa-mobile-issue.png", fullPage: true });
  checks.push("real task properties/activity");
  for (const label of ["草稿", "工作区视图", "活跃周期", "工作区统计", "个人排期", "资金与核准", "我的项目与 VC"]) {
    await home(label);
    await page.waitForTimeout(700);
    expect(await page.getByRole("alert").allTextContents(), label).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), `${label}: overflow`).toBe(
      false
    );
  }
  checks.push("workspace/planning/finance/VC routes 412px");
  await home("设置");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: "/tmp/ooa-mobile-settings-dark.png", fullPage: true });
  await page.getByRole("button", { name: "浅色", exact: true }).click();
  checks.push("persistent theme + 360px settings");
  const doc = await api(`/api/workspaces/${fixture.workspace_slug}/projects/${fixture.project_id}/pages/`, "POST", {
    name: `Android live ${Date.now()}`,
    description_html: "<p></p>",
    access: 0,
  });
  await home("文档");
  await page.getByLabel("项目", { exact: true }).selectOption(fixture.project_id);
  await page.getByRole("button", { name: doc.name, exact: true }).click();
  await page.getByLabel("文档正文", { exact: true }).waitFor({ timeout: 25000 });
  const second = await context.newPage();
  second.on("pageerror", (e) => errors.push(e.message));
  await second.goto(origin);
  await second.getByRole("button", { name: "文档", exact: true }).click();
  await second.getByLabel("项目", { exact: true }).selectOption(fixture.project_id);
  await second.getByRole("button", { name: doc.name, exact: true }).click();
  await second.getByLabel("文档正文", { exact: true }).waitFor({ timeout: 25000 });
  const content = `Android synchronized ${Date.now()}`;
  await page.getByLabel("文档正文", { exact: true }).fill(content);
  await expect(second.getByLabel("文档正文", { exact: true })).toContainText(content, { timeout: 20000 });
  await page.getByLabel("文档标题", { exact: true }).fill("Android synchronized title");
  await expect(second.getByLabel("文档标题", { exact: true })).toContainText("Android synchronized title", {
    timeout: 20000,
  });
  await page.screenshot({ path: "/tmp/ooa-mobile-document.png", fullPage: true });
  await second.close();
  checks.push("two actual Yjs clients body + title synchronization");
  await page.getByRole("button", { name: "首页", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "工作", exact: true }).waitFor();
  checks.push("session restoration after restart");
  await home("共享页面");
  await page.getByLabel("共享链接或标识").fill(fixture.shared_anchor);
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await page.getByRole("button", { name: issue.name, exact: true }).click();
  await page.getByRole("heading", { name: issue.name, exact: true }).waitFor();
  const vote = page.getByRole("button", { name: /^(取消投票|投票)$/ });
  await vote.click();
  await page.getByRole("button", { name: "取消投票", exact: true }).waitFor();
  await page.getByRole("button", { name: "取消投票", exact: true }).click();
  await page.getByRole("button", { name: "添加评论", exact: true }).click();
  await page.getByLabel("富文本内容").fill("Android public comment");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("Android public comment", { exact: true }).waitFor();
  checks.push("Space project/detail/vote toggle/rich comment");
  await home("设置");
  await page.getByRole("button", { name: "God Mode", exact: true }).click();
  await page.getByLabel("用户名", { exact: true }).fill(fixture.accounts.admin.username);
  // A code used for ordinary login must never be replayed for independent administrator login.
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
  await page.getByLabel("动态码", { exact: true }).fill(totp(fixture.accounts.admin.totp_secret));
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "退出管理账号", exact: true }).waitFor({ timeout: 15000 });
  const adminSession = await api("/api/lab/session/?admin=true");
  expect(adminSession.client_platform).toBe("android");
  await page.getByRole("button", { name: "配置", exact: true }).click();
  expect(await page.getByRole("alert").allTextContents()).toEqual([]);
  await page.getByRole("button", { name: "退出管理账号", exact: true }).click();
  const retainedSession = await api("/api/lab/session/");
  expect(retainedSession.user.id).toBe(session.user.id);
  checks.push("independent God Mode sign-in/configuration/logout preserves ordinary session");
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ passed: checks.length, checks, pageErrors: errors }));
} catch (error) {
  await page.screenshot({ path: "/tmp/ooa-mobile-e2e-failure.png", fullPage: true }).catch(() => {});
  console.error(
    JSON.stringify({
      completed: checks,
      pageErrors: errors,
      alerts: await page.getByRole("alert").allTextContents(),
      failure: error.message,
    })
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
