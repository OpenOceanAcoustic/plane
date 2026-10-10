/** Actual React components against the isolated PostgreSQL HTTP server; no intercepted API. */
import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const privateDir = process.env.ANDROID_PRIVATE_TEST_DIR ?? "/mnt/repo/ly/.android-release";
const fixture = JSON.parse(await readFile(`${privateDir}/business-test-credentials.json`, "utf8"));
assert(fixture.workspace_slug.startsWith("android-business-"));
const cookieText = await readFile(`${privateDir}/business-cookies-lead.txt`, "utf8"),
  cookies = cookieText
    .split("\n")
    .filter((line) => line && (!line.startsWith("#") || line.startsWith("#HttpOnly_")))
    .map((line) => {
      const [domain, , path, secure, expiry, name, value] = line.replace(/^#HttpOnly_/, "").split("\t");
      return {
        domain,
        path,
        secure: secure === "TRUE",
        expires: Number(expiry) > 0 ? Number(expiry) : -1,
        name,
        value,
      };
    });
const browser = await chromium.launch({ headless: true }),
  context = await browser.newContext({ viewport: { width: 360, height: 800 } });
await context.addCookies(cookies);
const page = await context.newPage(),
  cases = [],
  errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const base = process.env.BUSINESS_LIVE_BROWSER_URL ?? "http://127.0.0.1:4321/src/features/lab/tests/live-harness.html";
const open = async (section, workspaceFeature = false) => {
  await page.goto(
    `${base}?workspace=${encodeURIComponent(fixture.workspace_slug)}&section=${section}${workspaceFeature ? "&workspaceFeature=1" : ""}`
  );
  await page.locator(".lab-feature").waitFor();
};
try {
  await open("planner");
  await page.getByRole("button", { name: "新建事项", exact: true }).click();
  const item = page.getByRole("dialog", { name: "新建事项" });
  const title = `浏览器真实排期 ${Date.now()}`;
  await item.getByLabel("标题", { exact: true }).fill(title);
  await item.getByRole("button", { name: "保存", exact: true }).click();
  await item.waitFor({ state: "hidden" });
  await page.getByText(title, { exact: true }).waitFor();
  cases.push("React planner creates and refreshes an item through real isolated HTTP");
  await open("finance");
  await page.getByRole("heading", { name: "资金与奖励", exact: true }).waitFor();
  await page.getByRole("button", { name: "办理资金事项", exact: true }).click();
  const menu = page.getByRole("dialog");
  await menu.getByRole("button", { name: "录入期初余额", exact: true }).click();
  const opening = page.getByRole("dialog", { name: "录入期初余额" });
  await opening.getByLabel("资金归属", { exact: true }).selectOption("public");
  await opening.getByLabel("账户类型", { exact: true }).selectOption("public");
  await opening.getByLabel("期初实际余额（元）", { exact: true }).fill("0.25");
  await opening.getByLabel("余额来源", { exact: true }).fill("真实浏览器隔离验证");
  await opening.getByLabel("操作／核准依据", { exact: true }).fill("隔离验收");
  await opening.getByLabel("凭证或证据引用", { exact: true }).fill("test-only:browser");
  await opening.getByRole("button", { name: "保存", exact: true }).click();
  await opening.waitFor({ state: "hidden" });
  cases.push("React money form submits exact decimal funds to the real server");
  await open("documents");
  await page.getByLabel("项目", { exact: true }).selectOption(fixture.project_id);
  await page.getByRole("button", { name: "新建实验记录", exact: true }).click();
  const doc = page.getByRole("dialog", { name: "新建实验记录" });
  await doc.getByLabel("名称", { exact: true }).fill(`真实浏览器实验记录 ${Date.now()}`);
  await doc.getByRole("button", { name: "保存", exact: true }).click();
  await doc.waitFor({ state: "hidden" });
  cases.push("React document create uses real experiment template endpoint");
  await open("drafts", true);
  await page.getByRole("button", { name: "新建草稿", exact: true }).click();
  const draft = page.getByRole("dialog", { name: "新建草稿" }),
    draftTitle = `浏览器草稿 ${Date.now()}`;
  await draft.getByLabel("任务名称", { exact: true }).fill(draftTitle);
  await draft.getByLabel("项目", { exact: true }).selectOption(fixture.project_id);
  await draft.getByLabel("富文本内容", { exact: true }).fill("真实富文本");
  await draft.getByRole("button", { name: "保存", exact: true }).click();
  await draft.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: draftTitle, exact: true }).waitFor();
  cases.push("React draft rich text and project assignment persist through real API");
  assert.equal(errors.length, 0, errors.join("\n"));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: "/tmp/ooa-workspace-real-drafts-360.png" });
  cases.push("360px real-data screens render without runtime errors or horizontal overflow");
  console.log(
    JSON.stringify(
      {
        passed: cases.length,
        cases,
        transport: "Real HTTP; no mocked routes",
        device: "Desktop Chromium headless, 360px; not Android emulator",
      },
      null,
      2
    )
  );
} finally {
  await browser.close();
}
