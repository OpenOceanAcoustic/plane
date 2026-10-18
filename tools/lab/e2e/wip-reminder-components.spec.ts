/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";

let server: ReturnType<typeof createServer>;
let directory = "";
let origin = "";
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "lab-wip-reminder-"));
  const require = createRequire(resolve("apps/web/package.json"));
  const { build } = require("esbuild") as typeof import("esbuild");
  await build({
    stdin: {
      contents: `import React,{useEffect,useState} from 'react';import {createRoot} from 'react-dom/client';import {MemoryRouter} from 'react-router';import {LabStore} from '${resolve("packages/shared-state/src/lab.store.ts")}';import {LabPlannerBoard} from '${resolve("apps/web/core/components/lab/planner.tsx")}';import {LabWorkloadNotice} from '${resolve("apps/web/core/components/lab/workload-notice.tsx")}';const store=new LabStore('','test');function App(){const [revision,setRevision]=useState(0);useEffect(()=>{if(window.realPlanner)void store.loadPlanner();},[]);return <><LabWorkloadNotice workspaceSlug="test" refreshKey={String(revision)}/><button onClick={()=>setRevision(v=>v+1)}>继续开工</button>{window.realPlanner&&<LabPlannerBoard store={store} schedule={()=>{}}/>}</>;}createRoot(document.getElementById('root')).render(<MemoryRouter><App/></MemoryRouter>);`,
      resolveDir: resolve("apps/web"),
      loader: "tsx",
      sourcefile: "wip-harness.tsx",
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

function advice(active: number, major = 0) {
  return {
    active,
    major,
    active_limit: 2,
    major_limit: 1,
    overloaded: active > 2 || major > 1,
    blocking: false,
    message: `并行提醒：当前进行中 ${active} 项（建议 2 项），其中重大 ${major} 项（建议 1 项）。`,
  };
}
async function mockAdvice(page: Page, initial: number, major = 0) {
  let active = initial;
  await page.route("**/me/workload/", (route) => route.fulfill({ json: advice(active, major) }));
  return (value: number) => {
    active = value;
  };
}

test("work within the recommendation shows no reminder and remains actionable", async ({ page }) => {
  await mockAdvice(page, 2);
  await page.goto(origin);
  await expect(page.getByRole("status", { name: "并行任务提醒" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "继续开工" })).toBeEnabled();
});

test("dismissal never disables work and a changed workload gets a new reminder", async ({ page }) => {
  const update = await mockAdvice(page, 3, 2);
  await page.goto(origin);
  const notice = page.getByRole("status", { name: "并行任务提醒" });
  await expect(notice).toContainText("进行中 3 项");
  await expect(notice).toContainText("重大 2 项");
  await page.getByRole("button", { name: "关闭并行任务提醒" }).click();
  await expect(notice).toHaveCount(0);
  update(4);
  await page.getByRole("button", { name: "继续开工" }).click();
  await expect(notice).toContainText("进行中 4 项");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("returning below the recommendation resets dismissal for later work", async ({ page }) => {
  const update = await mockAdvice(page, 3);
  await page.goto(origin);
  await page.getByRole("button", { name: "关闭并行任务提醒" }).click();
  update(2);
  const refreshed = page.waitForResponse((response) => response.url().endsWith("/me/workload/") && response.ok());
  await page.getByRole("button", { name: "继续开工" }).click();
  await refreshed;
  update(3);
  await page.getByRole("button", { name: "继续开工" }).click();
  await expect(page.getByRole("status", { name: "并行任务提醒" })).toContainText("进行中 3 项");
});

test("unavailable advice cannot block the work controls", async ({ page }) => {
  await page.route("**/me/workload/", (route) => route.fulfill({ status: 503, json: {} }));
  await page.goto(origin);
  await page.getByRole("button", { name: "继续开工" }).click();
  await expect(page.getByRole("status", { name: "并行任务提醒" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "继续开工" })).toBeEnabled();
});

test("third and fourth tasks start through planner controls and the real Django API", async ({ browser }) => {
  test.skip(!process.env.LAB_WIP_LIVE_FIXTURE, "Run through the isolated Django browser contract");
  const fixture = JSON.parse(await readFile(process.env.LAB_WIP_LIVE_FIXTURE!, "utf8")) as {
    server: string;
    base: string;
    cookie: { name: string; value: string };
  };
  const context = await browser.newContext();
  try {
    await context.addCookies([
      { ...fixture.cookie, url: fixture.server },
      { ...fixture.cookie, url: origin },
    ]);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => Object.assign(window, { realPlanner: true }));
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
    const notice = page.getByRole("status", { name: "并行任务提醒" });
    await page.getByLabel("第三项状态", { exact: true }).selectOption("active");
    await expect(notice).toContainText("进行中 3 项", { timeout: 15000 });
    await page.getByRole("button", { name: "关闭并行任务提醒" }).click();
    await expect(notice).toHaveCount(0);
    await page.getByLabel("第四项状态", { exact: true }).selectOption("active");
    await expect(notice).toContainText("进行中 4 项", { timeout: 15000 });
    await expect(page.getByLabel("第三项状态", { exact: true })).toHaveValue("active");
    await expect(page.getByLabel("第四项状态", { exact: true })).toHaveValue("active");
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(context.pages().map((page) => page.unrouteAll({ behavior: "ignoreErrors" })));
    await context.close();
  }
});
