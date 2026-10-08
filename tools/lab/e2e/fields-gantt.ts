/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
/* oxlint-disable no-await-in-loop -- Browser view transitions and lifecycle assertions are intentionally sequential. */
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export async function verifyFieldsAndGantt(page: Page, fixture: { project: string; issue: string }) {
  if (process.env.LAB_E2E_PROJECT !== "ooa-plane-e2e")
    throw new Error("Field/Gantt browser tests require isolated services");
  const base = "/api/workspaces/browser-lab/lab/";
  const taskRowFor = (title: string) =>
    page.getByRole("row").filter({ has: page.getByRole("cell", { name: title, exact: true }) });
  console.log("lab fields: start");
  async function mutate(path: string, body: unknown, method = "POST") {
    const csrf = (await (await page.request.get("/auth/get-csrf-token/")).json()) as { csrf_token: string };
    const result = await page.request.fetch(path, {
      method,
      data: body,
      headers: { "X-CSRFToken": csrf.csrf_token },
      timeout: 30000,
    });
    expect(result.ok()).toBeTruthy();
    return result;
  }
  await page.goto("/browser-lab/lab/tasks");
  await expect(page.getByRole("heading", { name: "任务表格", exact: true })).toBeVisible();
  await page.getByLabel("项目筛选", { exact: true }).selectOption(fixture.project);
  await page.getByRole("button", { name: "管理字段", exact: true }).click();
  await page.getByRole("button", { name: "新建字段", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("字段名称", { exact: true }).fill("浏览器实验参数");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const enabledSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/projects/${fixture.project}/fields/`) && response.request().method() === "PUT",
    { timeout: 30000 }
  );
  await page.getByLabel("启用 浏览器实验参数", { exact: true }).check();
  expect((await enabledSaved).status()).toBe(200);
  const valueSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/tasks/${fixture.issue}/field-values/`) && response.request().method() === "PATCH",
    { timeout: 30000 }
  );
  const editor = taskRowFor("Original project task").getByRole("textbox", { name: "浏览器实验参数", exact: true });
  await editor.fill("实测参数 42");
  await editor.press("Tab");
  expect((await valueSaved).status()).toBe(200);
  await page.getByRole("textbox", { name: "筛选 浏览器实验参数", exact: true }).fill("实测参数");
  await expect(page.getByRole("cell", { name: "Original project task", exact: true })).toBeVisible();
  const exported = page.waitForEvent("download", { timeout: 30000 });
  await page.getByRole("button", { name: "导出筛选结果", exact: true }).click();
  expect(readFileSync((await (await exported).path())!, "utf8")).toContain("实测参数 42");
  console.log("lab fields: definition, inline value, filter and export passed");
  // Complete real responses in reverse order: selected project B must retain rows,
  // editable field configuration and exports after the slower A response arrives.
  const planner = (await (await page.request.get(base + "planner/")).json()) as { user_id: string };
  const otherProject = (await (
    await mutate("/api/workspaces/browser-lab/projects/", {
      name: "Table response ordering",
      identifier: "ORDER",
      project_lead: planner.user_id,
    })
  ).json()) as { id: string };
  const definitions = (await (await page.request.get(base + "field-definitions/")).json()) as {
    fields: { id: string; name: string }[];
  };
  const parameter = definitions.fields.find((field) => field.name === "浏览器实验参数")!;
  await mutate(base + `projects/${otherProject.id}/fields/`, { ids: [parameter.id] }, "PUT");
  const otherTask = (await (
    await mutate(`/api/workspaces/browser-lab/projects/${otherProject.id}/issues/`, {
      name: "Latest selected project task",
    })
  ).json()) as { id: string };
  await mutate(
    base + `tasks/${otherTask.id}/field-values/`,
    { values: { [parameter.id]: "Project B value" } },
    "PATCH"
  );
  await page.goto("/browser-lab/lab/tasks");
  const projectFilter = page.getByLabel("项目筛选", { exact: true });
  await projectFilter.selectOption(otherProject.id);
  await expect(page.getByRole("cell", { name: "Latest selected project task", exact: true })).toBeVisible();
  const latestProjectEditor = taskRowFor("Latest selected project task").getByRole("textbox", {
    name: "浏览器实验参数",
    exact: true,
  });
  async function reversedResponse(pattern: RegExp) {
    let release!: () => void;
    let captured!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const arrived = new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error("Project response was not captured within 30 seconds")),
        30000
      );
      captured = () => {
        clearTimeout(deadline);
        resolve();
      };
    });
    await page.route(pattern, async (route) => {
      const response = await route.fetch();
      captured();
      await held;
      await route.fulfill({ response });
    });
    await projectFilter.selectOption(fixture.project);
    await arrived;
    await projectFilter.selectOption(otherProject.id);
    await expect(page.getByRole("cell", { name: "Latest selected project task", exact: true })).toBeVisible();
    await expect(latestProjectEditor).toBeEnabled();
    const late = page.waitForResponse((response) => pattern.test(response.url()), { timeout: 30000 });
    release();
    await (await late).finished();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    );
    await expect(page.getByRole("cell", { name: "Latest selected project task", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "Original project task", exact: true })).not.toBeVisible();
    await expect(latestProjectEditor).toBeEnabled();
    const download = page.waitForEvent("download", { timeout: 30000 });
    await page.getByRole("button", { name: "导出筛选结果", exact: true }).click();
    const csv = readFileSync((await (await download).path())!, "utf8");
    expect(csv).toContain("Latest selected project task");
    expect(csv).not.toContain("Original project task");
    await page.unroute(pattern);
  }
  await reversedResponse(new RegExp(`/lab/task-table/[?]project=${fixture.project}$`));
  await reversedResponse(new RegExp(`/lab/projects/${fixture.project}/fields/$`));
  console.log("lab fields: project response ordering passed");
  // Real native task endpoint and canonical relations, using the existing test account session.
  const successorResponse = await mutate(`/api/workspaces/browser-lab/projects/${fixture.project}/issues/`, {
    name: "Gantt downstream task",
    start_date: "2026-11-03",
    target_date: "2026-11-05",
  });
  const successor = (await successorResponse.json()) as { id: string };
  await mutate(base + `projects/${fixture.project}/gantt/preview/`, {
    issue_id: fixture.issue,
    start_date: "2026-11-01",
    target_date: "2026-11-02",
  }).then(async (result) => {
    const preview = (await result.json()) as { token: string };
    return mutate(base + `projects/${fixture.project}/gantt/commit/`, { token: preview.token });
  });
  await page.goto(`/browser-lab/projects/${fixture.project}/issues`);
  const gantt = page.getByRole("button", { name: /时间线|Timeline|甘特|Gantt/i }).first();
  if ((await gantt.getAttribute("aria-pressed")) !== "true") await gantt.click();
  await expect(page.getByTestId("lab-project-gantt")).toBeVisible();
  await expect(page.locator(".lab-frappe-gantt svg.gantt")).toBeVisible();
  console.log("lab gantt: native project timeline rendered");
  // Real Chromium listener counts catch retained chart instances after React rebuilds.
  const cdp = await page.context().newCDPSession(page);
  async function mouseUpListeners(): Promise<number> {
    const documentHandle = await cdp.send("Runtime.evaluate", {
      expression: "document",
      objectGroup: "lab-gantt-lifecycle",
    });
    const listeners = await cdp.send("DOMDebugger.getEventListeners", { objectId: documentHandle.result.objectId! });
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "lab-gantt-lifecycle" });
    return listeners.listeners.filter((listener) => listener.type === "mouseup").length;
  }
  const mountedListeners = await mouseUpListeners();
  expect(mountedListeners).toBeGreaterThan(0);
  for (const mode of ["Day", "Month", "Week", "Day", "Week"]) {
    await page.getByLabel("甘特图时间尺度", { exact: true }).selectOption(mode);
    await expect(page.locator(".lab-frappe-gantt svg.gantt")).toBeVisible();
    await expect.poll(mouseUpListeners).toBe(mountedListeners);
  }
  for (let refresh = 0; refresh < 2; refresh += 1) {
    await page.getByTestId("lab-project-gantt").getByRole("button", { name: "刷新", exact: true }).click();
    await expect(page.locator(".lab-frappe-gantt svg.gantt")).toBeVisible();
    await expect.poll(mouseUpListeners).toBe(mountedListeners);
  }
  const kanban = page.getByRole("button", { name: /看板|Kanban/i }).first();
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await kanban.click();
    await expect(page.getByTestId("lab-project-gantt")).not.toBeVisible();
    await expect.poll(mouseUpListeners).toBe(mountedListeners - 1);
    await gantt.click();
    await expect(page.locator(".lab-frappe-gantt svg.gantt")).toBeVisible();
    await expect.poll(mouseUpListeners).toBe(mountedListeners);
  }
  await cdp.detach();
  console.log("lab gantt: chart disposal regression passed");
  await page.getByTestId("lab-project-gantt").getByRole("button", { name: "任务依赖", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("前置任务", { exact: true }).selectOption(fixture.issue);
  await dialog.getByLabel("后续任务", { exact: true }).selectOption(successor.id);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "移除", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const taskRow = page.getByTestId(`gantt-task-${fixture.issue}`);
  await taskRow.getByRole("button", { name: "排期", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("开始日期", { exact: true }).fill("2026-11-05");
  await dialog.getByLabel("截止日期", { exact: true }).fill("2026-11-06");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "确认日期联动", exact: true })).toBeVisible();
  await expect(dialog).toContainText("Gantt downstream task");
  await expect(dialog).toContainText("2026-11-07");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const data = (await (await page.request.get(base + `projects/${fixture.project}/gantt/`)).json()) as {
    tasks: { id: string; start_date: string; target_date: string }[];
  };
  expect(data.tasks.find((task) => task.id === successor.id)).toMatchObject({
    start_date: "2026-11-07",
    target_date: "2026-11-09",
  });
  console.log("lab gantt: dependencies and confirmed date propagation passed");
}
