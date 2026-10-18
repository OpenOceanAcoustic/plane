/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import type { ChatMessage, ChatThread } from "@plane/types";

let server: ReturnType<typeof createServer>;
let origin = "";
let directory = "";
let rows: ChatMessage[] = [];
let nextId = 0;
let failSend = false;
let failUpload = false;
const images = new Map<string, Buffer>();
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);
const receipts = new Map<string, ChatMessage>();
const reads = new Map<string, string>();
const workspaceId = "33333333-3333-4333-8333-333333333333";
const threadId = "11111111-1111-4111-8111-111111111111";
const projectThreadId = "22222222-2222-4222-8222-222222222222";
const issueId = "44444444-4444-4444-8444-444444444444";
const projectId = "55555555-5555-4555-8555-555555555555";
const thread: ChatThread = {
  id: threadId,
  workspace: workspaceId,
  scope: "workspace",
  title: "研究组",
  can_write: true,
  project_id: null,
  issue_id: null,
  unread_count: 0,
  activity_at: "2026-10-15T00:00:00Z",
  preview: "",
};

const seams = `
const users={one:{id:'one',display_name:'小林',first_name:'小林',avatar_url:'',is_bot:false},two:{id:'two',display_name:'小王',first_name:'小王',avatar_url:'',is_bot:false}};
export function useUser(){return {data: users[document.cookie.includes('chat_user=two')?'two':'one']}}
export function useMember(){return {getUserDetails:id=>users[id],project:{getProjectMemberDetails:()=>({role:15})}}}
export function useWorkspace(){return {getWorkspaceBySlug:()=>({id:'${workspaceId}',slug:'test'})}}
const details={commentReaction:{applyCommentReactions:()=>{}},setPeekIssue:ref=>window.dispatchEvent(new CustomEvent('chat-peek',{detail:ref}))};
export function useIssueDetail(){return details}
export function useWorkItemCommentOperations(){return {}}
export function useEditorAsset(){return {assetsUploadPercentage:{}}}
export function useFileSize(){return {maxFileSize:1000000}}
`;

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "plane-chat-browser-"));
  const require = createRequire(resolve("apps/web/package.json"));
  const { build } = require("esbuild") as typeof import("esbuild");
  await build({
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {BrowserRouter,Routes,Route} from 'react-router';import {LabChat} from '${resolve("apps/web/core/components/lab/chat.tsx")}';createRoot(document.getElementById('root')).render(<BrowserRouter><Routes><Route path='/:workspaceSlug/lab/chat' element={<LabChat openProjectIssue={ref=>window.dispatchEvent(new CustomEvent('chat-peek',{detail:ref}))}/>}/></Routes></BrowserRouter>);`,
      loader: "tsx",
      resolveDir: resolve("apps/web"),
      sourcefile: "chat-harness.tsx",
    },
    plugins: [
      {
        name: "chat-context-seams",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (
              [
                "@/hooks/store/user",
                "@/hooks/store/use-member",
                "@/hooks/store/use-workspace",
                "@/hooks/store/use-issue-detail",
                "@/hooks/store/use-editor-asset",
                "@/hooks/use-file-size",
                "@/components/issues/issue-detail/issue-activity/helper",
              ].includes(args.path)
            )
              return { path: args.path, namespace: "context" };
            if (args.path === "@plane/i18n") return { path: args.path, namespace: "translation" };
            if (args.path === "@plane/shared-state") return { path: resolve("packages/shared-state/src/index.ts") };
            if (args.path === "next/navigation") return { path: resolve("apps/web/app/compat/next/navigation.ts") };
            if (args.path === "next/link") return { path: resolve("apps/web/app/compat/next/link.tsx") };
          });
          builder.onLoad({ filter: /.*/, namespace: "context" }, () => ({
            contents: seams,
            loader: "tsx",
            resolveDir: resolve("apps/web"),
          }));
          builder.onLoad({ filter: /.*/, namespace: "translation" }, () => ({
            contents: `const labels={'common.comment':'发送','common.actions.edit':'编辑','common.actions.delete':'删除','common.actions.copy_link':'复制链接','issue.comments.placeholder':'输入消息'};export function useTranslation(){return {t:key=>labels[key]??key,currentLocale:'zh-CN'}};`,
            loader: "js",
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
    loader: { ".svg": "dataurl", ".png": "dataurl", ".woff2": "dataurl", ".webp": "dataurl" },
    logLevel: "silent",
  });
  const assets = resolve("apps/web/build/client/assets");
  const theme = (
    await Promise.all(
      (
        await readdir(assets)
      )
        .filter((file) => file.endsWith(".css"))
        .map((file) => readFile(join(assets, file), "utf8"))
    )
  ).join("\n");
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (["/app.js", "/app.css", "/theme.css"].includes(url.pathname)) {
      response.setHeader("Content-Type", url.pathname.endsWith(".js") ? "text/javascript" : "text/css");
      response.end(
        url.pathname === "/theme.css" ? theme : await readFile(join(directory, url.pathname.slice(1))).catch(() => "")
      );
      return;
    }
    const user = request.headers.cookie?.includes("chat_user=two") ? "two" : "one";
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const multipart = request.headers["content-type"]?.startsWith("multipart/form-data");
    const data = body && !multipart ? JSON.parse(body) : {};
    const json = (value: unknown, status = 200) => {
      response.statusCode = status;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(value));
    };
    if (url.pathname === "/auth/get-csrf-token/") {
      json({ csrf_token: "browser-test" });
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      if (url.pathname.endsWith("/images/") && request.method === "POST") {
        if (failUpload) {
          failUpload = false;
          json({ error: "图片上传失败" }, 503);
          return;
        }
        if (!multipart) {
          json({ error: "Expected multipart image upload" }, 400);
          return;
        }
        const assetId = randomUUID();
        images.set(assetId, png);
        json({ asset_id: assetId }, 201);
        return;
      }
      const imageMatch = url.pathname.match(/\/images\/([^/]+)\/$/);
      if (imageMatch && images.has(imageMatch[1])) {
        response.setHeader("Content-Type", "image/png");
        response.end(images.get(imageMatch[1]));
        return;
      }
      const active = url.pathname.includes(projectThreadId) ? projectThreadId : threadId;
      const summary = (id: string) => ({
        ...thread,
        id,
        ...(id === projectThreadId ? { scope: "project", title: "声学项目", project_id: projectId } : {}),
        unread_count: rows.filter(
          (row) => row.thread_id === id && row.actor !== user && row.id > (reads.get(`${user}:${id}`) ?? "")
        ).length,
      });
      if (url.pathname.endsWith("/threads/")) {
        json(
          request.method === "POST"
            ? summary(threadId)
            : { results: [summary(threadId), summary(projectThreadId)], next_offset: null }
        );
        return;
      }
      if (url.pathname.endsWith("/references/")) {
        json({
          users: [{ id: "two", display_name: "小王", avatar_url: "" }],
          issues: [{ id: issueId, accessible: true, key: "OA-1", title: "校准水听器", project_id: projectId }],
        });
        return;
      }
      if (url.pathname.endsWith("/read/")) {
        reads.set(`${user}:${active}`, data.message_id);
        json({ unread_count: summary(active).unread_count });
        return;
      }
      const messageMatch = url.pathname.match(/\/messages\/([^/]+)\/$/);
      if (messageMatch) {
        if (request.method === "DELETE") {
          rows = rows.filter((row) => row.id !== messageMatch[1]);
          response.statusCode = 204;
          response.end();
          return;
        }
        const row = rows.find((item) => item.id === messageMatch[1])!;
        Object.assign(row, { comment_html: data.comment_html, edited_at: new Date().toISOString() });
        json(row);
        return;
      }
      if (url.pathname.endsWith("/messages/")) {
        if (request.method !== "POST") {
          json({
            messages: rows
              .filter((row) => row.thread_id === active)
              .map((row) => Object.assign({}, row, { can_edit: row.actor === user, can_delete: row.actor === user })),
            next_cursor: null,
            sync_cursor: "cursor",
            has_newer: false,
          });
          return;
        }
        if (failSend) {
          failSend = false;
          json({ error: "模拟发送失败" }, 503);
          return;
        }
        if (receipts.has(data.client_message_id)) {
          json(receipts.get(data.client_message_id));
          return;
        }
        const id = String(++nextId).padStart(5, "0");
        const row = {
          id,
          workspace: workspaceId,
          thread_id: active,
          actor: user,
          actor_detail: {
            id: user,
            display_name: user === "one" ? "小林" : "小王",
            first_name: "",
            last_name: "",
            avatar_url: "",
            is_bot: false,
          },
          comment_html: data.comment_html,
          comment_json: {},
          comment_stripped: data.comment_html.replace(/<[^>]*>/g, ""),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          access: "INTERNAL",
          attachments: [],
          comment_reactions: [],
          parent_id: data.parent_id,
          can_edit: true,
          can_delete: true,
          references: {
            [issueId]: { id: issueId, accessible: true, key: "OA-1", title: "校准水听器", project_id: projectId },
          },
        } as ChatMessage;
        rows.push(row);
        receipts.set(data.client_message_id, row);
        json(row, 201);
        return;
      }
      json(summary(active));
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      '<!DOCTYPE html><html lang="zh-CN"><head><link rel="stylesheet" href="/theme.css"><link rel="stylesheet" href="/app.css"><style>html,body,#root{height:100%;margin:0}body{font-family:system-ui}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
    );
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.beforeEach(() => {
  rows = [];
  receipts.clear();
  reads.clear();
  nextId = 0;
  failSend = false;
  failUpload = false;
  images.clear();
});
test.afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
  await rm(directory, { recursive: true, force: true });
});

test("native editor keeps failed drafts, sends once, and synchronizes a second reader", async ({ page, browser }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/test/lab/chat?thread=${threadId}`);
  const editor = page.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.fill("一起检查测试数据");
  failSend = true;
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("模拟发送失败");
  await expect(editor).toContainText("一起检查测试数据");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("[data-message-id]")).toHaveCount(1);
  await expect(editor).toHaveText("");
  const context = await browser.newContext();
  await context.addCookies([{ name: "chat_user", value: "two", url: origin }]);
  const other = await context.newPage();
  await other.goto(`${origin}/test/lab/chat?thread=${threadId}`);
  await expect(other.locator("[data-message-id]")).toContainText("一起检查测试数据");
  await page.bringToFront();
  await editor.fill("第二条消息");
  await editor.press("Enter");
  await expect(page.locator("[data-message-id]")).toHaveCount(2);
  await other.bringToFront();
  await expect(other.locator("[data-message-id]")).toHaveCount(2, { timeout: 10000 });
  expect(rows).toHaveLength(2);
  expect(errors).toEqual([]);
  await context.close();
});

