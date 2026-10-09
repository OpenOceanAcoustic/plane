/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

let server: ReturnType<typeof createServer>;
let origin = "";
let directory = "";
const viewPath = resolve("apps/web/core/components/issues/peek-overview/view.tsx");
const mainPath = resolve("apps/web/core/components/issues/issue-detail/main-content.tsx");
const nativeStub = `import React from 'react';
const issue = {id:'issue',project_id:'project',name:'共享工作项',description_html:'<p>完整实验说明</p>',sequence_id:1};
export function useIssueDetail(){return {issue:{getIssueById:()=>issue},setPeekIssue:()=>{},isAnyModalOpen:false,peekIssue:null}}
export function useMember(){return {getUserDetails:()=>({display_name:'负责人'})}}
export function useUser(){return {data:null}}
export function useReloadConfirmations(){return {setShowAlert:()=>{}}}
export function WorkItemVersionService(){}
export function IssueActivity(){return <section aria-label="活动">活动记录</section>}
export function PeekOverviewProperties(){return <section aria-label="属性">待做</section>}
export function IssuePeekOverviewHeader({setPeekMode}){return <button onClick={()=>setPeekMode('full-screen')}>展开总览</button>}
export function PeekOverviewIssueDetails(){return <><h1>{issue.name}</h1><div dangerouslySetInnerHTML={{__html:issue.description_html}} /></>}
export function IssueTitleInput({value}){return <h1>{value}</h1>}
export function DescriptionInput({initialValue}){return <div dangerouslySetInnerHTML={{__html:initialValue}} />}
export function IssueDetailWidgets(){return null}
export function IssuePeekOverviewError(){return null}
export function IssuePeekOverviewLoader(){return null}
export function DescriptionVersionsRoot(){return null}
export function IssueTypeSwitcher(){return null}
export function NameDescriptionUpdateStatus(){return null}
export function IssueParentDetail(){return null}
export function IssueReaction(){return null}
export default function noop(){return [600,1000]}
`;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "lab-issue-details-"));
  const require = createRequire(resolve("apps/web/package.json"));
  const { build } = require("esbuild") as typeof import("esbuild");
  await build({
    stdin: {
      contents: `import React, { useState } from 'react'; import { createRoot } from 'react-dom/client'; import { MemoryRouter } from 'react-router'; import { SWRConfig } from 'swr'; import { IssueView } from '${viewPath}'; import { IssueMainContent } from '${mainPath}'; const common={workspaceSlug:'test',projectId:'project',issueId:'issue',issueOperations:{update:async()=>{}}}; function Harness(){const [open,setOpen]=useState(true);return <><button onClick={()=>setOpen(!open)}>{open?'关闭工作项':'打开工作项'}</button>{open&&(location.pathname==='/main'?<IssueMainContent {...common} isEditable={true} isArchived={false}/>:<IssueView {...common} is_archived={false} disabled={location.search.includes('readonly')}/>)}</>}; createRoot(document.getElementById('root')).render(<MemoryRouter><SWRConfig value={{provider:()=>new Map(),dedupingInterval:0}}><Harness/></SWRConfig></MemoryRouter>);`,
      resolveDir: resolve("apps/web"),
      loader: "tsx",
      sourcefile: "lab-issue-details-harness.tsx",
    },
    plugins: [
      {
        name: "native-editor-and-store-seams",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === "next/navigation") return { path: "navigation", namespace: "router-seam" };
            if (![viewPath, mainPath].includes(args.importer)) return;
            if (args.path.startsWith("@/components/lab/"))
              return { path: resolve("apps/web/core", args.path.slice(2)) + ".tsx" };
            if (args.path.startsWith("@/") || args.path.startsWith("."))
              return { path: args.path, namespace: "native-seam" };
          });
          builder.onLoad({ filter: /.*/, namespace: "router-seam" }, () => ({
            contents: "export function useRouter(){return {push:()=>{}}}",
            loader: "js",
          }));
          builder.onLoad({ filter: /.*/, namespace: "native-seam" }, () => ({
            contents: nativeStub,
            loader: "tsx",
            resolveDir: resolve("apps/web"),
          }));
        },
      },
    ],
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
    response.setHeader(
      "Content-Type",
      file === "app.js" ? "text/javascript" : file === "app.css" ? "text/css" : "text/html"
    );
    response.end(
      file
        ? await readFile(join(directory, file))
        : '<!doctype html><html><body><div id="root"></div><div id="full-screen-portal"></div><script src="/app.js"></script></body></html>'
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done) => server.close(() => done()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function setup(page: Page, budget: string | null = "12.50", status = "active") {
  await page.route("**/api/workspaces/test/lab/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown;
    if (path.endsWith("/task-card-metadata/"))
      json = {
        items: [
          {
            issue_id: "issue",
            bounty_id: budget === null ? null : "bounty",
            bounty_budget: budget,
            bounty_status: status,
            color: "#0d9488",
            detail_path: "/test/lab/bounties?bounty_id=bounty",
          },
        ],
      };
    else if (path.endsWith("/field-values/"))
      json = {
        fields: [{ id: "field", name: "实验频率", kind: "number", enabled: true, archived: false, options: [] }],
        values: { field: 48000 },
      };
    else if (path.endsWith("/fields/")) json = { members: [] };
    else if (path.endsWith("/documents/"))
      json = { can_edit: false, documents: [{ id: "document", name: "同一份实验记录", access: 0, archived_at: null }] };
    else throw new Error(`Unexpected lab read: ${path}`);
    await route.fulfill({ json });
  });
}

