/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const projects = [
  { id: "project-a", name: "声学项目" },
  { id: "project-b", name: "算法项目" },
];
const thread = {
  id: "thread-a",
  title: "测试会话",
  project_id: "project-a",
  project_name: "声学项目",
  last_message_at: null,
};
const timeDraft = (work: string) => ({
  kind: "time",
  project_id: "project-a",
  project_name: "声学项目",
  date: "2026-10-23",
  hours: "2",
  rate: "",
  user_id: "member",
  user_name: "成员",
  work,
});

async function setup(page: Page) {
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test-csrf" } }));
  await page.route("**/api/workspaces/lab/lab/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/planner/"))
      return route.fulfill({ json: { projects, folders: [], items: [], categories: [] } });
    if (url.pathname.endsWith("/finance/overview/")) return route.fulfill({ json: { accounts: [] } });
    return route.fulfill({ json: [] });
  });
}

test("same-day drafts keep separate rates and confirmations survive reload", async ({ page }) => {
  await setup(page);
  const messages = [
    { id: "draft-a", role: "assistant", content: "第一条工时", draft: timeDraft("采集样本") },
    { id: "draft-b", role: "assistant", content: "第二条工时", draft: timeDraft("分析样本") },
  ];
  const confirmed: { id: string; rate: string }[] = [];
  await page.route("**/agent/threads/", (route) => route.fulfill({ json: [thread] }));
  await page.route("**/agent/threads/thread-a/", (route) => route.fulfill({ json: { ...thread, messages } }));
  await page.route("**/agent/messages/*/confirm/", async (route) => {
    const id = route.request().url().split("/").at(-3)!;
    const { rate } = route.request().postDataJSON();
    confirmed.push({ id, rate });
    const message = messages.find((item) => item.id === id)!;
    Object.assign(message.draft, { execution: { status: "executed", executed_at: "2026-10-23" } });
    await route.fulfill({ json: { draft: message.draft } });
  });
  await page.goto("/agent-chat");
  await expect(page.getByLabel("AI 项目")).toHaveValue("project-a");
  const rates = page.getByLabel("时薪", { exact: true });
  await rates.nth(0).fill("80");
  await rates.nth(1).fill("120");
  await page.getByRole("button", { name: "确认登记", exact: true }).nth(0).click();
  await expect(page.getByRole("button", { name: "已登记", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "确认登记", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "确认登记", exact: true }).click();
  await expect
    .poll(() => confirmed)
    .toEqual([
      { id: "draft-a", rate: "80" },
      { id: "draft-b", rate: "120" },
    ]);
  await page.reload();
  await expect(page.getByRole("button", { name: "已登记", exact: true })).toHaveCount(2);
  expect(confirmed).toHaveLength(2);
});

test("a server project switch updates the next request and blocks overlapping navigation", async ({ page }) => {
  await setup(page);
  const bodies: { project_id: string; thread_id?: string }[] = [];
  let finish: (() => void) | undefined;
  await page.route("**/agent/chat/", async (route) => {
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    await route.fulfill({
      json: {
        intent: bodies.length === 1 ? "project_switch" : "query",
        reply: "已切换到算法项目",
        project_id: "project-b",
        thread_id: "thread-b",
        message_id: "reply-1",
        draft: null,
      },
    });
  });
  await page.goto("/agent-chat");
  await expect(page.getByLabel("AI 项目")).toHaveValue("project-a");
  await page.getByLabel("给 AI 助手发消息").fill("切换到算法项目");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(1);
  await expect(page.getByLabel("AI 项目")).toBeDisabled();
  await expect(page.getByRole("button", { name: "新对话", exact: true })).toBeDisabled();
  finish!();
  await expect(page.getByLabel("AI 项目")).toHaveValue("project-b");
  await page.getByLabel("给 AI 助手发消息").fill("当前负责人是谁");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]).toMatchObject({ project_id: "project-b", thread_id: "thread-b" });
});