test("native mention picker inserts work-item references and opens the existing detail callback", async ({ page }) => {
  await page.goto(`${origin}/test/lab/chat?thread=${threadId}`);
  const editor = page.locator('[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.pressSequentially("@OA");
  await page.getByText("OA-1 校准水听器", { exact: true }).click();
  await expect(editor).toContainText("OA-1");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("[data-message-id]")).toHaveCount(1);
  await page.evaluate(() =>
    window.addEventListener("chat-peek", (event) => {
      document.body.dataset.peek = JSON.stringify((event as CustomEvent).detail);
    })
  );
  await page.locator("[data-message-id]").getByRole("button", { name: "@OA-1 校准水听器" }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-peek",
    JSON.stringify({ issue_id: issueId, project_id: projectId })
  );
});

test("conversation switching retains drafts and narrow layouts keep navigation usable", async ({ page }) => {
  await page.goto(`${origin}/test/lab/chat?thread=${threadId}`);
  await page.locator('[contenteditable="true"]').fill("保留草稿");
  await page.getByRole("button", { name: "声学项目" }).click();
  await expect(page.getByRole("heading", { name: "声学项目" })).toBeVisible();
  await page.getByRole("button", { name: "研究组" }).click();
  await expect(page.locator('[contenteditable="true"]')).toContainText("保留草稿");
  await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath("chat-light.png") });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "dark";
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "返回会话" }).click();
  await expect(page.getByRole("complementary", { name: "会话列表" })).toBeVisible();
  await page.getByRole("button", { name: "声学项目" }).click();
  await expect(page.getByRole("heading", { name: "声学项目" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath("chat-dark-narrow.png") });
});

