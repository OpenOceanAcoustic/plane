/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import type { LabBounty } from "@plane/types";
import type { LabContributionEntry } from "../../../packages/types/src/lab-contributions";

const summary = {
  timezone: "Asia/Shanghai",
  totals: { earned: "40.00", reversed: "5.00", net: "35.00" },
  projects: [
    {
      id: "acoustic",
      name: "声学项目",
      earned: "40.00",
      reversed: "5.00",
      net: "35.00",
      participation: ["project"],
      historical: false,
      can_open_project: true,
    },
    {
      id: "zero",
      name: "待启动项目",
      earned: "0.00",
      reversed: "0.00",
      net: "0.00",
      participation: ["project"],
      historical: false,
      can_open_project: true,
    },
  ],
};

async function fixture(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-30T16:30:00Z"));
  await page.route("**/api/workspaces/lab/lab/me/contributions/", (route) => route.fulfill({ json: summary }));
  await page.route("**/api/workspaces/lab/lab/me/contributions/calendar/**", (route) =>
    route.fulfill({
      json: {
        timezone: "Asia/Shanghai",
        month: "2026-10",
        totals: { earned: "0.00", reversed: "5.00", net: "-5.00" },
        days: [
          {
            day: "2026-10-01",
            project_id: "acoustic",
            project: "声学项目",
            earned: "0.00",
            reversed: "5.00",
            net: "-5.00",
            count: 1,
          },
        ],
      },
    })
  );
  await page.route("**/api/workspaces/lab/lab/me/contributions/entries/**", (route) =>
    route.fulfill({
      json: {
        timezone: "Asia/Shanghai",
        results: [
          {
            id: "reversal",
            created_at: "2026-09-30T16:20:00Z",
            day: "2026-10-01",
            project_id: "acoustic",
            project: "声学项目",
            task_id: "task",
            task_title: "声学样本",
            bounty_id: "bounty",
            delta: "-5.00",
            kind: "reversal",
            reverses: "award",
            archived: true,
            can_open_issue: false,
            can_open_bounty: false,
          },
        ],
        next_cursor: null,
      },
    })
  );
}

test("personal VC totals retain lifetime awards and zero-VC memberships while the calendar starts in Shanghai's current month", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/contributions");
  const totals = page.getByRole("region", { name: "个人 VC 总额", exact: true });
  await expect(totals).toBeVisible();
  await expect(totals.getByText(/^40(?:\.00)?\s*VC$/)).toBeVisible();
  await expect(totals.getByText(/^5(?:\.00)?\s*VC$/)).toBeVisible();
  await expect(totals.getByText(/^35(?:\.00)?\s*VC$/)).toBeVisible();
  const projects = page.getByRole("region", { name: "参与项目", exact: true });
  await expect(projects.getByText("声学项目", { exact: true })).toBeVisible();
  await expect(projects.getByText("待启动项目", { exact: true })).toBeVisible();
  await expect(page.getByLabel("选择月份", { exact: true })).toHaveValue("2026-10");
  await expect(page.getByRole("region", { name: "VC 日历", exact: true })).toBeVisible();
});

function entry(
  id: string,
  day: string,
  delta: string,
  values: Partial<LabContributionEntry> = {}
): LabContributionEntry {
  return {
    id,
    created_at: `${day}T08:00:00+08:00`,
    day,
    project_id: "acoustic",
    project: "声学项目",
    task_id: `task-${id}`,
    task_title: id,
    bounty_id: `bounty-${id}`,
    delta,
    kind: delta.startsWith("-") ? "reversal" : "award",
    reverses: delta.startsWith("-") ? "original-award" : null,
    archived: false,
    can_open_issue: false,
    can_open_bounty: false,
    ...values,
  };
}

