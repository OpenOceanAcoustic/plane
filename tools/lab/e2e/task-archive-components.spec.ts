/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import type { LabTaskRow } from "../../../packages/types/src/index";

let server: ReturnType<typeof createServer>;
let directory = "";
let origin = "";
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "lab-task-archive-"));
  const require = createRequire(resolve("apps/web/package.json"));
  const { build } = require("esbuild") as typeof import("esbuild");
  await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router';import {observer} from 'mobx-react';import {LabStore} from '${resolve("packages/shared-state/src/lab.store.ts")}';import {LabTaskTable} from '${resolve("apps/web/core/components/lab/task-table.tsx")}';const store=new LabStore('','test');store.planner={projects:window.archiveProjects||[{id:'project',name:'实验项目'}]};const Result=observer(()=> <><p role="alert">{store.error}</p><p role="status">{store.notice}</p></>);createRoot(document.getElementById('root')).render(<MemoryRouter><Result/><LabTaskTable store={store}/></MemoryRouter>);`,
      resolveDir: resolve("apps/web"),
      loader: "tsx",
      sourcefile: "archive-harness.tsx",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    outfile: join(directory, "app.js"),
    define: { "process.env.NODE_ENV": '"test"', "process.env": "{}" },
    loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl" },
    logLevel: "silent",
  });
  server = createServer(async (request, response) => {
    const file = request.url === "/app.js" ? "app.js" : request.url === "/app.css" ? "app.css" : null;
    response.setHeader("Content-Type", file === "app.js" ? "text/javascript" : file ? "text/css" : "text/html");
    response.end(
      file
        ? await readFile(join(directory, file))
        : '<!doctype html><html><head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
  if (directory) await rm(directory, { recursive: true });
});

const row: LabTaskRow = {
  id: "finished",
  key: "LAB-1",
  title: "已完成实验",
  project_id: "project",
  project: "实验项目",
  state: "已完成",
  priority: "none",
  start_date: null,
  target_date: null,
  completed_at: "2026-10-15T10:00:00Z",
  completed_date: "2026-10-15",
  archived_at: null,
  revision: "revision-before",
  editable: true,
  values: { parameter: "完整实验记录" },
};
async function mocks(page: Page, canManage = true) {
  let archived = false;
  const requests: { path: string; method: string; body: Record<string, unknown> | null }[] = [];
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/lab/planner/", (route) =>
    route.fulfill({ json: { projects: [{ id: "project", name: "实验项目" }] } })
  );
  await page.route("**/lab/projects/*/fields/", (route) =>
    route.fulfill({
      json: { fields: [{ id: "parameter", name: "实验数据", kind: "text", enabled: true }], members: [] },
    })
  );
  await page.route("**/lab/task-table/**", (route) => {
    const url = new URL(route.request().url());
    requests.push({ path: url.pathname + url.search, method: "GET", body: null });
    return route.fulfill({
      json: {
        tasks:
          url.searchParams.get("archived") === "1"
            ? archived
              ? [
                  {
                    ...row,
                    archived_at: "2026-10-18",
                    revision: "revision-archived",
                    editable: false,
                    can_restore_issue: canManage,
                  },
                ]
              : []
            : archived
              ? []
              : [row],
        fields: [{ id: "parameter", name: "实验数据", kind: "text", enabled: true }],
        can_archive: canManage,
      },
    });
  });
  await page.route("**/lab/tasks/archive-preview/", (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    requests.push({ path: "preview", method: "POST", body });
    return route.fulfill({
      json: { cutoff: body.cutoff, total: 1, tasks: [row], preview_token: `snapshot-${String(body.cutoff)}` },
    });
  });
  await page.route("**/lab/tasks/archive/", (route) => {
    requests.push({ path: "archive", method: "POST", body: route.request().postDataJSON() });
    archived = true;
    return route.fulfill({ json: { archived: 1 } });
  });
  await page.route("**/lab/tasks/*/restore/", (route) => {
    requests.push({ path: "restore", method: "POST", body: route.request().postDataJSON() });
    archived = false;
    return route.fulfill({ json: { restored: true } });
  });
  return {
    requests,
    setArchived: () => {
      archived = true;
    },
  };
}