test("native comment menus edit, reply to, and delete messages", async ({ page }) => {
  await page.goto(`${origin}/test/lab/chat?thread=${threadId}`);
  const composer = page.locator('[contenteditable="true"]');
  await composer.fill("需修改的消息");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const first = page.locator("[data-message-id]").first();
  await first.locator('[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
  const edit = first.locator('[contenteditable="true"]');
  await edit.fill("已修改的消息");
  await edit.press("Enter");
  await expect(first).toContainText("已修改的消息");
  await expect(first.locator('[contenteditable="true"]')).toHaveCount(0);
  await first.locator('[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "回复", exact: true }).click();
  await expect(page.getByRole("button", { name: "取消回复" })).toBeVisible();
  await composer.fill("回复内容");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator("[data-message-id]")).toHaveCount(2);
  expect(rows[1].parent_id).toBe(rows[0].id);
  await first.locator('[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await expect(page.locator("[data-message-id]")).toHaveCount(1);
  await expect(page.locator("[data-message-id]")).toContainText("回复内容");
});

for (const scope of ["workspace", "project"]) {
  test(`${scope} chat sends image-only comments, keeps failed drafts, and displays images after reload`, async ({
    page,
  }) => {
    const active = scope === "workspace" ? threadId : projectThreadId;
    await page.goto(`${origin}/test/lab/chat?thread=${active}`);
    const editor = page.locator('[contenteditable="true"]');
    const picker = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Image", exact: true }).click();
    await (await picker).setFiles({ name: "实验图片.png", mimeType: "image/png", buffer: png });
    await expect.poll(() => images.size).toBe(1);
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    failSend = true;
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("模拟发送失败");
    await expect(editor.locator("img")).toBeVisible();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator("[data-message-id]")).toHaveCount(1);
    const image = page.locator("[data-message-id] img");
    await expect(image).toBeVisible();
    expect(await image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(
      true
    );
    expect(rows[0].comment_html).toContain("image-component");
    await expect(editor.locator("img")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("[data-message-id] img")).toBeVisible();
    expect(rows).toHaveLength(1);
  });
}

test("native image uploader retries failed uploads and editing can add a picture", async ({ page }) => {
  await page.goto(`${origin}/test/lab/chat?thread=${threadId}`);
  await page.locator('[contenteditable="true"]').fill("补充实验图片");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  const message = page.locator("[data-message-id]");
  await message.locator('[aria-haspopup="menu"]').click();
  await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
  failUpload = true;
  const picker = page.waitForEvent("filechooser");
  await message.getByRole("button", { name: "Image", exact: true }).click();
  await (await picker).setFiles({ name: "retry.png", mimeType: "image/png", buffer: png });
  await expect.poll(() => failUpload).toBe(false);
  await message.locator('input[type="file"]').setInputFiles({ name: "retry.png", mimeType: "image/png", buffer: png });
  await expect.poll(() => images.size).toBe(1);
  await message.locator('[contenteditable="true"]').press("Enter");
  await expect(message.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(message.locator("img")).toBeVisible();
  expect(rows[0].comment_html).toContain("image-component");
});

for (const action of ["paste", "drop"]) {
  test(`native editor accepts image ${action} and keeps image drafts across conversations`, async ({ page }) => {
    await page.goto(`${origin}/test/lab/chat?thread=${threadId}`);
    const editor = page.locator('[contenteditable="true"]');
    await editor.fill("实验记录与图片");
    await editor.evaluate(
      (element, payload) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(payload.bytes)], "实验.png", { type: "image/png" }));
        const rect = element.getBoundingClientRect();
        element.dispatchEvent(
          payload.action === "paste"
            ? new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true })
            : new DragEvent("drop", {
                dataTransfer: transfer,
                clientX: rect.left + 10,
                clientY: rect.top + 10,
                bubbles: true,
                cancelable: true,
              })
        );
      },
      { action, bytes: Array.from(png) }
    );
    await expect.poll(() => images.size).toBe(1);
    await expect(page.getByRole("button", { name: "发送", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "声学项目" }).click();
    await page.getByRole("button", { name: "研究组" }).click();
    await expect(editor.locator("img")).toBeVisible();
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator("[data-message-id] img")).toBeVisible();
    expect(rows[0].comment_stripped).toContain("实验记录与图片");
    expect(rows[0].comment_html).toContain("image-component");
  });
}