test("first shortcut creates a thread and restores its card after reload", async ({ page }) => {
  await setup(page);
  let created = false;
  const saved: { thread_id: string; project_id: string; content: string; draft: unknown }[] = [];
  await page.route("**/agent/threads/", (route) => {
    if (route.request().method() === "POST") {
      created = true;
      return route.fulfill({ status: 201, json: thread });
    }
    return route.fulfill({ json: created ? [thread] : [] });
  });
  await page.route("**/agent/quality/**", (route) =>
    route.fulfill({
      json: {
        project: projects[0],
        counts: { records: 1, current: 0, stale: 0, missing: 1, pending: 0 },
        missing: [{ key: "acceptance", label: "验收记录" }],
        stale: [],
        pending: [],
        suggestions: [],
      },
    })
  );
  await page.route("**/agent/messages/", (route) => {
    saved.push(route.request().postDataJSON());
    return route.fulfill({ json: { id: "card-1" } });
  });
  await page.route("**/agent/threads/thread-a/", (route) =>
    route.fulfill({
      json: { ...thread, messages: saved.map((item) => ({ ...item, id: "card-1", role: "assistant" })) },
    })
  );
  await page.goto("/agent-chat");
  await expect(page.getByLabel("AI 项目")).toHaveValue("project-a");
  await page.getByRole("button", { name: "质量检查", exact: true }).click();
  await expect.poll(() => saved.length).toBe(1);
  expect(saved[0].thread_id).toBe("thread-a");
  expect(saved[0].project_id).toBe("project-a");
  await page.reload();
  await expect(page.getByText("验收记录", { exact: true })).toBeVisible();
});

test("a newly returned financial draft uses the server message ID for safe retries", async ({ page }) => {
  await setup(page);
  let attempts = 0;
  const ids: string[] = [];
  await page.route("**/agent/chat/", (route) =>
    route.fulfill({
      json: {
        intent: "time_entry",
        reply: "请确认工时",
        thread_id: "thread-a",
        message_id: "persisted-draft",
        project_id: "project-a",
        draft: { ...timeDraft("分析信号"), rate: "100" },
      },
    })
  );
  await page.route("**/agent/messages/*/confirm/", (route) => {
    ids.push(route.request().url().split("/").at(-3)!);
    attempts += 1;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { detail: "暂时不可用" } })
      : route.fulfill({
          json: { draft: { ...timeDraft("分析信号"), rate: "100", execution: { status: "executed" } } },
        });
  });
  await page.goto("/agent-chat");
  await expect(page.getByLabel("AI 项目")).toHaveValue("project-a");
  await page.getByLabel("给 AI 助手发消息").fill("分析信号2小时，100元每小时");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("button", { name: "确认登记", exact: true }).click();
  await expect(page.getByText("暂时不可用", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认登记", exact: true }).click();
  await expect(page.getByRole("button", { name: "已登记", exact: true })).toBeDisabled();
  expect(ids).toEqual(["persisted-draft", "persisted-draft"]);
});

test("switching projects disables old project issue and plan confirmations", async ({ page }) => {
  await setup(page);
  const messages = [
    {
      id: "issue-draft",
      role: "assistant",
      content: "发布到声学项目",
      draft: {
        kind: "project_issue",
        project_id: "project-a",
        title: "采样校准",
        description: "",
        acceptance: "误差小于1%",
        assignee_id: "",
        assignee_name: "",
        due_date: "",
        priority: "medium",
      },
    },
    {
      id: "plan-draft",
      role: "assistant",
      content: "声学项目计划",
      draft: {
        kind: "project_plan",
        project_id: "project-a",
        summary: "声学计划",
        stages: [],
        risks: [],
        assumptions: [],
      },
    },
  ];
  await page.route("**/agent/threads/", (route) => route.fulfill({ json: [thread] }));
  await page.route("**/agent/threads/thread-a/", (route) => route.fulfill({ json: { ...thread, messages } }));
  await page.route("**/agent/chat/", (route) =>
    route.fulfill({
      json: {
        intent: "project_switch",
        reply: "已切换到算法项目",
        project_id: "project-b",
        thread_id: "thread-a",
        message_id: "switch-1",
        draft: null,
      },
    })
  );
  await page.goto("/agent-chat");
  await expect(page.getByRole("button", { name: "确认发布到项目" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "确认导入项目" })).toBeEnabled();
  await page.getByLabel("给 AI 助手发消息").fill("切换到算法项目");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByLabel("AI 项目")).toHaveValue("project-b");
  await expect(page.getByRole("button", { name: "确认发布到项目" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "确认导入项目" })).toBeDisabled();
});

test("a drawer at mobile width fits its viewport without horizontal scrolling", async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/agent-chat");
  await expect(page.getByLabel("AI 项目")).toHaveValue("project-a");
  const bounds = await page.locator(".lab-agent-drawer").boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
