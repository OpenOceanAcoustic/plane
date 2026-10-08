/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
/* oxlint-disable no-await-in-loop -- Each public browser scenario verifies a distinct request lifecycle. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const webRequire = createRequire(new URL("../../apps/web/package.json", import.meta.url));
const uiRequire = createRequire(new URL("../../packages/ui/package.json", import.meta.url));
const viteRequire = createRequire(webRequire.resolve("vite"));
const { build } = viteRequire("esbuild");
const require = createRequire(new URL("../../package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const built = await build({
  entryPoints: [fileURLToPath(new URL("browser/fields-harness.tsx", import.meta.url))],
  bundle: true,
  write: false,
  outfile: "/tmp/lab-fields-gantt-harness.js",
  platform: "browser",
  format: "esm",
  jsx: "automatic",
  define: { "process.env": '{"NODE_ENV":"development"}' },
  alias: {
    react: dirname(uiRequire.resolve("react")),
    "react-dom": dirname(webRequire.resolve("react-dom")),
    "mobx-react": webRequire.resolve("mobx-react"),
    "@plane/shared-state": fileURLToPath(new URL("../../packages/shared-state/src/lab.store.ts", import.meta.url)),
    "@plane/ui": fileURLToPath(new URL("browser/ui-entry.ts", import.meta.url)),
  },
});
const script = built.outputFiles.find((file) => file.path.endsWith(".js"));
if (!script) throw new Error("Fields/Gantt harness JavaScript was not generated");
const styles = built.outputFiles.find((file) => file.path.endsWith(".css"))?.text ?? "";
const server = createServer((request, response) => {
  response.setHeader("Content-Type", request.url === "/harness.js" ? "text/javascript" : "text/html; charset=utf-8");
  response.end(
    request.url === "/harness.js"
      ? script.contents
      : `<!DOCTYPE html><html lang="zh-CN"><head><style>${styles}</style></head><body><div id="root"></div><script type="module" src="/harness.js"></script></body></html>`
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch();
const field = { id: "parameter", name: "实验参数", kind: "text", options: [], archived: false, enabled: false };
try {
  for (const scenario of ["success", "failure", "switch-success", "switch-failure", "unmount"]) {
    const page = await browser.newPage();
    let release;
    let captured;
    const held = new Promise((resolve) => (release = resolve));
    const arrived = new Promise((resolve) => (captured = resolve));
    await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "isolated-test" } }));
    await page.route("**/api/workspaces/lab/lab/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() === "PUT") {
        assert.deepEqual(route.request().postDataJSON(), { ids: [field.id] });
        captured();
        await held;
        await route.fulfill({
          status: scenario.endsWith("failure") ? 500 : 200,
          json: scenario.endsWith("failure")
            ? { error: "保存失败，请重试" }
            : { fields: [{ ...field, enabled: true }] },
        });
        return;
      }
      await route.fulfill({
        json: {
          fields: [{ ...field, enabled: scenario === "switch-failure" && path.includes("/projects/B/") }],
          can_manage: true,
        },
      });
    });
    await page.goto(`http://127.0.0.1:${port}`);
    const checkbox = page.getByLabel("启用 实验参数", { exact: true });
    await expect(checkbox).toBeVisible();
    await checkbox.check({ timeout: 5000 });
    await arrived;
    await expect(checkbox).toBeChecked();
    await expect(checkbox).toBeDisabled();
    if (scenario.startsWith("switch")) {
      await page.getByLabel("选择项目", { exact: true }).selectOption("B");
      await expect(checkbox).toBeChecked({ checked: scenario === "switch-failure" });
    } else if (scenario === "unmount") {
      await page.getByRole("button", { name: "切换字段管理", exact: true }).click();
      await expect(checkbox).not.toBeVisible();
    }
    const completed = page.waitForResponse(
      (response) => response.url().endsWith("/projects/A/fields/") && response.request().method() === "PUT",
      { timeout: 5000 }
    );
    release();
    await (await completed).finished();
    if (scenario === "success") {
      await expect(checkbox).toBeChecked();
      await expect(checkbox).toBeEnabled();
      await expect(page.getByRole("status")).toHaveText("已保存 A");
    } else if (scenario === "failure") {
      await expect(checkbox).not.toBeChecked();
      await expect(checkbox).toBeEnabled();
      await expect(page.getByRole("alert")).toContainText("保存失败");
    } else {
      if (scenario.startsWith("switch")) {
        await expect(checkbox).toBeChecked({ checked: scenario === "switch-failure" });
        await expect(checkbox).toBeEnabled();
      }
      await expect(page.getByRole("status")).not.toBeVisible();
      await expect(page.getByRole("alert")).not.toBeVisible();
    }
    await page.close();
    console.log(`field toggle ${scenario}: passed`);
  }
  const page = await browser.newPage();
  const tasks = [
    {
      id: "predecessor",
      title: "原任务",
      key: "LAB-1",
      project_id: "A",
      start_date: "2026-11-01",
      target_date: "2026-11-02",
      state: "待办",
      state_group: "unstarted",
      external_dependency: false,
    },
    {
      id: "successor",
      title: "后续任务",
      key: "LAB-2",
      project_id: "A",
      start_date: "2026-11-03",
      target_date: "2026-11-05",
      state: "待办",
      state_group: "unstarted",
      external_dependency: false,
    },
  ];
  let dependencies = [];
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "isolated-test" } }));
  await page.route("**/api/workspaces/lab/lab/projects/A/gantt/**", async (route) => {
    const method = route.request().method();
    const path = new URL(route.request().url()).pathname;
    if (method === "GET") {
      await route.fulfill({ json: { tasks, dependencies } });
    } else if (path.endsWith("/dependencies/")) {
      if (method === "POST") {
        assert.deepEqual(route.request().postDataJSON(), { predecessor_id: "predecessor", successor_id: "successor" });
        dependencies = [{ id: "dependency", predecessor_id: "predecessor", successor_id: "successor" }];
      } else {
        assert.deepEqual(route.request().postDataJSON(), { id: "dependency" });
        dependencies = [];
      }
      await route.fulfill({ json: { dependencies } });
    } else if (path.endsWith("/preview/")) {
      assert.deepEqual(route.request().postDataJSON(), {
        issue_id: "predecessor",
        start_date: "2026-11-05",
        target_date: "2026-11-06",
      });
      await route.fulfill({
        json: {
          token: "isolated-preview",
          changes: tasks.map((task, index) => ({
            ...task,
            old_start_date: task.start_date,
            old_target_date: task.target_date,
            start_date: index ? "2026-11-07" : "2026-11-05",
            target_date: index ? "2026-11-09" : "2026-11-06",
          })),
        },
      });
    } else if (path.endsWith("/commit/")) {
      assert.deepEqual(route.request().postDataJSON(), { token: "isolated-preview" });
      tasks[0].start_date = "2026-11-05";
      tasks[0].target_date = "2026-11-06";
      tasks[1].start_date = "2026-11-07";
      tasks[1].target_date = "2026-11-09";
      await route.fulfill({ json: { tasks } });
    } else throw new Error("Unexpected Gantt test endpoint");
  });
  await page.goto(`http://127.0.0.1:${port}/gantt`);
  await page.getByRole("button", { name: "任务依赖", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "前置任务", exact: true })).toBeVisible({ timeout: 5000 });
  await dialog.getByLabel("前置任务", { exact: true }).selectOption("predecessor");
  await dialog.getByLabel("后续任务", { exact: true }).selectOption("successor");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "移除", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "移除", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "移除", exact: true })).not.toBeVisible();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  for (const confirm of [false, true]) {
    await page.getByTestId("gantt-task-predecessor").getByRole("button", { name: "排期", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("开始日期", { exact: true }).fill("2026-11-05");
    await dialog.getByLabel("截止日期", { exact: true }).fill("2026-11-06");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "确认日期联动", exact: true })).toBeVisible();
    await expect(dialog).toContainText("后续任务");
    await expect(dialog).toContainText("2026-11-07");
    await dialog.getByRole("button", { name: confirm ? "保存" : "取消", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await expect(page.getByTestId("gantt-task-successor")).toContainText(
      confirm ? "2026-11-07 → 2026-11-09" : "2026-11-03 → 2026-11-05"
    );
  }
  await page.close();
  console.log("gantt accessibility, dependency create/remove and date preview cancel/confirm: passed");
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
