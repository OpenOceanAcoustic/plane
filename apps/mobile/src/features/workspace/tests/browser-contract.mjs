import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 360, height: 800 } }),
  cases = [];
const base = process.env.WORKSPACE_BROWSER_URL ?? "http://127.0.0.1:4321/src/features/workspace/tests/harness.html";
const open = async (section) => {
  await page.goto(`${base}?section=${section}`);
  await page.locator(".workspace-feature").waitFor();
};
const mutations = async (suffix) =>
  page.evaluate(
    (query) => window.workspaceRequests.filter((row) => row.method !== "GET" && row.path.includes(query)),
    suffix
  );
try {
  await open("widgets");
  await page.getByRole("checkbox").first().uncheck();
  await page.waitForFunction(() =>
    window.workspaceRequests.some((row) => row.method === "PATCH" && row.body.is_enabled === false)
  );
  assert.equal((await mutations("home-preferences/quick_links/"))[0].body.is_enabled, false);
  cases.push("home widget visibility persists through backend preferences");
  await page.getByRole("button", { name: "下移", exact: true }).first().click();
  await page.waitForFunction(() =>
    window.workspaceRequests.some((row) => row.method === "PATCH" && "sort_order" in row.body)
  );
  assert.equal((await mutations("home-preferences/quick_links/"))[1].body.sort_order, 21);
  cases.push("widget reorder persists a real sort_order");
  await open("drafts");
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const edit = page.getByRole("dialog", { name: "编辑草稿" });
  await edit.getByLabel("任务名称").fill("海试计划");
  await edit.getByRole("button", { name: "保存", exact: true }).click();
  await edit.waitFor({ state: "hidden" });
  const saved = (await mutations("draft-issues/d1/"))[0].body;
  assert.equal(saved.name, "海试计划");
  assert.equal(saved.description_html, "<p>完整描述</p>");
  assert.deepEqual(saved.assignee_ids, ["u1"]);
  assert.deepEqual(saved.label_ids, ["l1"]);
  assert.equal(saved.state_id, "st1");
  assert.equal(saved.cycle_id, "c1");
  cases.push("draft editing preserves loaded rich text and project relations");
  await page.getByRole("button", { name: "发布为任务", exact: true }).click();
  const publish = page.getByRole("dialog", { name: "发布为任务" });
  await publish.getByRole("button", { name: "确认发布", exact: true }).click();
  await publish.waitFor({ state: "hidden" });
  assert.equal((await mutations("draft-to-issue/d1/"))[0].body.description_html, "<p>完整描述</p>");
  const nav = (await mutations("navigate")).at(-1);
  assert.deepEqual(nav.body, { page: "issue", projectId: "p1", issueId: "t1" });
  cases.push("draft publish reads latest server state and opens the real created task");
  await open("workspace-views");
  await page.getByRole("button", { name: "海试进度", exact: true }).click();
  await page.getByRole("button", { name: "编辑筛选", exact: true }).click();
  const view = page.getByRole("dialog", { name: "编辑工作区视图" });
  await view.getByRole("checkbox", { name: "信号处理", exact: true }).check();
  await view.getByRole("button", { name: "保存", exact: true }).click();
  await view.waitFor({ state: "hidden" });
  assert.deepEqual((await mutations("views/v1/"))[0].body.filters.project, ["p1", "p2"]);
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForFunction(() => window.workspaceRequests.some((row) => row.path.includes("cursor=next%2B1")));
  const request = await page.evaluate(() => window.workspaceRequests.findLast((row) => row.path.includes("/issues/?")));
  assert(request.path.includes("project=p1%2Cp2"));
  assert(request.path.includes("state_group=started"));
  cases.push("workspace saved view filters and pagination query actual permitted tasks");
  await open("activity");
  await page.getByLabel("项目筛选").selectOption("p1");
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForFunction(() => window.workspaceRequests.some((row) => row.path.includes("cursor=activity%2B1")));
  const activity = await page.evaluate(() =>
    window.workspaceRequests.findLast((row) => row.path.includes("/user-activity/"))
  );
  assert(activity.path.includes("project=p1"));
  cases.push("personal activity pagination retains project filter");
  await open("active-cycles");
  await page.getByRole("button", { name: "十月试验", exact: true }).click();
  await page.getByRole("button", { name: "采样试验", exact: true }).click();
  assert.equal((await mutations("navigate"))[0].body.issueId, "t1");
  cases.push("active cycle exposes progress and real task navigation");
  await open("workspace-analytics");
  await page.getByRole("button", { name: "任务分析", exact: true }).click();
  await page.getByRole("button", { name: /高\s*4/ }).click();
  const details = page.getByRole("dialog", { name: "优先级：高" });
  await details.getByRole("button", { name: "采样试验", exact: true }).waitFor();
  const chartQuery = await page.evaluate(() =>
    window.workspaceRequests.findLast((row) => row.path.includes("/issues/?"))
  );
  assert(chartQuery.path.includes("priority=high"));
  assert(chartQuery.path.includes("created_at="));
  cases.push("native task analytics drilldown retains date and dimension filters");
  await open("commands");
  await page.getByRole("button", { name: "添加链接", exact: true }).click();
  const quick = page.getByRole("dialog", { name: "添加快捷链接" });
  await quick.getByLabel("名称").fill("实验站");
  await quick.getByLabel("链接").fill("https://example.org/lab");
  await quick.getByRole("button", { name: "保存", exact: true }).click();
  await quick.waitFor({ state: "hidden" });
  assert.equal((await mutations("/quick-links/"))[0].body.url, "https://example.org/lab");
  await page.getByRole("button", { name: /个人排期/ }).click();
  assert.equal((await mutations("navigate"))[0].body.page, "planner");
  cases.push("quick links save and command buttons navigate real application pages");
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  cases.push("360px workspace records fit the screen");
  console.log(JSON.stringify({ passed: cases.length, cases }, null, 2));
} finally {
  await browser.close();
}