test("date preview archives only after confirmation and archived records restore the same work item", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fixture = await mocks(page);
  await page.goto(origin);
  await page.getByRole("button", { name: "按日期归档", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "按日期归档", exact: true });
  await dialog.getByLabel("完成截止日期（含当天）", { exact: true }).fill("2026-10-15");
  await dialog.getByRole("button", { name: "预览归档", exact: true }).click();
  await expect(dialog.getByRole("region", { name: "待归档工作项" })).toContainText(row.title);
  expect(fixture.requests.filter((r) => r.path === "archive")).toHaveLength(0);
  await dialog.getByRole("button", { name: "归档 1 项", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("link", { name: row.title, exact: true })).toHaveCount(0);
  expect(fixture.requests.find((r) => r.path === "archive")?.body).toEqual({ preview_token: "snapshot-2026-10-15" });
  await page.getByLabel("工作项范围", { exact: true }).selectOption("archived");
  await expect(page.getByRole("link", { name: row.title, exact: true })).toHaveAttribute(
    "href",
    "/test/projects/project/archives/issues/finished"
  );
  await expect(page.getByRole("textbox", { name: "实验数据", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: `恢复工作项${row.title}`, exact: true }).click();
  await page
    .getByRole("dialog", { name: "恢复工作项", exact: true })
    .getByRole("button", { name: "恢复", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(fixture.requests.find((r) => r.path === "restore")?.body).toEqual({ expected_revision: "revision-archived" });
  await page.getByLabel("工作项范围", { exact: true }).selectOption("current");
  await expect(page.getByRole("link", { name: row.title, exact: true })).toHaveAttribute(
    "href",
    "/test/projects/project/issues/finished"
  );
  expect(errors).toEqual([]);
});

test("changing the cutoff and a stale snapshot both require a new preview", async ({ page }) => {
  await mocks(page);
  await page.route("**/lab/tasks/archive/", (route) =>
    route.fulfill({ status: 409, json: { detail: "工作项已变化，请重新预览" } })
  );
  await page.goto(origin);
  await page.getByRole("button", { name: "按日期归档", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("完成截止日期（含当天）", { exact: true }).fill("2026-10-14");
  await dialog.getByRole("button", { name: "预览归档", exact: true }).click();
  await expect(dialog.getByRole("button", { name: "归档 1 项", exact: true })).toBeVisible();
  await dialog.getByLabel("完成截止日期（含当天）", { exact: true }).fill("2026-10-15");
  await expect(dialog.getByRole("button", { name: "归档 1 项", exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "预览归档", exact: true }).click();
  await dialog.getByRole("button", { name: "归档 1 项", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("重新预览");
  await expect(dialog.getByRole("button", { name: "预览归档", exact: true })).toBeVisible();
});

test("archive records filter by either completion or archive date and retain search", async ({ page }) => {
  const fixture = await mocks(page);
  fixture.setArchived();
  await page.goto(origin);
  await page.getByLabel("工作项范围", { exact: true }).selectOption("archived");
  await page.getByLabel("归档记录开始日期", { exact: true }).fill("2026-10-15");
  await page.getByLabel("归档记录结束日期", { exact: true }).fill("2026-10-18");
  await expect.poll(() => fixture.requests.at(-1)?.path).toContain("archived_from=2026-10-15&archived_to=2026-10-18");
  await page.getByLabel("日期依据", { exact: true }).selectOption("completed");
  await expect.poll(() => fixture.requests.at(-1)?.path).toContain("completed_from=2026-10-15&completed_to=2026-10-18");
  await page.getByLabel("搜索任务与字段", { exact: true }).fill("完整实验记录");
  await expect(page.getByRole("link", { name: row.title, exact: true })).toBeVisible();
});

test("read-only project users can find records without archive or restore actions", async ({ page }) => {
  const fixture = await mocks(page, false);
  fixture.setArchived();
  await page.goto(origin);
  await expect(page.getByRole("button", { name: "按日期归档", exact: true })).toHaveCount(0);
  await page.getByLabel("工作项范围", { exact: true }).selectOption("archived");
  await expect(page.getByRole("link", { name: row.title, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: `恢复工作项${row.title}`, exact: true })).toHaveCount(0);
});

test("archive and restore complete through browser controls and the real Django API", async ({ browser }) => {
  test.skip(!process.env.LAB_ARCHIVE_LIVE_FIXTURE, "Run through the isolated Django browser contract");
  const fixture = JSON.parse(await readFile(process.env.LAB_ARCHIVE_LIVE_FIXTURE!, "utf8")) as {
    server: string;
    base: string;
    project: string;
    issue: string;
    cookie: { name: string; value: string };
  };
  const context = await browser.newContext();
  try {
    await context.addCookies([
      { ...fixture.cookie, url: fixture.server },
      { ...fixture.cookie, url: origin },
    ]);
    const page = await context.newPage();
    await page.addInitScript(
      (id) => Object.assign(window, { archiveProjects: [{ id, name: "Acoustics" }] }),
      fixture.project
    );
    async function proxy(route: Route) {
      const url = new URL(route.request().url());
      const headers: Record<string, string> = {
        ...route.request().headers(),
        origin: fixture.server,
        referer: fixture.server + "/",
      };
      delete headers.host;
      const response = await route.fetch({
        url: fixture.server + url.pathname.replace("/api/workspaces/test/lab/", fixture.base) + url.search,
        headers,
      });
      await route.fulfill({ response });
    }
    await page.route("**/api/**", proxy);
    await page.route("**/auth/**", proxy);
    await page.goto(origin);
    await page.getByLabel("项目筛选", { exact: true }).selectOption(fixture.project);
    await page.getByRole("button", { name: "按日期归档", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "按日期归档", exact: true });
    await dialog.getByLabel("完成截止日期（含当天）", { exact: true }).fill("2026-10-15");
    await dialog.getByRole("button", { name: "预览归档", exact: true }).click();
    await dialog.getByRole("button", { name: "归档 1 项", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByLabel("工作项范围", { exact: true }).selectOption("archived");
    await expect(page.getByRole("link", { name: "真实日期归档", exact: true })).toHaveAttribute(
      "href",
      `/test/projects/${fixture.project}/archives/issues/${fixture.issue}`
    );
    await page.getByRole("button", { name: "恢复工作项真实日期归档", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "恢复工作项", exact: true });
    await dialog.getByRole("button", { name: "恢复", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByLabel("工作项范围", { exact: true }).selectOption("current");
    await expect(page.getByRole("link", { name: "真实日期归档", exact: true })).toHaveAttribute(
      "href",
      `/test/projects/${fixture.project}/issues/${fixture.issue}`
    );
  } finally {
    await Promise.all(context.pages().map((page) => page.unrouteAll({ behavior: "ignoreErrors" })));
    await context.close();
  }
});
