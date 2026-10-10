/* oxlint-disable no-await-in-loop -- one browser page must navigate and assert sequentially */
import { chromium, expect } from "@playwright/test";
import fs from "node:fs";
import { createHmac } from "node:crypto";
const fixture = JSON.parse(
  fs.readFileSync(process.env.MOBILE_TEST_CREDENTIALS || "/mnt/repo/ly/.android-release/test-credentials.json", "utf8")
);
const onlyEmptyWorkspace = process.argv.includes("--empty-workspace");
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
const context = await browser.newContext({
  viewport: onlyEmptyWorkspace ? { width: 360, height: 800 } : { width: 412, height: 915 },
});
if (onlyEmptyWorkspace) {
  const savedSession = JSON.parse(
    fs.readFileSync(
      process.env.MOBILE_TEST_COOKIES || "/mnt/repo/ly/.android-release/core-test-browser-cookies.json",
      "utf8"
    )
  );
  await context.addCookies(Array.isArray(savedSession) ? savedSession : savedSession.cookies);
  await context.addInitScript((server) => localStorage.setItem("ooa.server", server), fixture.server);
}
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
async function signIn(codeLabel, path) {
  let replayRetried = false;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.getByLabel(codeLabel, { exact: true }).fill(totp(fixture.accounts.admin.totp_secret));
    const result = page.waitForResponse(
      (response) => new URL(response.url()).pathname === path && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "登录", exact: true }).click();
    const response = await result;
    if (response.ok()) return;
    if (response.status() === 429) {
      const retryAfter = Number(response.headers()["retry-after"]);
      expect(Number.isInteger(retryAfter) && retryAfter > 0 && retryAfter <= 600).toBe(true);
      console.log(JSON.stringify({ waitingForAuthenticationWindowSeconds: retryAfter }));
      // Honor the real backend limit. Successful sign-ins also consume the
      // five-attempt window; never reset it to speed up repeated UI acceptance.
      for (let remaining = retryAfter + 1; remaining > 0; remaining -= Math.min(remaining, 30))
        await page.waitForTimeout(Math.min(remaining, 30) * 1000);
      continue;
    }
    // Ordinary and administrator sign-in consume the same one-time code. A prior
    // acceptance run can also have consumed this tick; retry only on the next tick.
    if (!replayRetried && [400, 401].includes(response.status())) {
      replayRetried = true;
      await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
    } else {
      expect(response.ok(), `dynamic-code sign-in (${response.status()})`).toBeTruthy();
    }
  }
  throw new Error("Authentication did not complete after honoring the server retry window");
}
function isResponse(path, method = "GET") {
  return (response) => new URL(response.url()).pathname === path && response.request().method() === method;
}
async function checkEmptyWorkspace(session, issue) {
  const membershipsBefore = await api("/api/users/me/workspaces/");
  let emptyWorkspaceRequests = 0;
  const emptyWorkspaces = async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/users/me/workspaces/") return route.continue();
    emptyWorkspaceRequests += 1;
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  };
  // Only membership discovery is a fixture. Session, settings, admin, and Space
  // continue using the real isolated backend; no actual membership is changed.
  await page.route("**/api/users/me/workspaces/**", emptyWorkspaces);
  const emptyWorkspaceResponse = page.waitForResponse(isResponse("/api/users/me/workspaces/"));
  await page.reload();
  await emptyWorkspaceResponse;
  await expect(page.getByText("暂无工作区", { exact: true })).toBeVisible();
  expect(emptyWorkspaceRequests).toBeGreaterThan(0);
  expect((await api("/api/lab/session/")).user.id).toBe(session.user.id);
  await page.locator("main").getByRole("button", { name: "个人设置", exact: true }).click();
  await expect(page.getByRole("heading", { name: "个人设置", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "编辑个人资料", exact: true })).toBeVisible();
  await expect(page.getByText("暂无工作区", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "God Mode", exact: true }).click();
  await expect(page.getByRole("heading", { name: "God Mode 登录", exact: true })).toBeVisible();
  await expect(page.getByLabel("动态码", { exact: true })).toBeVisible();
  await expect(page.getByText("暂无工作区", { exact: true })).toHaveCount(0);
  await page.locator(".topbar").getByRole("button", { name: "返回", exact: true }).click();
  await page.getByRole("button", { name: "共享页面", exact: true }).click();
  await expect(page.getByLabel("共享链接或标识")).toBeVisible();
  await expect(page.getByText("暂无工作区", { exact: true })).toHaveCount(0);
  await page.getByLabel("共享链接或标识").fill(fixture.shared_anchor);
  await page.getByRole("button", { name: "打开", exact: true }).click();
  await page.getByRole("button", { name: issue.name, exact: true }).click();
  await expect(page.getByRole("heading", { name: issue.name, exact: true })).toBeVisible();
  expect(await page.getByRole("alert").allTextContents()).toEqual([]);
  await page.unroute("**/api/users/me/workspaces/**", emptyWorkspaces);
  await page.reload();
  await page.getByRole("button", { name: "工作", exact: true }).waitFor();
  const membershipsAfter = await api("/api/users/me/workspaces/");
  expect(membershipsAfter.length).toBe(membershipsBefore.length);
  expect(
    membershipsBefore.every((before) =>
      membershipsAfter.some((after) => after.id === before.id && after.slug === before.slug)
    )
  ).toBe(true);
  checks.push(
    "empty-workspace fixture preserves real session and access to personal settings, God Mode, and shared page"
  );
}
try {
  if (onlyEmptyWorkspace) {
    await page.goto(origin);
    await page.getByRole("button", { name: "工作", exact: true }).waitFor({ timeout: 20000 });
    const session = await api("/api/lab/session/");
    expect(session.client_platform).toBe("android");
    expect(session.user.id === fixture.accounts.independent.user_id).toBe(true);
    const issue = await api(`/api/public/anchor/${fixture.shared_anchor}/issues/${fixture.issue_id}/`);
    await checkEmptyWorkspace(session, issue);
  } else {
    await page.goto(origin);
    await page.getByLabel("服务器地址").fill(fixture.server);
    await page.getByRole("button", { name: "连接", exact: true }).click();
    await page.getByLabel("用户名", { exact: true }).fill(fixture.accounts.admin.username);
    await signIn("六位动态码", "/auth/lab/mobile/sign-in/");
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
    await page.locator(".project-navigation").getByRole("button", { name: "概览", exact: true }).click();
    await page.getByRole("button", { name: "项目设置", exact: true }).click();
    await expect(page.getByRole("heading", { name: "项目设置", exact: true })).toBeVisible();
    await expect(page.getByRole("combobox", { name: /^项目/ })).toHaveValue(fixture.project_id);
    await expect(page.getByRole("button", { name: "编辑项目", exact: true })).toBeVisible();
    checks.push("project overview settings action opens actual project settings for the same project");
    await page.locator(".project-navigation").getByRole("button", { name: "视图", exact: true }).click();
    await page.getByRole("button", { name: "新视图", exact: true }).click();
    const createView = page.getByRole("dialog", { name: "创建视图", exact: true });
    await expect(createView.getByLabel("可见性", { exact: true })).toHaveCount(0);
    const viewName = `Android shared view ${Date.now()}`;
    await createView.getByLabel("视图名称", { exact: true }).fill(viewName);
    const viewPath = `/api/workspaces/${fixture.workspace_slug}/projects/${fixture.project_id}/views/`;
    const createdViewResponse = page.waitForResponse(isResponse(viewPath, "POST"));
    await createView.getByRole("button", { name: "保存", exact: true }).click();
    const createdView = await createdViewResponse;
    expect(createdView.ok()).toBeTruthy();
    expect(createdView.request().postDataJSON()).not.toHaveProperty("access");
    const createdViewData = await createdView.json();
    expect(createdViewData.access).toBe(1);
    await expect(page.getByRole("heading", { name: viewName, exact: true })).toBeVisible();
    await expect(page.getByText("项目共享", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "编辑视图", exact: true }).click();
    const editView = page.getByRole("dialog", { name: "编辑视图", exact: true });
    await expect(editView.getByLabel("可见性", { exact: true })).toHaveCount(0);
    await editView.getByLabel("视图名称", { exact: true }).fill(`${viewName} edited`);
    const editedViewResponse = page.waitForResponse(isResponse(`${viewPath}${createdViewData.id}/`, "PATCH"));
    await editView.getByRole("button", { name: "保存", exact: true }).click();
    const editedView = await editedViewResponse;
    expect(editedView.ok()).toBeTruthy();
    expect(editedView.request().postDataJSON()).not.toHaveProperty("access");
    expect((await editedView.json()).access).toBe(1);
    await expect(page.getByRole("heading", { name: `${viewName} edited`, exact: true })).toBeVisible();
    await expect(page.getByText("项目共享", { exact: true })).toBeVisible();
    const storedView = await api(`${viewPath}${createdViewData.id}/`);
    expect(storedView.name).toBe(`${viewName} edited`);
    expect(storedView.access).toBe(1);
    checks.push("real project view create/edit omit unsupported visibility selector and reflect public server access");
    await api(`${viewPath}${createdViewData.id}/`, "DELETE");
    await page.locator(".project-navigation").getByRole("button", { name: "工作项", exact: true }).click();
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
    const docPath = `/api/workspaces/${fixture.workspace_slug}/projects/${fixture.project_id}/pages/${doc.id}/`;
    await api(`${docPath}lock/`, "POST");
    await home("文档");
    await page.getByLabel("项目", { exact: true }).selectOption(fixture.project_id);
    const ticketPath = `/api/workspaces/${fixture.workspace_slug}/lab/live-ticket/`;
    const documentTicket = (response) =>
      isResponse(ticketPath, "POST")(response) && response.request().postDataJSON()?.page_id === doc.id;
    const lockedTicketResponse = page.waitForResponse(documentTicket);
    await page.getByRole("button", { name: doc.name, exact: true }).click();
    await page.getByLabel("文档正文", { exact: true }).waitFor({ timeout: 25000 });
    const lockedTicket = await (await lockedTicketResponse).json();
    expect(lockedTicket.read_only).toBe(true);
    await expect(page.getByLabel("文档正文", { exact: true })).toHaveAttribute("contenteditable", "false");
    await expect(page.getByLabel("文档标题", { exact: true })).toHaveAttribute("contenteditable", "false");
    await page.getByRole("button", { name: "文档操作", exact: true }).click();
    const unlockedTicketResponse = page.waitForResponse(documentTicket);
    await page.getByRole("button", { name: "解锁", exact: true }).click();
    const unlockedTicket = await (await unlockedTicketResponse).json();
    expect(unlockedTicket.read_only).toBe(false);
    expect(unlockedTicket.ticket !== lockedTicket.ticket, "unlock issues a different collaboration ticket").toBe(true);
    await expect(page.getByLabel("文档正文", { exact: true })).toHaveAttribute("contenteditable", "true", {
      timeout: 25000,
    });
    await expect(page.getByLabel("文档标题", { exact: true })).toHaveAttribute("contenteditable", "true");
    expect((await api(docPath)).is_locked).toBe(false);
    checks.push("document opened locked is read-only; in-page unlock renews ticket and makes both editors writable");
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
    // Repeated isolated acceptance runs can start with an existing vote.
    await page.getByRole("button", { name: /^(取消投票|投票)$/ }).waitFor();
    if (await page.getByRole("button", { name: "取消投票", exact: true }).isVisible())
      await page.getByRole("button", { name: "取消投票", exact: true }).click();
    await page.getByRole("button", { name: "投票", exact: true }).click();
    await page.getByRole("button", { name: "取消投票", exact: true }).waitFor();
    await page.getByRole("button", { name: "取消投票", exact: true }).click();
    await page.getByRole("button", { name: "添加评论", exact: true }).click();
    const publicComment = `Android public comment ${Date.now()}`;
    await page.getByLabel("富文本内容").fill(publicComment);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await page.getByText(publicComment, { exact: true }).waitFor();
    checks.push("Space project/detail/vote toggle/rich comment");
    await home("设置");
    await page.getByRole("button", { name: "God Mode", exact: true }).click();
    await page.getByLabel("用户名", { exact: true }).fill(fixture.accounts.admin.username);
    // A code used for ordinary login must never be replayed for independent administrator login.
    await page.waitForTimeout(30000 - (Date.now() % 30000) + 1000);
    await signIn("动态码", "/auth/lab/mobile/admin/sign-in/");
    await page.getByRole("button", { name: "退出管理账号", exact: true }).waitFor({ timeout: 15000 });
    const adminSession = await api("/api/lab/session/?admin=true");
    expect(adminSession.client_platform).toBe("android");
    await page.getByRole("button", { name: "配置", exact: true }).click();
    expect(await page.getByRole("alert").allTextContents()).toEqual([]);
    await page.getByRole("button", { name: "退出管理账号", exact: true }).click();
    const retainedSession = await api("/api/lab/session/");
    expect(retainedSession.user.id).toBe(session.user.id);
    checks.push("independent God Mode sign-in/configuration/logout preserves ordinary session");
    await checkEmptyWorkspace(session, issue);
  }
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      mode: onlyEmptyWorkspace ? "empty-workspace-session-reuse" : "full",
      passed: checks.length,
      checks,
      pageErrors: errors,
    })
  );
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
  if (process.env.MOBILE_TEST_SESSION_OUTPUT) {
    fs.writeFileSync(process.env.MOBILE_TEST_SESSION_OUTPUT, JSON.stringify(await context.storageState()), {
      mode: 0o600,
    });
    fs.chmodSync(process.env.MOBILE_TEST_SESSION_OUTPUT, 0o600);
  }
  await browser.close();
}
