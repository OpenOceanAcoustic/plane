/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { LabDocument } from "../../../apps/web/core/components/lab/document-types";

let server: ReturnType<typeof createServer>;
let origin = "";
let directory = "";
const viewPath = resolve("apps/web/core/components/issues/peek-overview/view.tsx");
const mainPath = resolve("apps/web/core/components/issues/issue-detail/main-content.tsx");
const pagesViewPath = resolve("apps/web/core/components/pages/pages-list-view.tsx");
const pagesContentPath = resolve("apps/web/core/components/pages/pages-list-main-content.tsx");
const pageRootPath = resolve("apps/web/core/components/pages/editor/page-root.tsx");
const nativeStub = `import React from 'react';
const issue = {id:'issue',project_id:'project',name:'共享工作项',description_html:'<p>完整实验说明</p>',sequence_id:1};
const nativeIssues={removeIssueFromList:(id)=>window.dispatchEvent(new CustomEvent('native-issue-cache-removed',{detail:{kind:'index',id}}))};
const rootIssueStore={projectIssues:nativeIssues,archivedIssues:nativeIssues,issues:{removeIssue:(id)=>window.dispatchEvent(new CustomEvent('native-issue-cache-removed',{detail:{kind:'map',id}}))}};
export function useIssueDetail(){return {issue:{getIssueById:()=>issue},rootIssueStore,setPeekIssue:()=>window.dispatchEvent(new Event('native-issue-closed')),isAnyModalOpen:false,peekIssue:null}}
export function useAppRouter(){return {push:()=>window.dispatchEvent(new Event('native-issue-closed'))}}
export function useMember(){return {getUserDetails:()=>({display_name:'负责人'})}}
export function useUser(){return {data:null}}
export function useReloadConfirmations(){return {setShowAlert:()=>{}}}
export function WorkItemVersionService(){}
export function IssueActivity(){return <section aria-label="活动">活动记录</section>}
export function PeekOverviewProperties(){return <section aria-label="属性">{location.search.includes('started')?'进行中':'待做'}</section>}
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
const nativePageStub = `import React from 'react';
const pages={isAnyPageAvailable:false,loader:false,getCurrentProjectPageIdsByTab:()=>[],getCurrentProjectFilteredPageIdsByTab:()=>[],fetchPagesList:(slug,project,tab)=>fetch('/api/workspaces/'+slug+'/projects/'+project+'/pages/?tab='+tab).then(response=>response.json()),createPage:()=>{throw new Error('Native page writes are forbidden')}};
export const EPageStoreType={PROJECT:'PROJECT_PAGE'};
export function usePageStore(){return pages}
export function useUserPermissions(){return {allowPermissions:()=>!location.search.includes('readonly')}}
export function useProject(){return {currentProjectDetails:{id:'project'}}}
export function usePageFallback(){return {isFetchingFallbackBinary:false}}
export function usePagesPaneExtensions(){return {editorExtensionHandlers:{},navigationPaneExtensions:[],handleOpenNavigationPane:()=>{},handleCloseNavigationPane:()=>{},isNavigationPaneOpen:false}}
export function useExtendedEditorProps(){return {}}
export function PageEditorBody(){return <p>原生Page编辑器</p>}
export function PageEditorToolbarRoot(){return null}
export function PageNavigationPaneRoot(){return null}
export function PageVersionsOverlay(){return null}
export function PagesVersionEditor(){return null}
export function ContentLimitBanner(){return null}
`;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "lab-issue-details-"));
  const require = createRequire(resolve("apps/web/package.json"));
  const { build } = require("esbuild") as typeof import("esbuild");
  await build({
    stdin: {
      contents: `import React, { useEffect, useState } from 'react'; import { createRoot } from 'react-dom/client'; import { MemoryRouter } from 'react-router'; import { SWRConfig } from 'swr'; import { IssueView } from '${viewPath}'; import { IssueMainContent } from '${mainPath}'; import { LabStore } from '${resolve("packages/shared-state/src/lab.store.ts")}'; import { LabPlannerBoard } from '${resolve("apps/web/core/components/lab/planner.tsx")}'; import { LabTaskTable } from '${resolve("apps/web/core/components/lab/task-table.tsx")}'; import { LabTaskOverview } from '${resolve("apps/web/core/components/lab/task-overview.tsx")}'; import { PagesListView } from '${pagesViewPath}'; import { PageRoot } from '${pageRootPath}'; const store=new LabStore('', 'test'); const common={workspaceSlug:'test',projectId:'project',issueId:'issue',issueOperations:{update:async()=>{}}}; function Harness(){const [open,setOpen]=useState(true);useEffect(()=>{const close=()=>setOpen(false);window.addEventListener('native-issue-closed',close);if(['/planner','/tasks'].includes(location.pathname))void store.loadPlanner();return()=>window.removeEventListener('native-issue-closed',close)},[]);if(location.pathname==='/planner')return <LabPlannerBoard store={store} schedule={()=>{}}/>;if(location.pathname==='/tasks')return <LabTaskTable store={store}/>;if(location.pathname==='/native-project-documents')return <PagesListView workspaceSlug='test' projectId='project' pageType={location.search.includes('private')?'private':'public'} storeType='PROJECT_PAGE'><p>原生项目文档列表</p></PagesListView>;if(location.pathname==='/native-page')return <PageRoot workspaceSlug='test' projectId='project' storeType='PROJECT_PAGE' page={{id:'page',isContentEditable:false,editor:{setEditorRef:()=>{},editorRef:null}}} config={{fileHandler:{}}} handlers={{}} webhookConnectionParams={{}}/>;if(location.pathname==='/controlled-materials')return open?<LabTaskOverview store={store} item={{id:'controlled-item',title:'共享执行任务',kind:'task',status:'active',bounty_id:'bounty',issue_key:'LAB-1'}} onClose={()=>setOpen(false)} onSchedule={()=>{}}/>:<p>受控任务已关闭</p>;return <><button onClick={()=>setOpen(!open)}>{open?'关闭工作项':'打开工作项'}</button>{open&&(location.pathname==='/main'?<IssueMainContent {...common} isEditable={!location.search.includes('readonly')} isArchived={false}/>:<IssueView {...common} is_archived={false} disabled={location.search.includes('readonly')}/>)}</>}; createRoot(document.getElementById('root')).render(<MemoryRouter><SWRConfig value={{provider:()=>new Map(),dedupingInterval:0}}><Harness/></SWRConfig></MemoryRouter>);`,
      resolveDir: resolve("apps/web"),
      loader: "tsx",
      sourcefile: "lab-issue-details-harness.tsx",
    },
    plugins: [
      {
        name: "native-editor-and-store-seams",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (args.path === "@plane/ui") return { path: resolve("packages/ui/src/index.ts") };
            if (args.path === "@plane/shared-state") return { path: resolve("packages/shared-state/src/index.ts") };
            if (args.path === "@plane/types") return { path: resolve("packages/types/src/index.ts") };
            if (args.path === "next/link") return { path: resolve("apps/web/app/compat/next/link.tsx") };
            if (args.path === "next/navigation") return { path: "navigation", namespace: "router-seam" };
            if (
              [pagesViewPath, pagesContentPath].includes(args.importer) &&
              ["@/hooks/store", "@/hooks/store/user", "@/hooks/store/use-project"].includes(args.path)
            )
              return { path: args.path, namespace: "native-page-seam" };
            if (
              args.importer === pageRootPath &&
              [
                "@/hooks/use-page-fallback",
                "@/hooks/pages",
                "../navigation-pane",
                "../version",
                "../version/editor",
                "./content-limit-banner",
                "./editor-body",
                "./toolbar",
              ].includes(args.path)
            )
              return { path: args.path, namespace: "native-page-seam" };
            if (![viewPath, mainPath].includes(args.importer)) return;
            if (args.path === "@/hooks/use-peek-overview-outside-click")
              return { path: resolve("apps/web/core/hooks/use-peek-overview-outside-click.tsx") };
            if (args.path.startsWith("@/components/lab/"))
              return { path: resolve("apps/web/core", args.path.slice(2)) + ".tsx" };
            if (args.path.startsWith("@/") || args.path.startsWith("."))
              return { path: args.path, namespace: "native-seam" };
          });
          builder.onLoad({ filter: /.*/, namespace: "router-seam" }, () => ({
            contents:
              "export function useRouter(){return {push:()=>{}}} export function useParams(){return {workspaceSlug:'test',projectId:'project'}}",
            loader: "js",
          }));
          builder.onLoad({ filter: /.*/, namespace: "native-page-seam" }, () => ({
            contents: nativePageStub,
            loader: "tsx",
            resolveDir: resolve("apps/web"),
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

function fileDocument(name: string, extension: string, contentType: string, bytes: Buffer, id: string): LabDocument {
  const previewable = ["txt", "md"].includes(extension);
  return {
    id,
    name,
    project_id: "project",
    access: 0,
    owned_by: "lead",
    is_locked: false,
    archived_at: null,
    updated_at: "2026-10-10T00:00:00Z",
    file: {
      name,
      extension,
      content_type: contentType,
      size: bytes.length,
      version_id: "file-version",
      previewable,
      download_path: `documents/${id}/files/file-version/download/`,
      preview_path: previewable ? `documents/${id}/files/file-version/preview/` : null,
    },
  };
}

async function setupDocuments(page: Page, documents: LabDocument[], canEdit = true) {
  await setup(page, null);
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/api/instances/", (route) =>
    route.fulfill({ json: { config: { file_size_limit: 5 * 1024 * 1024 } } })
  );
  await page.route("**/lab/tasks/issue/documents/", (route) =>
    route.fulfill({ json: { can_edit: canEdit, documents } })
  );
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

async function setupPublication(page: Page, options: { allowed?: boolean; existing?: boolean } = {}) {
  const state = {
    allowed: options.allowed ?? true,
    canDelete: true,
    existing: options.existing ?? false,
    publishedBudget: "12.50",
    available: "80.00",
    reserved: "20.00",
    rejectPublication: false,
    metadataReads: 0,
    budgetReads: 0,
    taskRequests: [] as string[],
    publications: [] as Record<string, unknown>[],
    nativeWrites: [] as string[],
  };
  await page.route("**/api/**", (route) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) state.nativeWrites.push(route.request().url());
    return route.fulfill({ status: 404, json: { error: "测试不允许原生工作项写入" } });
  });
  await setup(page, null);
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/task-card-metadata/**", (route) => {
    state.metadataReads += 1;
    return route.fulfill({
      json: {
        items: [
          {
            issue_id: "issue",
            bounty_id: state.existing ? "bounty" : null,
            bounty_status: state.existing ? "open" : null,
            bounty_budget: state.existing ? state.publishedBudget : null,
            can_publish_bounty: state.allowed,
            can_delete_issue: state.canDelete,
            title: "共享工作项",
            color: "#0d9488",
            detail_path: state.existing ? "/test/lab/bounties?bounty_id=bounty" : null,
          },
        ],
      },
    });
  });
  await page.route("**/lab/planner/", (route) =>
    route.fulfill({
      json: {
        user_id: "lead",
        team_access: true,
        timezone: "Asia/Shanghai",
        week_start: 1,
        step_minutes: 15,
        items: [],
        folders: [],
        categories: [],
        projects: ["project", "other-project"].map((id) => ({
          id,
          name: id === "project" ? "海声实验" : "其他项目",
          lead: state.allowed,
          members: [
            { id: "lead", name: "负责人" },
            { id: "reviewer", name: "验收人" },
          ],
          states: [],
          mapping: { todo: null, active: null, review: null, done: null },
        })),
      },
    })
  );
  await page.route("**/lab/bounties/budgets/", (route) => {
    state.budgetReads += 1;
    return route.fulfill({
      json: [
        {
          project_id: "project",
          project: "海声实验",
          stage_id: "stage",
          stage_name: "第一阶段",
          budget: "100.00",
          reserved: state.reserved,
          available: state.available,
          configured: true,
        },
        {
          project_id: "other-project",
          project: "其他项目",
          stage_id: "other-stage",
          stage_name: "其他阶段",
          budget: "200.00",
          reserved: "0.00",
          available: "200.00",
          configured: true,
        },
      ],
    });
  });
  await page.route(
    (url) => url.pathname.endsWith("/lab/tasks/"),
    (route) => {
      state.taskRequests.push(route.request().url());
      return route.fulfill({
        json: [{ id: "issue", title: "共享工作项", project_id: "project", project: "海声实验", key: "LAB-1" }],
      });
    }
  );
  await page.route("**/lab/bounties/", (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: [] });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    state.publications.push(body);
    if (state.rejectPublication) {
      state.rejectPublication = false;
      state.available = "5.00";
      state.reserved = "95.00";
      return route.fulfill({ status: 400, json: { error: "项目剩余 VC 已变化，请调整配额后重试" } });
    }
    state.existing = true;
    state.allowed = false;
    state.publishedBudget = String(body.budget);
    return route.fulfill({ status: 201, json: { id: "bounty" } });
  });
  return state;
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

/* oxlint-disable no-await-in-loop -- These checks navigate and update permissions in one real browser page. */
test("native publication is available in full and side details for an eligible project lead", async ({ page }) => {
  await setupPublication(page);
  for (const path of ["/main", "/peek"]) {
    await page.goto(`${origin}${path}`);
    await assertExtension(page);
    await expect(page.getByRole("button", { name: "发布悬赏", exact: true })).toBeVisible();
  }
});

test("native publication remains hidden for read-only views, ordinary members and existing bounties", async ({
  page,
}) => {
  const state = await setupPublication(page);
  for (const mode of ["readonly", "member", "existing"]) {
    state.allowed = mode !== "member";
    state.existing = mode === "existing";
    for (const surface of ["/main", "/peek"]) {
      await page.goto(`${origin}${surface}${mode === "readonly" ? "?readonly" : ""}`);
      await expect(page.getByText("完整实验说明", { exact: true })).toBeVisible();
      await expect(page.getByLabel("实验频率", { exact: true })).toHaveValue("48000");
      await expect(page.getByRole("button", { name: "发布悬赏", exact: true })).toHaveCount(0);
    }
  }
  expect(state.publications).toEqual([]);
  expect(state.nativeWrites).toEqual([]);
});
/* oxlint-enable no-await-in-loop */

test("native publication keeps the original work item through quota warnings, failure and successful upgrade", async ({
  page,
}) => {
  const state = await setupPublication(page);
  await page.goto(`${origin}/peek`);
  await page.getByRole("button", { name: "发布悬赏", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "发布悬赏", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("项目", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("项目", { exact: true })).toHaveValue("project");
  await expect(dialog.getByLabel("工作项", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("工作项", { exact: true })).toHaveValue("issue");
  await expect(dialog.getByLabel("工作项", { exact: true })).toContainText("LAB-1 · 共享工作项");
  await expect(dialog.getByLabel("搜索工作项", { exact: true })).toHaveCount(0);
  const quota = dialog.getByLabel("VC配额", { exact: true });
  await quota.fill("80.01");
  await expect(quota).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
  expect(state.publications).toEqual([]);
  await quota.fill("10.00");
  await dialog.getByLabel("任务资料", { exact: true }).fill("保留原实验资料");
  await dialog.getByLabel("交付要求", { exact: true }).fill("完成原工作项的实验报告");
  await dialog.getByLabel("验收标准", { exact: true }).fill("复现实验参数与结论");
  await dialog.getByLabel("验收人", { exact: true }).selectOption("reviewer");
  state.rejectPublication = true;
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  await expect(dialog.getByRole("alert").filter({ hasText: "项目剩余 VC 已变化，请调整配额后重试" })).toBeVisible();
  await expect(dialog.getByLabel("项目 VC 预算", { exact: true })).toContainText("剩余 5.00");
  await expect(quota).toHaveValue("10.00");
  await expect(dialog.getByLabel("任务资料", { exact: true })).toHaveValue("保留原实验资料");
  await expect(dialog.getByLabel("交付要求", { exact: true })).toHaveValue("完成原工作项的实验报告");
  await expect(dialog.getByLabel("验收标准", { exact: true })).toHaveValue("复现实验参数与结论");
  await expect(dialog.getByLabel("项目", { exact: true })).toHaveValue("project");
  await expect(dialog.getByLabel("工作项", { exact: true })).toHaveValue("issue");
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
  expect(state.publications).toHaveLength(1);
  const previousMetadataReads = state.metadataReads;
  await quota.fill("5.00");
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => state.metadataReads).toBeGreaterThan(previousMetadataReads);
  const badge = page.getByRole("region", { name: "悬赏", exact: true });
  await expect(badge).toContainText("5.00 VC");
  await expect(badge.getByRole("link", { name: "打开悬赏大厅", exact: true })).toHaveAttribute(
    "href",
    "/test/lab/bounties?bounty_id=bounty"
  );
  await expect(page.getByRole("button", { name: "发布悬赏", exact: true })).toHaveCount(0);
  expect(state.publications).toHaveLength(2);
  expect(state.publications.map(({ project_id, issue_id }) => ({ project_id, issue_id }))).toEqual([
    { project_id: "project", issue_id: "issue" },
    { project_id: "project", issue_id: "issue" },
  ]);
  expect(state.taskRequests.length).toBeGreaterThan(0);
  for (const request of state.taskRequests) {
    const query = new URL(request).searchParams;
    expect(query.get("project_id")).toBe("project");
    expect(query.get("issue_id")).toBe("issue");
    expect(query.get("publishable")).toBe("1");
  }
  expect(state.budgetReads).toBeGreaterThan(1);
  expect(state.nativeWrites).toEqual([]);
});

for (const mode of ["side-peek", "full-screen"]) {
  test(`clicking bounty form fields keeps the native work item overview and draft open in ${mode}`, async ({
    page,
  }) => {
    const state = await setupPublication(page);
    await page.goto(`${origin}/peek`);
    if (mode === "full-screen") await page.getByRole("button", { name: "展开总览", exact: true }).click();
    const overview = page.locator('[data-issue-peek-overview="issue"]');
    await expect(overview).toBeVisible();
    await page.getByRole("button", { name: "发布悬赏", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "发布悬赏", exact: true });
    await expect(dialog).toBeVisible();
    await expect(overview).toBeAttached();
    await page.evaluate(() => {
      document.documentElement.dataset.nativeCloseCount = "0";
      window.addEventListener("native-issue-closed", () => {
        document.documentElement.dataset.nativeCloseCount = String(
          Number(document.documentElement.dataset.nativeCloseCount) + 1
        );
      });
    });
    await dialog.getByLabel("VC配额", { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.dataset.nativeCloseCount)).toBe("0");
    await expect(overview).toBeAttached({ timeout: 3000 });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("VC配额", { exact: true }).fill("8.50");
    await dialog.getByLabel("任务资料", { exact: true }).click();
    await dialog.getByLabel("任务资料", { exact: true }).fill("未发布的实验资料");
    await dialog.getByLabel("交付要求", { exact: true }).click();
    await dialog.getByLabel("交付要求", { exact: true }).fill("实验结果");
    await dialog.getByLabel("验收标准", { exact: true }).click();
    await dialog.getByLabel("验收标准", { exact: true }).fill("复现实验");
    await dialog.getByLabel("验收人", { exact: true }).click();
    await dialog.getByLabel("验收人", { exact: true }).selectOption("reviewer");
    await expect(dialog.getByLabel("VC配额", { exact: true })).toHaveValue("8.50");
    await expect(dialog.getByLabel("任务资料", { exact: true })).toHaveValue("未发布的实验资料");
    await expect(page.locator('[data-issue-peek-overview="issue"]')).toBeVisible();
    await expect(page).toHaveURL(`${origin}/peek`);
    expect(state.publications).toEqual([]);
    expect(state.nativeWrites).toEqual([]);
  });
}

test("cancelling bounty publication keeps the overview while a later outside click still closes it", async ({
  page,
}) => {
  const state = await setupPublication(page);
  await page.goto(`${origin}/peek`);
  await page.getByRole("button", { name: "发布悬赏", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "发布悬赏", exact: true });
  await dialog.getByLabel("VC配额", { exact: true }).click();
  await dialog.getByLabel("VC配额", { exact: true }).fill("8.50");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const overview = page.locator('[data-issue-peek-overview="issue"]');
  await expect(overview).toBeVisible();
  await page.evaluate(() => {
    const background = document.createElement("button");
    background.textContent = "项目列表";
    document.body.append(background);
  });
  await page.getByRole("button", { name: "项目列表", exact: true }).click();
  await expect(overview).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开工作项", exact: true })).toBeVisible();
  expect(state.publications).toEqual([]);
  expect(state.nativeWrites).toEqual([]);
});

test("native publication cannot open from an old task response after its capability is revoked", async ({ page }) => {
  const state = await setupPublication(page);
  let release!: () => void;
  let capture!: () => void;
  const blocked = new Promise<void>((done) => {
    release = done;
  });
  const requested = new Promise<void>((done) => {
    capture = done;
  });
  await page.route(
    (url) => url.pathname.endsWith("/lab/tasks/"),
    async (route) => {
      capture();
      await blocked;
      await route.fulfill({
        json: [{ id: "issue", title: "共享工作项", project_id: "project", project: "海声实验", key: "LAB-1" }],
      });
    }
  );
  await page.goto(`${origin}/peek`);
  await page.getByRole("button", { name: "发布悬赏", exact: true }).click();
  await requested;
  try {
    state.allowed = false;
    const denied = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/task-card-metadata/")
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await denied;
    await page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
    );
    const task = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith("/tasks/"));
    release();
    await task;
    await page.evaluate(
      () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())))
    );
    await expect(page.getByRole("dialog", { name: "发布悬赏", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "发布悬赏", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("实验频率", { exact: true })).toHaveValue("48000");
    expect(state.budgetReads).toBe(0);
    expect(state.publications).toEqual([]);
    expect(state.nativeWrites).toEqual([]);
  } finally {
    release();
  }
});

test("native issue deletion deletes the real work item, keeps rejected context and closes the native peek on success", async ({
  page,
}) => {
  const state = await setupPublication(page, { existing: true });
  const deletions: { path: string; body: unknown }[] = [];
  await page.route("**/lab/tasks/issue/", (route) => {
    deletions.push({ path: new URL(route.request().url()).pathname, body: route.request().postDataJSON() });
    if (deletions.length === 1) return route.fulfill({ status: 403, json: { detail: "仅项目负责人可删除关联悬赏" } });
    state.canDelete = false;
    return route.fulfill({ status: 204 });
  });
  await page.goto(`${origin}/peek`);
  await page.evaluate(() => {
    const cacheRemovals: unknown[] = [];
    window.addEventListener("native-issue-cache-removed", (event) => cacheRemovals.push((event as CustomEvent).detail));
    (window as unknown as { cacheRemovals: unknown[] }).cacheRemovals = cacheRemovals;
  });
  await page.getByRole("button", { name: "删除工作项", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "删除工作项", exact: true });
  await expect(dialog).toContainText("共享工作项");
  expect(deletions).toEqual([]);
  const reason = dialog.getByLabel("删除原因", { exact: true });
  await reason.fill("删除原工作项");
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("仅项目负责人可删除关联悬赏");
  await expect(reason).toHaveValue("删除原工作项");
  await expect(page.getByText("完整实验说明", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "删除", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "打开工作项", exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { cacheRemovals: unknown[] }).cacheRemovals)).toEqual([
    { kind: "index", id: "issue" },
    { kind: "map", id: "issue" },
  ]);
  expect(deletions).toEqual([
    { path: "/api/workspaces/test/lab/tasks/issue/", body: { reason: "删除原工作项" } },
    { path: "/api/workspaces/test/lab/tasks/issue/", body: { reason: "删除原工作项" } },
  ]);
  expect(state.nativeWrites).toEqual([]);
});

test("native issue deletion is hidden for read-only views and tasks without delete capability", async ({ page }) => {
  const state = await setupPublication(page);
  await page.goto(`${origin}/peek?readonly`);
  await assertExtension(page);
  await expect(page.getByRole("button", { name: "删除工作项", exact: true })).toHaveCount(0);
  state.canDelete = false;
  await page.goto(`${origin}/main`);
  await assertExtension(page);
  await expect(page.getByRole("button", { name: "删除工作项", exact: true })).toHaveCount(0);
  expect(state.nativeWrites).toEqual([]);
});

for (const surface of ["planner", "tasks"]) {
  test(`${surface} issue deletion removes the real work item while preserving the distinct remove-planning action`, async ({
    page,
  }) => {
    const state = await setupPublication(page);
    let deleted = false;
    let allowed = false;
    const writes: { method: string; path: string }[] = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
        writes.push({ method: request.method(), path: new URL(request.url()).pathname });
    });
    const task = {
      id: "issue",
      title: "共享工作项",
      key: "LAB-1",
      project_id: "project",
      project: "海声实验",
      state: "进行中",
      priority: "medium",
      start_date: null,
      target_date: null,
      editable: true,
      values: {},
    };
    await page.route("**/lab/planner/", (route) =>
      route.fulfill({
        json: {
          user_id: "lead",
          team_access: true,
          timezone: "Asia/Shanghai",
          week_start: 1,
          step_minutes: 15,
          items: deleted
            ? []
            : [
                {
                  id: "personal-reference",
                  title: task.title,
                  kind: "project",
                  status: "active",
                  folder_id: null,
                  public: false,
                  issue_id: "issue",
                  issue_key: task.key,
                  project_id: "project",
                  project_name: task.project,
                  priority: "medium",
                  target_date: null,
                  can_edit_issue: true,
                  can_delete_issue: allowed,
                  schedule: { future_count: 0, next_start: null, next_end: null, week_minutes: 0, total_count: 0 },
                },
              ],
          folders: [],
          categories: [],
          projects: [{ id: "project", name: task.project, lead: true, members: [], states: [] }],
        },
      })
    );
    await page.route("**/lab/task-table/**", (route) =>
      route.fulfill({ json: { tasks: deleted ? [] : [{ ...task, can_delete_issue: allowed }], fields: [] } })
    );
    await page.route("**/lab/projects/project/fields/", (route) =>
      route.fulfill({ json: { fields: [], members: [] } })
    );
    await page.route("**/lab/tasks/issue/", (route) => {
      deleted = true;
      return route.fulfill({ status: 204 });
    });
    await page.goto(`${origin}/${surface}`);
    const deletion = page.getByRole("button", { name: "删除工作项共享工作项", exact: true });
    await expect(page.getByText(task.title, { exact: true })).toBeVisible();
    await expect(deletion).toHaveCount(0);
    allowed = true;
    await page.reload();
    await expect(deletion).toBeVisible();
    if (surface === "planner")
      await expect(page.getByRole("button", { name: "移除共享工作项", exact: true })).toBeVisible();
    await deletion.click();
    const dialog = page.getByRole("dialog", { name: "删除工作项", exact: true });
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    expect(writes).toEqual([]);
    await expect(page.getByText(task.title, { exact: true })).toBeVisible();
    await deletion.click();
    await dialog.getByRole("button", { name: "删除", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText(task.title, { exact: true })).toHaveCount(0);
    expect(writes).toEqual([{ method: "DELETE", path: "/api/workspaces/test/lab/tasks/issue/" }]);
    expect(state.nativeWrites).toEqual([]);
  });
}

test("native publication upgrades a started work item without changing its native status", async ({ page }) => {
  const state = await setupPublication(page);
  const writes: { method: string; path: string }[] = [];
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method()))
      writes.push({ method: request.method(), path: new URL(request.url()).pathname });
  });
  await page.goto(`${origin}/peek?started`);
  const properties = page.getByRole("region", { name: "属性", exact: true });
  await expect(properties).toHaveText("进行中");
  await page.getByRole("button", { name: "发布悬赏", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "发布悬赏", exact: true });
  await expect(dialog.getByLabel("项目", { exact: true })).toHaveValue("project");
  await expect(dialog.getByLabel("项目", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("工作项", { exact: true })).toHaveValue("issue");
  await expect(dialog.getByLabel("工作项", { exact: true })).toBeDisabled();
  await dialog.getByLabel("VC配额", { exact: true }).fill("12.50");
  await dialog.getByLabel("任务资料", { exact: true }).fill("正在执行的原工作项实验资料");
  await dialog.getByLabel("交付要求", { exact: true }).fill("继续完成原工作项的实验报告");
  await dialog.getByLabel("验收标准", { exact: true }).fill("复现实验参数与结论");
  await dialog.getByLabel("验收人", { exact: true }).selectOption("reviewer");
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await assertQuota(page);
  await expect(properties).toHaveText("进行中");
  await expect(page.getByRole("button", { name: "发布悬赏", exact: true })).toHaveCount(0);
  expect(state.publications).toHaveLength(1);
  expect(state.publications[0]).toMatchObject({ project_id: "project", issue_id: "issue" });
  expect(writes).toEqual([{ method: "POST", path: "/api/workspaces/test/lab/bounties/" }]);
  expect(state.nativeWrites).toEqual([]);
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

test("uploading a TXT document links it to the native work item without closing the peek", async ({ page }) => {
  await setup(page, null);
  const uploads: { path: string; contentType: string; body: string }[] = [];
  const existing = {
    id: "document",
    name: "同一份实验记录",
    project_id: "project",
    access: 0,
    owned_by: "lead",
    is_locked: false,
    archived_at: null,
    updated_at: "2026-10-10T00:00:00Z",
    file: null,
  };
  const uploaded = {
    ...existing,
    id: "uploaded-document",
    name: "实验记录.txt",
    file: {
      name: "实验记录.txt",
      extension: "txt",
      content_type: "text/plain",
      size: Buffer.byteLength("实验目标：记录声学数据\n频率：48000 Hz\n"),
      version_id: "file-version",
      previewable: true,
      download_path: "documents/uploaded-document/files/file-version/download/",
      preview_path: "documents/uploaded-document/files/file-version/preview/",
    },
  };
  const documents = [existing] as (typeof existing | typeof uploaded)[];
  const documentText = "实验目标：记录声学数据\n频率：48000 Hz\n";
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/lab/tasks/issue/documents/", (route) => route.fulfill({ json: { can_edit: true, documents } }));
  await page.route("**/lab/projects/project/documents/upload/", async (route) => {
    const request = route.request();
    if (request.method() !== "POST") throw new Error("Document upload requires POST");
    uploads.push({
      path: new URL(request.url()).pathname,
      contentType: request.headers()["content-type"] ?? "",
      body: request.postDataBuffer()?.toString("utf8") ?? "",
    });
    documents.push(uploaded);
    await route.fulfill({ status: 201, json: uploaded });
  });

  await page.goto(`${origin}/peek`);
  const overview = page.locator('[data-issue-peek-overview="issue"]');
  const linked = page.getByRole("region", { name: "关联文档", exact: true });
  await expect(page.getByText("完整实验说明", { exact: true })).toBeVisible();
  await expect(linked.getByRole("link", { name: existing.name, exact: true })).toBeVisible();
  await expect(linked.getByRole("button", { name: "新建实验记录", exact: true })).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.nativeCloseCount = "0";
    window.addEventListener("native-issue-closed", () => {
      document.documentElement.dataset.nativeCloseCount = String(
        Number(document.documentElement.dataset.nativeCloseCount) + 1
      );
    });
  });
  await linked.getByRole("button", { name: "上传文档", exact: true }).click({ timeout: 3000 });
  const dialog = page.getByRole("dialog", { name: "上传文档", exact: true });
  await expect(dialog).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    dialog.getByLabel("文件", { exact: true }).click(),
  ]);
  await chooser.setFiles({ name: "实验记录.txt", mimeType: "text/plain", buffer: Buffer.from(documentText) });
  await dialog.getByLabel("文档名称", { exact: true }).click();
  await dialog.getByLabel("文档名称", { exact: true }).fill("实验记录.txt");
  await expect(overview).toBeAttached();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(linked.getByText("实验记录.txt", { exact: true })).toBeVisible();
  await expect(linked.getByRole("button", { name: "阅读", exact: true })).toBeVisible();
  await expect(linked.getByRole("button", { name: "下载", exact: true })).toBeVisible();
  await expect(overview).toBeVisible();
  await expect(page).toHaveURL(`${origin}/peek`);
  expect(await page.evaluate(() => document.documentElement.dataset.nativeCloseCount)).toBe("0");
  expect(uploads).toHaveLength(1);
  expect(uploads[0]!.path).toBe("/api/workspaces/test/lab/projects/project/documents/upload/");
  expect(uploads[0]!.contentType).toMatch(/^multipart\/form-data; boundary=/);
  expect(uploads[0]!.body).toContain('name="issue_id"\r\n\r\nissue');
  expect(uploads[0]!.body).toContain('name="name"\r\n\r\n实验记录.txt');
  expect(uploads[0]!.body).toContain('name="access"\r\n\r\n0');
  expect(uploads[0]!.body).toContain('filename="实验记录.txt"');
  expect(uploads[0]!.body).toContain(documentText);
});

test("reading a controlled shared document keeps its task overview open through nested dialog interactions", async ({
  page,
}) => {
  const reads: string[] = [];
  const nativeProjectRequests: string[] = [];
  const materialPath = "bounties/bounty/materials/material/";
  const file = {
    name: "共享执行说明.md",
    extension: "md",
    content_type: "text/markdown",
    size: 24,
    version_id: "shared-version",
    previewable: true,
    download_path: `${materialPath}download/`,
    preview_path: `${materialPath}preview/`,
  };
  await page.route("**/api/**", (route) => {
    nativeProjectRequests.push(new URL(route.request().url()).pathname);
    return route.fulfill({ status: 403, json: { error: "测试成员无原生项目访问权限" } });
  });
  await page.route("**/lab/bounties/bounty/detail/", (route) =>
    route.fulfill({
      json: {
        id: "bounty",
        stage_id: "stage",
        project_id: "project",
        project: "海声实验",
        issue_id: "issue",
        title: "共享执行任务",
        deliverable: "实验记录",
        criteria: "参数完整",
        budget: "12.50",
        reserved: "0.00",
        awarded: "0.00",
        status: "active",
        major: false,
        major_reasons: [],
        evidence: "",
        due_at: null,
        overdue: false,
        is_lead: false,
        is_reviewer: false,
        is_independent_reviewer: false,
        allocations: [],
        acceptances: [],
        access_level: "task",
        can_manage_materials: false,
      },
    })
  );
  await page.route("**/lab/bounties/bounty/workflow/", (route) =>
    route.fulfill({
      json: { nodes: [], edges: [], actions: [], history: [], current_node: "active" },
    })
  );
  await page.route("**/lab/bounties/bounty/materials/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    reads.push(path);
    if (path.endsWith("/materials/"))
      return route.fulfill({
        json: { materials: [{ id: "material", kind: "document_version", label: "执行说明" }] },
      });
    if (path.endsWith("/material/"))
      return route.fulfill({
        json: {
          name: "冻结的执行说明",
          description_html: "<p>仅共享版本资料</p>",
          created_at: "2026-10-10T00:00:00Z",
          file,
        },
      });
    if (path.endsWith("/preview/"))
      return route.fulfill({
        json: { text: "# 执行步骤\n\n记录实验参数。", format: "md", filename: file.name },
      });
    if (path.endsWith("/download/"))
      return route.fulfill({
        contentType: "text/markdown",
        headers: { "Content-Disposition": 'attachment; filename="instructions.md"' },
        body: Buffer.from("# 执行步骤\r\n\r\n记录实验参数。\r\n"),
      });
    throw new Error(`Unexpected material request: ${path}`);
  });

  await page.goto(`${origin}/controlled-materials`);
  const overview = page.getByRole("dialog", { name: "悬赏任务详情", exact: true });
  await expect(overview).toBeVisible();
  await overview.getByRole("button", { name: "读取共享版本", exact: true }).click();
  const shared = page.getByRole("dialog", { name: "冻结的执行说明", exact: true });
  await expect(shared).toBeVisible();
  await shared.getByRole("button", { name: "阅读", exact: true }).click();
  const reader = page.getByRole("dialog", { name: "阅读文档", exact: true });
  await expect(reader).toBeVisible({ timeout: 3000 });
  await expect(reader.getByRole("heading", { name: "执行步骤", exact: true })).toBeVisible();
  await reader.getByText("记录实验参数。", { exact: true }).click();
  await expect(overview).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(reader).toHaveCount(0);
  await expect(shared).toBeVisible();
  await expect(overview).toBeAttached();
  await shared.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(reader.getByRole("heading", { name: "执行步骤", exact: true })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    reader.getByRole("button", { name: "下载", exact: true }).click(),
  ]);
  expect(await readFile((await download.path())!)).toEqual(Buffer.from("# 执行步骤\r\n\r\n记录实验参数。\r\n"));
  await reader.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(reader).toHaveCount(0);
  await expect(shared).toBeVisible();
  await shared.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(shared).toHaveCount(0);
  await expect(overview).toBeVisible();
  await expect(page).toHaveURL(`${origin}/controlled-materials`);
  expect(reads).toContain("/api/workspaces/test/lab/bounties/bounty/materials/material/preview/");
  expect(reads).toContain("/api/workspaces/test/lab/bounties/bounty/materials/material/download/");
  expect(nativeProjectRequests).toEqual([]);
});

test("six document formats upload from the chooser, preserve a rejected private draft and hide upload on a read-only issue", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const documents: LabDocument[] = [];
  const uploads: string[] = [];
  let rejectFirst = true;
  const formats = [
    ["txt", "text/plain"],
    ["md", "text/markdown"],
    ["doc", "application/msword"],
    ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
    ["xls", "application/vnd.ms-excel"],
    ["xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ] as const;
  await setupDocuments(page, documents);
  await page.route("**/lab/projects/project/documents/upload/", async (route) => {
    const body = route.request().postDataBuffer()?.toString("utf8") ?? "";
    uploads.push(body);
    if (rejectFirst) {
      rejectFirst = false;
      return route.fulfill({ status: 400, json: { error: "文档上传失败，请重试" } });
    }
    const selected = formats.find(([extension]) => body.includes(`filename="资料.${extension}"`));
    if (!selected) throw new Error("Expected one of the six selected document files");
    const [extension, contentType] = selected;
    const document = fileDocument(
      `保留名称-${extension}`,
      extension,
      contentType,
      Buffer.from(`原始-${extension}-文件\r\n`),
      extension
    );
    document.file!.name = `资料.${extension}`;
    document.access = extension === "txt" ? 1 : 0;
    documents.push(document);
    await route.fulfill({ status: 201, json: document });
  });
  await page.goto(`${origin}/peek`);
  const linked = page.getByRole("region", { name: "关联文档", exact: true });
  const overview = page.locator('[data-issue-peek-overview="issue"]');
  /* oxlint-disable no-await-in-loop -- Each browser dialog must finish before selecting the next format. */
  for (const [extension, mimeType] of formats) {
    await linked.getByRole("button", { name: "上传文档", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "上传文档", exact: true });
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      dialog.getByLabel("文件", { exact: true }).click(),
    ]);
    await chooser.setFiles({ name: `资料.${extension}`, mimeType, buffer: Buffer.from(`原始-${extension}-文件\r\n`) });
    await dialog.getByLabel("文档名称", { exact: true }).fill(`保留名称-${extension}`);
    if (extension === "txt") await dialog.getByLabel("私人", { exact: true }).check();
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    if (extension === "txt") {
      await expect(dialog.getByRole("alert")).toHaveText("文档上传失败，请重试");
      await expect(dialog.getByLabel("文档名称", { exact: true })).toHaveValue("保留名称-txt");
      await expect(dialog.getByLabel("私人", { exact: true })).toBeChecked();
      expect(
        await dialog
          .getByLabel("文件", { exact: true })
          .evaluate((input) => (input as HTMLInputElement).files?.[0]?.name)
      ).toBe("资料.txt");
      await expect(overview).toBeAttached();
      await dialog.getByRole("button", { name: "保存", exact: true }).click();
    }
    await expect(dialog).toHaveCount(0);
    await expect(linked.getByText(`保留名称-${extension}`, { exact: true })).toBeVisible();
    await expect(overview).toBeVisible();
    const body = uploads.at(-1)!;
    expect(body).toContain(`filename="资料.${extension}"`);
    expect(body).toContain(`原始-${extension}-文件\r\n`);
    expect(body).toContain(`name="name"\r\n\r\n保留名称-${extension}`);
    expect(body).toContain(`name="access"\r\n\r\n${extension === "txt" ? "1" : "0"}`);
    expect(body).toContain('name="issue_id"\r\n\r\nissue');
  }
  /* oxlint-enable no-await-in-loop */
  expect(uploads).toHaveLength(7);
  // The HTTP permission remains editable; the real native issue's read-only prop controls the entry.
  await page.goto(`${origin}/peek?readonly`);
  await expect(linked.getByText("保留名称-txt", { exact: true })).toBeVisible();
  await expect(linked.getByRole("button", { name: "上传文档", exact: true })).toHaveCount(0);
  await expect(linked.getByRole("button", { name: "新建实验记录", exact: true })).toHaveCount(0);
  await expect(linked.getByRole("button", { name: "关联已有文档", exact: true })).toHaveCount(0);
  await expect(linked.getByRole("button", { name: "阅读", exact: true })).toHaveCount(2);
  await expect(linked.getByRole("button", { name: "下载", exact: true })).toHaveCount(6);
});

test("TXT and Markdown readers retry failed previews, render safely and download the original bytes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const txt =
    "实验原文\r\n<script>window.documentFileExecuted=true</script>\r\n<img src=x onerror=window.documentFileExecuted=true>\r\n";
  const markdown = [
    "# 实验结果",
    "",
    "**频率：48000 Hz**",
    "",
    "[安全链接](https://example.org/experiment)",
    "[危险链接](javascript:alert%281%29)",
    "[数据链接](data:text/html;base64,PHNjcmlwdD4=)",
    "![远程图片](https://untrusted.invalid/experiment.png)",
    "<script>window.documentFileExecuted=true</script>",
    "<img src=x onerror=window.documentFileExecuted=true>",
  ].join("\n");
  const original = Buffer.from(`\uFEFF${txt}`);
  const documents = [
    fileDocument("原始记录.txt", "txt", "text/plain", original, "txt"),
    fileDocument("实验结果.md", "md", "text/markdown", Buffer.from(markdown), "md"),
  ];
  const externalRequests: string[] = [];
  const previewReads: string[] = [];
  let rejectPreview = true;
  await setupDocuments(page, documents);
  await page.route("https://untrusted.invalid/**", (route) => {
    externalRequests.push(route.request().url());
    return route.fulfill({ status: 204 });
  });
  await page.route("**/lab/documents/*/files/file-version/preview/", (route) => {
    const path = new URL(route.request().url()).pathname;
    previewReads.push(path);
    if (path.includes("/txt/")) {
      if (rejectPreview) {
        rejectPreview = false;
        return route.fulfill({ status: 403, json: { error: "文档读取失败，请重试" } });
      }
      return route.fulfill({ json: { text: txt, format: "txt", filename: "原始记录.txt" } });
    }
    return route.fulfill({ json: { text: markdown, format: "md", filename: "实验结果.md" } });
  });
  await page.route("**/lab/documents/txt/files/file-version/download/", (route) =>
    route.fulfill({
      contentType: "text/plain",
      headers: { "Content-Disposition": 'attachment; filename="original.txt"' },
      body: original,
    })
  );
  await page.goto(`${origin}/peek`);
  const overview = page.locator('[data-issue-peek-overview="issue"]');
  const linked = page.getByRole("region", { name: "关联文档", exact: true });
  const txtRow = linked.getByRole("listitem").filter({ hasText: "原始记录.txt" });
  await txtRow.getByRole("button", { name: "阅读", exact: true }).click();
  const reader = page.getByRole("dialog", { name: "阅读文档", exact: true });
  await expect(reader.getByRole("alert")).toHaveText("文档读取失败，请重试");
  await reader.getByRole("button", { name: "重试", exact: true }).click();
  await expect(reader.locator("pre")).toHaveText(txt);
  await expect(reader.locator("script,img")).toHaveCount(0);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    reader.getByRole("button", { name: "下载", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("原始记录.txt");
  expect(await readFile((await download.path())!)).toEqual(original);
  await reader.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(overview).toBeVisible();
  const mdRow = linked.getByRole("listitem").filter({ hasText: "实验结果.md" });
  await mdRow.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(reader.getByRole("heading", { name: "实验结果", exact: true })).toBeVisible();
  await expect(reader.getByRole("link", { name: "安全链接", exact: true })).toHaveAttribute(
    "href",
    "https://example.org/experiment"
  );
  await expect(reader.getByRole("link", { name: "安全链接", exact: true })).toHaveAttribute(
    "rel",
    "noopener noreferrer"
  );
  await expect(reader.getByText("危险链接", { exact: true })).toBeVisible();
  await expect(reader.getByText("数据链接", { exact: true })).toBeVisible();
  await expect(reader.locator('script,img,a[href^="javascript:"],a[href^="data:"]')).toHaveCount(0);
  await expect(reader.getByText("远程图片", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => (window as Window & { documentFileExecuted?: boolean }).documentFileExecuted)
  ).toBeUndefined();
  expect(externalRequests).toEqual([]);
  await reader.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(overview).toBeVisible();
  await mdRow.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(reader.getByRole("heading", { name: "实验结果", exact: true })).toBeVisible();
  expect(previewReads.filter((path) => path.includes("/txt/"))).toHaveLength(2);
  expect(previewReads.filter((path) => path.includes("/md/"))).toHaveLength(2);
});

test("the native PagesListView uploads a private document by dropping a file and refreshes its project list", async ({
  page,
}) => {
  const content = "# 项目实验记录\n\n频率：48000 Hz\n";
  const uploads: string[] = [];
  const pageReads: string[] = [];
  const unexpected: string[] = [];
  await page.route("**/api/**", (route) => {
    unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    return route.fulfill({ status: 404, json: { error: "Unexpected native API request" } });
  });
  await page.route("**/api/instances/", (route) =>
    route.fulfill({ json: { config: { file_size_limit: 5 * 1024 * 1024 } } })
  );
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test" } }));
  await page.route("**/api/workspaces/test/projects/project/pages/**", (route) => {
    pageReads.push(route.request().url());
    return route.fulfill({ json: [] });
  });
  await page.route("**/lab/projects/project/documents/upload/", (route) => {
    uploads.push(route.request().postDataBuffer()?.toString("utf8") ?? "");
    const document = fileDocument("拖放项目记录.md", "md", "text/markdown", Buffer.from(content), "project-document");
    document.access = 1;
    return route.fulfill({ status: 201, json: document });
  });
  await page.goto(`${origin}/native-project-documents?private`);
  await page.getByRole("button", { name: "上传文档", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "上传文档", exact: true });
  await expect(dialog.getByLabel("私人", { exact: true })).toBeChecked();
  const dataTransfer = await page.evaluateHandle((text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "拖放项目记录.md", { type: "text/markdown" }));
    return transfer;
  }, content);
  await dialog.getByLabel("文件拖放区域", { exact: true }).dispatchEvent("drop", { dataTransfer });
  await expect(dialog.getByLabel("文档名称", { exact: true })).toHaveValue("拖放项目记录.md");
  await dataTransfer.dispose();
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => pageReads.length).toBe(2);
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toContain('filename="拖放项目记录.md"');
  expect(uploads[0]).toContain(content);
  expect(uploads[0]).toContain('name="access"\r\n\r\n1');
  expect(uploads[0]).not.toContain('name="issue_id"');
  expect(unexpected).toEqual([]);
  await page.goto(`${origin}/native-project-documents?readonly`);
  await expect(page.getByRole("button", { name: "上传文档", exact: true })).toHaveCount(0);
});

test("the native PageRoot exposes its uploaded file for reading and download while a legacy Page has no file panel", async ({
  page,
}) => {
  const bytes = Buffer.from("原始Page文件\r\n48000 Hz\r\n");
  let document = fileDocument("Page记录.txt", "txt", "text/plain", bytes, "page");
  const reads: string[] = [];
  await setupDocuments(page, []);
  await page.route("**/lab/documents/page/tasks/**", (route) =>
    route.fulfill({ json: { tasks: [], can_edit: false } })
  );
  await page.route("**/lab/projects/project/documents/page/", (route) => {
    reads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: document });
  });
  await page.route("**/lab/documents/page/files/file-version/preview/", (route) => {
    reads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ json: { text: bytes.toString("utf8"), format: "txt", filename: "Page记录.txt" } });
  });
  await page.route("**/lab/documents/page/files/file-version/download/", (route) => {
    reads.push(new URL(route.request().url()).pathname);
    return route.fulfill({ contentType: "text/plain", body: bytes });
  });
  await page.goto(`${origin}/native-page`);
  await expect(page.getByText("原生Page编辑器", { exact: true })).toBeVisible();
  const panel = page.getByRole("region", { name: "文档文件", exact: true });
  await expect(panel.getByText("Page记录.txt", { exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "阅读", exact: true }).click();
  const reader = page.getByRole("dialog", { name: "阅读文档", exact: true });
  await expect(reader.locator("pre")).toHaveText(bytes.toString("utf8"));
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    reader.getByRole("button", { name: "下载", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("Page记录.txt");
  expect(await readFile((await download.path())!)).toEqual(bytes);
  await reader.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByText("原生Page编辑器", { exact: true })).toBeVisible();
  expect(reads).toEqual([
    "/api/workspaces/test/lab/projects/project/documents/page/",
    "/api/workspaces/test/lab/documents/page/files/file-version/preview/",
    "/api/workspaces/test/lab/documents/page/files/file-version/download/",
  ]);
  document = { ...document, file: null };
  const loaded = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/projects/project/documents/page/")
  );
  await page.reload();
  await loaded;
  await expect(page.getByText("原生Page编辑器", { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
});
