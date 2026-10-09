/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

function milestone(label: string): void {
  // Static labels only; no document URLs, upload signatures or credentials.
  process.stdout.write(`[lab-e2e documents] ${label}\n`);
}

/** Requires the authenticated context created by the main isolated browser test. */
export async function verifyDocumentsWorkflow({
  page,
  fixture,
}: {
  page: Page;
  fixture: { project: string; issue: string };
}): Promise<void> {
  if (process.env.LAB_E2E_PROJECT !== "ooa-plane-e2e")
    throw new Error("Documents/workflow browser tests require the isolated ooa-plane-e2e project");
  if (!/^[0-9a-f-]{36}$/i.test(fixture.project)) throw new Error("Invalid isolated project fixture ID");
  const nativeBase = `/api/workspaces/browser-lab/projects/${fixture.project}/pages/`;
  await page.goto(`/browser-lab/projects/${fixture.project}/issues/${fixture.issue}`);
  const documents = page.getByRole("region", { name: "关联文档", exact: true });
  await expect(documents).toBeVisible();
  await documents.getByRole("button", { name: "新建实验记录", exact: true }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("文档名称").fill("浏览器实验记录");
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/lab/projects/${fixture.project}/documents/`) && response.request().method() === "POST",
    { timeout: 30000 }
  );
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const document = (await response.json()) as { id: string };
  const documentPath = `/browser-lab/projects/${fixture.project}/pages/${document.id}`;
  await page.waitForURL((url) => url.pathname.replace(/\/$/, "") === documentPath, {
    timeout: 30000,
    waitUntil: "domcontentloaded",
  });
  const editor = page
    .locator('.tiptap.ProseMirror[contenteditable="true"]')
    .filter({ has: page.locator("h2") })
    .first();
  await expect(editor.getByRole("heading", { name: "目标", exact: true })).toBeVisible();
  await expect(editor.getByRole("heading", { name: "后续事项", exact: true })).toBeVisible();
  await page.locator("summary").filter({ hasText: "关联任务" }).click();
  await expect(page.getByRole("link", { name: /Original project task/ })).toBeVisible();
  const versionsResponse = await page.request.get(`${nativeBase}${document.id}/versions/`);
  expect(versionsResponse.status()).toBe(200);
  const versions = (await versionsResponse.json()) as { id: string }[];
  expect(versions.length).toBeGreaterThan(0);
  milestone("native experiment template and task backlink verified");
  // Exercise the native Tiptap editor and await persistence before restoring.
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("版本恢复测试内容");
  await expect
    .poll(
      async () => {
        const detail = await page.request.get(`${nativeBase}${document.id}/`);
        const body = (await detail.json()) as { description_html: string };
        return body.description_html;
      },
      { timeout: 30000 }
    )
    .toContain("版本恢复测试内容");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/image");
  await page
    .locator('button[id^="item-"]')
    .filter({ hasText: /^(Image|图片)$/ })
    .click();
  const uploaded = page.waitForResponse(
    (uploadResponse) =>
      new URL(uploadResponse.url()).pathname.replace(/\/$/, "") === "/uploads" &&
      uploadResponse.request().method() === "POST",
    { timeout: 30000 }
  );
  await editor.locator('.image-upload-component input[type="file"]').setInputFiles({
    name: "lab-experiment.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    ),
  });
  expect([200, 201, 204]).toContain((await uploaded).status());
  await expect
    .poll(
      () =>
        editor
          .locator("img")
          .first()
          .evaluate((element) => (element as HTMLImageElement).naturalWidth),
      { timeout: 30000 }
    )
    .toBeGreaterThan(0);
  milestone("native editor attachment upload verified");
  await page.goto(`${documentPath}?version=${versions[0]!.id}`);
  const restore = page.getByRole("button", { name: "恢复此版本", exact: true });
  await expect(restore).toBeVisible();
  await restore.click();
  await expect
    .poll(
      async () => {
        const body = (await (await page.request.get(`${nativeBase}${document.id}/`)).json()) as {
          description_html: string;
        };
        return body.description_html;
      },
      { timeout: 30000 }
    )
    .not.toContain("版本恢复测试内容");
  milestone("native page version restored");
  await page.goto(`/browser-lab/projects/${fixture.project}/issues/${fixture.issue}`);
  await expect(
    page
      .getByRole("region", { name: "关联文档", exact: true })
      .getByRole("link", { name: "浏览器实验记录", exact: true })
  ).toBeVisible();
  await page
    .getByRole("region", { name: "关联文档", exact: true })
    .getByRole("button", { name: "解除关联", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("region", { name: "关联文档", exact: true })).toContainText("尚未关联项目文档");
  expect((await page.request.get(`${nativeBase}${document.id}/`)).status()).toBe(200);
  await page
    .getByRole("region", { name: "关联文档", exact: true })
    .getByRole("button", { name: "关联已有文档", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("选择文档").selectOption(document.id);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "关联文档", exact: true })
      .getByRole("link", { name: "浏览器实验记录", exact: true })
  ).toBeVisible();

  milestone("document unlink and relink retained native page");
  const fixtureOutput = execFileSync(
    "docker",
    ["compose", "-p", "ooa-plane-e2e", "-f", "compose.lab.yml", "exec", "-T", "api", "python", "manage.py", "shell"],
    {
      input: `project_id = '${fixture.project}'\n${readFileSync("tools/lab/e2e/seed-documents-workflow.py", "utf8")}`,
      encoding: "utf8",
    }
  );
  const workflowFixture = JSON.parse(
    fixtureOutput
      .trim()
      .split("\n")
      .findLast((line) => line.startsWith("{"))!
  ) as { bounty: string; issue: string };
  await page.goto(`/browser-lab/lab/bounties?bounty_id=${workflowFixture.bounty}`);
  const bounty = page.locator(`#bounty-${workflowFixture.bounty}`);
  await expect(bounty).toBeVisible();
  await bounty.getByRole("button", { name: "查看流程图", exact: true }).click();
  const flow = bounty.getByRole("region", { name: "悬赏流程图", exact: true });
  await expect(flow.locator(".react-flow__nodes")).toBeVisible();
  await expect(flow.getByText("当前阶段", { exact: true })).toBeVisible();
  await expect(flow.getByRole("button", { name: "团队开工", exact: true })).toBeDisabled();
  await expect(flow.getByRole("button", { name: "独立验收", exact: true })).toHaveCount(0);
  await flow.getByRole("button", { name: "取消并释放未授予预算", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("处理意见").fill("浏览器验收取消并保留审计");
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect(bounty.getByText("已取消", { exact: true })).toBeVisible();
  await expect(flow.getByText("取消并释放预算", { exact: true })).toBeVisible();
  milestone("bounty projection and allowed action verified");
}