async function assertQuota(page: Page) {
  const bounty = page.getByRole("region", { name: "悬赏", exact: true });
  await expect(bounty).toContainText("VC配额", { timeout: 3000 });
  await expect(bounty).toContainText("12.50 VC");
  await expect(bounty.getByRole("link", { name: "打开悬赏大厅", exact: true })).toHaveAttribute(
    "href",
    "/test/lab/bounties?bounty_id=bounty"
  );
}

async function assertExtension(page: Page) {
  await expect(page.getByText("完整实验说明", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "活动", exact: true })).toContainText("活动记录");
  await expect(page.getByLabel("实验频率", { exact: true })).toHaveValue("48000", { timeout: 3000 });
  await expect(page.getByRole("region", { name: "关联文档", exact: true })).toContainText("同一份实验记录");
}

test("project details and personal planning side/full native peek share fields, documents and VC quota", async ({
  page,
}) => {
  await setup(page);
  await page.goto(`${origin}/main`);
  await assertExtension(page);
  await assertQuota(page);
  await page.goto(`${origin}/peek`);
  await assertExtension(page);
  await assertQuota(page);
  await page.getByRole("button", { name: "展开总览", exact: true }).click();
  await assertExtension(page);
  await assertQuota(page);
});

test("ordinary issues have the same extensions without a VC quota", async ({ page }) => {
  await setup(page, null);
  await page.goto(`${origin}/main`);
  await assertExtension(page);
  await expect(page.getByText(/VC\s*配额/)).toHaveCount(0);
  await page.goto(`${origin}/peek`);
  await assertExtension(page);
  await expect(page.getByText(/VC\s*配额/)).toHaveCount(0);
});

for (const status of ["deleted"]) {
  test(`an ${status} bounty does not show a stale VC quota`, async ({ page }) => {
    await setup(page, "12.50", status);
    await page.goto(`${origin}/peek`);
    await assertExtension(page);
    await expect(page.getByRole("region", { name: "悬赏", exact: true })).toHaveCount(0);
  });
}

test("read-only native overview preserves the same field values without write controls", async ({ page }) => {
  await setup(page);
  await page.goto(`${origin}/peek?readonly`);
  await assertExtension(page);
  await assertQuota(page);
  await expect(page.getByLabel("实验频率", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "关联已有文档", exact: true })).toHaveCount(0);
});

test("reopening a revoked issue does not expose cached VC quota", async ({ page }) => {
  await setup(page);
  await page.goto(`${origin}/peek`);
  await assertQuota(page);
  await page.getByRole("button", { name: "关闭工作项", exact: true }).click();
  let release!: () => void;
  let capture!: () => void;
  const blocked = new Promise<void>((done) => {
    release = done;
  });
  const requested = new Promise<void>((done) => {
    capture = done;
  });
  await page.route("**/task-card-metadata/**", async (route) => {
    capture();
    await blocked;
    await route.fulfill({ status: 403, json: { detail: "项目访问已撤回" } });
  });
  const denied = page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith("/task-card-metadata/") && response.status() === 403
  );
  await page.getByRole("button", { name: "打开工作项", exact: true }).click();
  await requested;
  try {
    await expect(page.getByRole("region", { name: "悬赏", exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  await denied;
  await expect(page.getByRole("region", { name: "悬赏", exact: true })).toHaveCount(0);
  await expect(page.getByText("12.50 VC", { exact: true })).toHaveCount(0);
});

for (const status of ["rejected", "cancelled"]) {
  test(`a ${status} historical bounty keeps its original VC quota visible`, async ({ page }) => {
    await setup(page, "12.50", status);
    await page.goto(`${origin}/peek`);
    await assertExtension(page);
    await assertQuota(page);
  });
}