test("month, project and day browsing keeps lifetime totals and a zero-net day retains both award and reversal", async ({
  page,
}) => {
  await fixture(page);
  const combined = structuredClone(summary);
  combined.totals = { earned: "44.00", reversed: "9.00", net: "35.00" };
  Object.assign(combined.projects[0]!, combined.totals);
  await page.route("**/api/workspaces/lab/lab/me/contributions/", (route) => route.fulfill({ json: combined }));
  const septemberAward = entry("九月完成标注", "2026-09-30", "40.00");
  const octoberReversal = entry("跨月冲正标注", "2026-10-01", "-5.00", { reverses: septemberAward.id });
  const zeroAward = entry("二次验收获得", "2026-10-02", "4.00");
  const zeroReversal = entry("二次验收冲正", "2026-10-02", "-4.00", { reverses: zeroAward.id });
  const entryQueries: string[] = [];
  await page.route("**/api/workspaces/lab/lab/me/contributions/calendar/**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    const month = query.get("month");
    const empty = query.get("project_id") === "zero";
    return route.fulfill({
      json: {
        timezone: "Asia/Shanghai",
        month,
        totals: empty
          ? { earned: "0.00", reversed: "0.00", net: "0.00" }
          : month === "2026-09"
            ? { earned: "40.00", reversed: "0.00", net: "40.00" }
            : { earned: "4.00", reversed: "9.00", net: "-5.00" },
        days: empty
          ? []
          : month === "2026-09"
            ? [
                {
                  day: "2026-09-30",
                  project_id: "acoustic",
                  project: "声学项目",
                  earned: "40.00",
                  reversed: "0.00",
                  net: "40.00",
                  count: 1,
                },
              ]
            : [
                {
                  day: "2026-10-01",
                  project_id: "acoustic",
                  project: "声学项目",
                  earned: "0.00",
                  reversed: "5.00",
                  net: "-5.00",
                  count: 1,
                },
                {
                  day: "2026-10-02",
                  project_id: "acoustic",
                  project: "声学项目",
                  earned: "4.00",
                  reversed: "4.00",
                  net: "0.00",
                  count: 2,
                },
              ],
      },
    });
  });
  await page.route("**/api/workspaces/lab/lab/me/contributions/entries/**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    entryQueries.push(query.toString());
    return route.fulfill({
      json: {
        timezone: "Asia/Shanghai",
        results:
          query.get("project_id") === "zero"
            ? []
            : query.get("month") === "2026-09"
              ? [septemberAward]
              : query.get("day") === "2026-10-02"
                ? [zeroReversal, zeroAward]
                : [zeroReversal, zeroAward, octoberReversal],
        next_cursor: null,
      },
    });
  });
  await page.goto("/contributions");
  const totals = page.getByRole("region", { name: "个人 VC 总额", exact: true });
  const calendar = page.getByRole("region", { name: "VC 日历", exact: true });
  const zeroDay = calendar.getByRole("button", { name: "查看 2026-10-02 · 声学项目的 VC 明细", exact: true });
  await expect(zeroDay).toContainText("+4.00");
  await expect(zeroDay).toContainText("−4.00 冲正");
  await page.getByRole("button", { name: "上一月", exact: true }).click();
  await expect(page.getByLabel("选择月份", { exact: true })).toHaveValue("2026-09");
  await expect(
    calendar.getByRole("button", { name: "查看 2026-09-30 · 声学项目的 VC 明细", exact: true })
  ).toContainText("+40.00");
  await expect(totals.getByText("44.00 VC", { exact: true })).toBeVisible();
  await expect(totals.getByText("35.00 VC", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一月", exact: true }).click();
  await expect(page.getByLabel("选择月份", { exact: true })).toHaveValue("2026-10");
  await zeroDay.click();
  await expect(page.getByLabel("筛选项目", { exact: true })).toHaveValue("acoustic");
  await expect(calendar.getByRole("button", { name: "查看 2026-10-02 的 VC 明细", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true"
  );
  const details = page.getByRole("region", { name: "VC 明细", exact: true });
  await expect(details.getByRole("button", { name: /^查看贡献记录/ })).toHaveCount(2);
  await expect(details.getByText("+4.00 VC", { exact: true })).toBeVisible();
  await expect(details.getByText("-4.00 VC", { exact: true })).toBeVisible();
  expect(
    entryQueries.some(
      (value) =>
        new URLSearchParams(value).get("day") === "2026-10-02" &&
        new URLSearchParams(value).get("project_id") === "acoustic"
    )
  ).toBe(true);
  await page.getByRole("button", { name: "清除选日", exact: true }).click();
  await expect(details.getByRole("button", { name: /^查看贡献记录/ })).toHaveCount(3);
  await expect(page.getByLabel("筛选项目", { exact: true })).toHaveValue("acoustic");
  await page.getByLabel("筛选项目", { exact: true }).selectOption("zero");
  await expect(details.getByText("暂无 VC 记录", { exact: true })).toBeVisible();
  await expect(totals.getByText("35.00 VC", { exact: true })).toBeVisible();
});

test("late previous-month responses cannot replace the visible current month", async ({ page }) => {
  await fixture(page);
  const pending: Route[] = [];
  const current = entry("十月当前成果", "2026-10-01", "3.00");
  const old = entry("九月迟到成果", "2026-09-30", "8.00");
  await Promise.all(
    ["calendar", "entries"].map((endpoint) =>
      page.route(`**/api/workspaces/lab/lab/me/contributions/${endpoint}/**`, (route) => {
        const month = new URL(route.request().url()).searchParams.get("month");
        if (month === "2026-09") {
          pending.push(route);
          return;
        }
        return route.fulfill({
          json:
            endpoint === "entries"
              ? { timezone: "Asia/Shanghai", results: [current], next_cursor: null }
              : {
                  timezone: "Asia/Shanghai",
                  month,
                  totals: { earned: "3.00", reversed: "0.00", net: "3.00" },
                  days: [
                    {
                      day: "2026-10-01",
                      project_id: "acoustic",
                      project: "声学项目",
                      earned: "3.00",
                      reversed: "0.00",
                      net: "3.00",
                      count: 1,
                    },
                  ],
                },
        });
      })
    )
  );
  await page.goto("/contributions");
  await expect(page.getByRole("button", { name: "查看贡献记录 十月当前成果 2026-10-01", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上一月", exact: true }).click();
  await expect.poll(() => pending.length).toBe(2);
  await page.getByRole("button", { name: "下一月", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看贡献记录 十月当前成果 2026-10-01", exact: true })).toBeVisible();
  const responses = pending.map((route) => page.waitForResponse(route.request().url()));
  await Promise.all(
    pending.map((route) =>
      route.fulfill({
        json: route.request().url().includes("/entries/")
          ? { timezone: "Asia/Shanghai", results: [old], next_cursor: null }
          : {
              timezone: "Asia/Shanghai",
              month: "2026-09",
              totals: { earned: "8.00", reversed: "0.00", net: "8.00" },
              days: [],
            },
      })
    )
  );
  await Promise.all(responses);
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByLabel("选择月份", { exact: true })).toHaveValue("2026-10");
  await expect(page.getByRole("button", { name: "查看贡献记录 十月当前成果 2026-10-01", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看贡献记录 九月迟到成果 2026-09-30", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "VC 日历", exact: true }).getByRole("button", {
      name: "查看 2026-10-01 · 声学项目的 VC 明细",
      exact: true,
    })
  ).toContainText("+3.00");
});

test("loading the next page preserves entries without duplicating overlapping records", async ({ page }) => {
  await fixture(page);
  const newest = entry("最新验收", "2026-10-03", "12.00");
  const older = entry("上一笔验收", "2026-10-01", "7.00");
  let nextPage: Route | undefined;
  await page.route("**/api/workspaces/lab/lab/me/contributions/entries/**", (route) => {
    if (new URL(route.request().url()).searchParams.get("cursor")) {
      nextPage = route;
      return;
    }
    return route.fulfill({
      json: { timezone: "Asia/Shanghai", results: [newest], next_cursor: "older-page" },
    });
  });
  await page.goto("/contributions");
  const details = page.getByRole("region", { name: "VC 明细", exact: true });
  await expect(details.getByRole("button", { name: /^查看贡献记录/ })).toHaveCount(1);
  await page.getByRole("button", { name: "加载更多", exact: true }).click();
  await expect.poll(() => Boolean(nextPage)).toBe(true);
  await expect(page.getByRole("button", { name: "加载更多", exact: true })).toBeDisabled();
  expect(new URL(nextPage!.request().url()).searchParams.get("cursor")).toBe("older-page");
  await nextPage!.fulfill({ json: { timezone: "Asia/Shanghai", results: [newest, older], next_cursor: null } });
  await expect(details.getByRole("button", { name: /^查看贡献记录/ })).toHaveCount(2);
  await expect(details.getByRole("button", { name: "查看贡献记录 最新验收 2026-10-03", exact: true })).toBeVisible();
  await expect(details.getByRole("button", { name: "查看贡献记录 上一笔验收 2026-10-01", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "加载更多", exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "个人 VC 总额", exact: true }).getByText("35.00 VC", { exact: true })
  ).toBeVisible();
});

test("parent refresh fetches fresh totals and records without resetting the selected project", async ({ page }) => {
  await fixture(page);
  let refreshed = false;
  let summaryReads = 0;
  let entryReads = 0;
  await page.route("**/api/workspaces/lab/lab/me/contributions/", (route) => {
    summaryReads += 1;
    return route.fulfill({
      json: {
        ...summary,
        totals: refreshed ? { earned: "46.00", reversed: "5.00", net: "41.00" } : summary.totals,
      },
    });
  });
  await page.route("**/api/workspaces/lab/lab/me/contributions/entries/**", (route) => {
    entryReads += 1;
    return route.fulfill({
      json: {
        timezone: "Asia/Shanghai",
        results: [entry(refreshed ? "刚核准的成果" : "已核准的成果", "2026-10-01", refreshed ? "6.00" : "2.00")],
        next_cursor: null,
      },
    });
  });
  await page.goto("/contributions");
  await page.getByLabel("筛选项目", { exact: true }).selectOption("acoustic");
  await expect(page.getByRole("button", { name: "查看贡献记录 已核准的成果 2026-10-01", exact: true })).toBeVisible();
  const previousSummaryReads = summaryReads;
  const previousEntryReads = entryReads;
  refreshed = true;
  await page.evaluate(() => window.dispatchEvent(new Event("lab-refresh-contributions")));
  await expect(
    page.getByRole("region", { name: "个人 VC 总额", exact: true }).getByText("41.00 VC", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "查看贡献记录 刚核准的成果 2026-10-01", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看贡献记录 已核准的成果 2026-10-01", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("筛选项目", { exact: true })).toHaveValue("acoustic");
  await expect(page.getByLabel("选择月份", { exact: true })).toHaveValue("2026-10");
  expect(summaryReads).toBeGreaterThan(previousSummaryReads);
  expect(entryReads).toBeGreaterThan(previousEntryReads);
});

test("an empty contribution history stays usable and a failed read can be retried on refresh", async ({ page }) => {
  await fixture(page);
  let failEntries = false;
  let populated = false;
  await page.route("**/api/workspaces/lab/lab/me/contributions/", (route) =>
    route.fulfill({
      json: {
        timezone: "Asia/Shanghai",
        totals: { earned: "0.00", reversed: "0.00", net: "0.00" },
        projects: [],
      },
    })
  );
  await page.route("**/api/workspaces/lab/lab/me/contributions/calendar/**", (route) =>
    route.fulfill({
      json: {
        timezone: "Asia/Shanghai",
        month: new URL(route.request().url()).searchParams.get("month"),
        totals: { earned: "0.00", reversed: "0.00", net: "0.00" },
        days: [],
      },
    })
  );
  await page.route("**/api/workspaces/lab/lab/me/contributions/entries/**", (route) =>
    failEntries
      ? route.fulfill({ status: 503, json: { error: "贡献记录暂时无法读取" } })
      : route.fulfill({
          json: {
            timezone: "Asia/Shanghai",
            results: populated ? [entry("读取恢复后的历史", "2026-09-30", "3.00")] : [],
            next_cursor: null,
          },
        })
  );
  await page.goto("/contributions");
  await expect(page.getByText("暂无参与项目", { exact: true })).toBeVisible();
  await expect(page.getByText("暂无 VC 记录", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上一月", exact: true }).click();
  await expect(page.getByLabel("选择月份", { exact: true })).toHaveValue("2026-09");
  failEntries = true;
  await page.evaluate(() => window.dispatchEvent(new Event("lab-refresh-contributions")));
  await expect(page.getByRole("alert")).toHaveText("贡献记录暂时无法读取");
  await expect(page.getByRole("button", { name: /^查看贡献记录/ })).toHaveCount(0);
  failEntries = false;
  populated = true;
  await page.evaluate(() => window.dispatchEvent(new Event("lab-refresh-contributions")));
  await expect(
    page.getByRole("button", { name: "查看贡献记录 读取恢复后的历史 2026-09-30", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByLabel("选择月份", { exact: true })).toHaveValue("2026-09");
});

test("historical records show their snapshot without source reads while an authorized work item opens the native callback", async ({
  page,
}) => {
  await fixture(page);
  const historical = entry("归档前的声学贡献", "2026-10-01", "10.00", {
    project_id: "former",
    project: "已退出项目",
    archived: true,
  });
  const native = entry("可查看的原生任务", "2026-10-02", "4.00", {
    can_open_issue: true,
    archived: true,
  });
  const sourceReads: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/") && !request.url().includes("/me/contributions/"))
      sourceReads.push(request.url());
  });
  await page.addInitScript(() => {
    window.addEventListener("lab-open-project-issue", (event) => {
      document.documentElement.dataset.openedIssue = JSON.stringify((event as CustomEvent).detail);
    });
  });
  await page.route("**/api/workspaces/lab/lab/me/contributions/", (route) =>
    route.fulfill({
      json: {
        ...summary,
        projects: [
          ...summary.projects,
          {
            id: "former",
            name: "已退出项目",
            earned: "10.00",
            reversed: "0.00",
            net: "10.00",
            participation: ["history"],
            historical: true,
            can_open_project: false,
          },
        ],
      },
    })
  );
  await page.route("**/api/workspaces/lab/lab/me/contributions/entries/**", (route) =>
    route.fulfill({ json: { timezone: "Asia/Shanghai", results: [historical, native], next_cursor: null } })
  );
  await page.goto("/contributions");
  const project = page
    .getByRole("region", { name: "参与项目", exact: true })
    .locator("article")
    .filter({ hasText: "已退出项目" });
  await expect(project.getByText("历史参与", { exact: true })).toBeVisible();
  await expect(project.getByRole("link", { name: "打开项目", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "查看贡献记录 归档前的声学贡献 2026-10-01", exact: true }).click();
  const record = page.getByRole("dialog", { name: "贡献记录", exact: true });
  await expect(record.getByRole("heading", { name: "归档前的声学贡献", exact: true })).toBeVisible();
  await expect(record.getByText("已退出项目", { exact: true })).toBeVisible();
  await expect(record.getByText("+10.00 VC", { exact: true })).toBeVisible();
  await expect(record.getByRole("button", { name: "打开工作项", exact: true })).toHaveCount(0);
  await expect(record.getByRole("button", { name: "打开悬赏任务", exact: true })).toHaveCount(0);
  expect(sourceReads).toEqual([]);
  await record.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await page.getByRole("button", { name: "查看贡献记录 可查看的原生任务 2026-10-02", exact: true }).click();
  await record.getByRole("button", { name: "打开工作项", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-opened-issue",
    JSON.stringify({ issue_id: native.task_id, project_id: native.project_id, archived: true })
  );
  await expect(record).toHaveCount(0);
  expect(sourceReads).toEqual([]);
});

test("task-only contributions read explicit shared materials through controlled details and close when access is withdrawn", async ({
  page,
}) => {
  await fixture(page);
  const contribution = entry("跨项目声学验收", "2026-10-01", "20.00", {
    bounty_id: "task-only",
    can_open_bounty: true,
  });
  const bounty: LabBounty = {
    id: "task-only",
    stage_id: "stage",
    project_id: "acoustic",
    project: "声学项目",
    issue_id: contribution.task_id!,
    title: contribution.task_title,
    deliverable: "整理共享样本并提交声学分析报告",
    criteria: "提交可复现的参数和图表",
    budget: "20.00",
    reserved: null,
    awarded: "20.00",
    status: "done",
    major: false,
    major_reasons: [],
    evidence: "声学分析报告已验收",
    due_at: null,
    overdue: false,
    is_lead: false,
    is_reviewer: false,
    is_independent_reviewer: false,
    allocations: [],
    acceptances: [],
    access_level: "task",
    can_edit_issue: false,
    can_submit: false,
    can_manage_materials: false,
  };
  let detailReads = 0;
  let materialReads = 0;
  let authorized = true;
  const otherReads: string[] = [];
  page.on("request", (request) => {
    if (
      request.url().includes("/api/") &&
      !request.url().includes("/me/contributions/") &&
      !request.url().includes("/bounties/task-only/")
    )
      otherReads.push(request.url());
  });
  await page.route("**/api/workspaces/lab/lab/me/contributions/", (route) =>
    route.fulfill({
      json: {
        ...summary,
        projects: [{ ...summary.projects[0], participation: ["bounty"], can_open_project: false }],
      },
    })
  );
  await page.route("**/api/workspaces/lab/lab/me/contributions/entries/**", (route) =>
    route.fulfill({
      json: {
        timezone: "Asia/Shanghai",
        results: [{ ...contribution, can_open_bounty: authorized }],
        next_cursor: null,
      },
    })
  );
  await page.route("**/api/workspaces/lab/lab/bounties/task-only/detail/", (route) => {
    detailReads += 1;
    return route.fulfill({ json: bounty });
  });
  await page.route("**/api/workspaces/lab/lab/bounties/task-only/workflow/", (route) =>
    route.fulfill({
      json: {
        bounty_id: bounty.id,
        title: bounty.title,
        status: "done",
        major: false,
        current_node: "done",
        nodes: [{ id: "done", label: "完成与 VC 记账", state: "current", x: 0, y: 0 }],
        edges: [],
        history: [],
        actions: [],
      },
    })
  );
  await page.route("**/api/workspaces/lab/lab/bounties/task-only/materials/", (route) =>
    route.fulfill({
      json: {
        materials: [{ id: "shared-document", kind: "document_version", label: "声学样本操作资料" }],
      },
    })
  );
  await page.route("**/api/workspaces/lab/lab/bounties/task-only/materials/shared-document/", (route) => {
    materialReads += 1;
    if (materialReads === 1) return route.fulfill({ status: 503, json: { detail: "共享资料暂不可读取" } });
    return route.fulfill({
      json: {
        name: "负责人共享的样本版本",
        description_html: "<p>执行样本编号 A-12，分析频段为 2–8 kHz。</p>",
        created_at: "2026-09-20T09:00:00+08:00",
      },
    });
  });
  await page.goto("/contributions");
  await expect(
    page.getByRole("region", { name: "参与项目", exact: true }).getByText("悬赏参与", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "打开项目", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "查看贡献记录 跨项目声学验收 2026-10-01", exact: true }).click();
  const record = page.getByRole("dialog", { name: "贡献记录", exact: true });
  await expect(record.getByRole("button", { name: "打开工作项", exact: true })).toHaveCount(0);
  await record.getByRole("button", { name: "打开悬赏任务", exact: true }).click();
  const controlled = page.getByRole("dialog", { name: "悬赏任务详情", exact: true });
  await expect(controlled.getByText("20.00 VC", { exact: true })).toBeVisible();
  await expect(controlled.getByText(bounty.deliverable, { exact: true })).toBeVisible();
  await expect(controlled.getByRole("button", { name: "安排时间", exact: true })).toHaveCount(0);
  await controlled.getByRole("button", { name: "读取共享版本", exact: true }).click();
  await expect(controlled.getByRole("alert")).toHaveText("共享资料暂不可读取");
  await controlled.getByRole("button", { name: "读取共享版本", exact: true }).click();
  const shared = page.getByRole("dialog", { name: "负责人共享的样本版本", exact: true });
  await expect(shared.getByText("执行样本编号 A-12，分析频段为 2–8 kHz。", { exact: true })).toBeVisible();
  expect(materialReads).toBe(2);
  await shared.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await controlled.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await record.getByRole("button", { name: "打开悬赏任务", exact: true }).click();
  await expect(controlled.getByText("20.00 VC", { exact: true })).toBeVisible();
  expect(detailReads).toBe(2);
  authorized = false;
  await page.evaluate(() => window.dispatchEvent(new Event("lab-refresh-contributions")));
  await expect(controlled).toHaveCount(0);
  await expect(record.getByRole("heading", { name: contribution.task_title, exact: true })).toBeVisible();
  await expect(record.getByRole("button", { name: "打开悬赏任务", exact: true })).toHaveCount(0);
  authorized = true;
  await page.evaluate(() => window.dispatchEvent(new Event("lab-refresh-contributions")));
  await expect(record.getByRole("button", { name: "打开悬赏任务", exact: true })).toBeVisible();
  await expect(controlled).toHaveCount(0);
  expect(detailReads).toBe(2);
  expect(otherReads).toEqual([]);
});

test("switching workspaces closes the previous personal snapshot even when filters are identical", async ({ page }) => {
  await fixture(page);
  await page.route("**/api/workspaces/second/lab/me/contributions/", (route) =>
    route.fulfill({
      json: { timezone: "Asia/Shanghai", totals: { earned: "0.00", reversed: "0.00", net: "0.00" }, projects: [] },
    })
  );
  await page.route("**/api/workspaces/second/lab/me/contributions/calendar/**", (route) =>
    route.fulfill({
      json: {
        timezone: "Asia/Shanghai",
        month: "2026-10",
        totals: { earned: "0.00", reversed: "0.00", net: "0.00" },
        days: [],
      },
    })
  );
  await page.route("**/api/workspaces/second/lab/me/contributions/entries/**", (route) =>
    route.fulfill({ json: { timezone: "Asia/Shanghai", results: [], next_cursor: null } })
  );
  await page.goto("/contributions");
  await page.getByRole("button", { name: "查看贡献记录 声学样本 2026-10-01", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "贡献记录", exact: true })).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("lab-switch-contributions-workspace", { detail: "second" }))
  );
  await expect(
    page.getByRole("region", { name: "参与项目", exact: true }).getByText("暂无参与项目", { exact: true })
  ).toBeVisible();
  await expect(page.getByRole("dialog", { name: "贡献记录", exact: true })).toHaveCount(0);
  await expect(page.getByText("声学样本", { exact: true })).toHaveCount(0);
});

test("the contribution calendar and controls fit a narrow viewport without page overflow", async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.route("**/api/workspaces/lab/lab/me/contributions/calendar/**", (route) =>
    route.fulfill({
      json: {
        timezone: "Asia/Shanghai",
        month: new URL(route.request().url()).searchParams.get("month"),
        totals: { earned: "20.00", reversed: "5.00", net: "15.00" },
        days: [
          {
            day: "2026-10-01",
            project_id: "acoustic",
            project: "声学项目",
            earned: "0.00",
            reversed: "5.00",
            net: "-5.00",
            count: 1,
          },
          {
            day: "2026-10-02",
            project_id: "acoustic",
            project: "声学项目",
            earned: "20.00",
            reversed: "0.00",
            net: "20.00",
            count: 1,
          },
        ],
      },
    })
  );
  await page.route("**/api/workspaces/lab/lab/me/contributions/entries/**", (route) =>
    route.fulfill({
      json: {
        timezone: "Asia/Shanghai",
        results: [entry("声学分析报告", "2026-10-02", "20.00"), entry("样本校准更正", "2026-10-01", "-5.00")],
        next_cursor: null,
      },
    })
  );
  await page.goto("/contributions");
  await expect(page.getByRole("button", { name: "查看贡献记录 声学分析报告 2026-10-02", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "查看 2026-10-02 · 声学项目的 VC 明细", exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: "/tmp/lab-contributions-desktop.png", animations: "disabled", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByLabel("选择月份", { exact: true })).toBeVisible();
  await expect(page.getByLabel("筛选项目", { exact: true })).toBeVisible();
  const size = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(size.page).toBeLessThanOrEqual(size.viewport);
  const firstProject = await page.getByRole("button", { name: "筛选项目 声学项目", exact: true }).boundingBox();
  const zeroProject = await page.getByRole("button", { name: "筛选项目 待启动项目", exact: true }).boundingBox();
  if (!firstProject || !zeroProject) throw new Error("参与项目卡片未显示");
  expect(zeroProject.y).toBeGreaterThanOrEqual(firstProject.y + firstProject.height);
  expect(zeroProject.x).toBeGreaterThanOrEqual(0);
  expect(zeroProject.x + zeroProject.width).toBeLessThanOrEqual(size.viewport);
  await page.getByRole("button", { name: "查看 2026-10-02 的 VC 明细", exact: true }).click();
  await expect(page.getByRole("button", { name: "清除选日", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清除选日", exact: true }).click();
  await page.screenshot({ path: "/tmp/lab-contributions-mobile.png", animations: "disabled", fullPage: true });
});
