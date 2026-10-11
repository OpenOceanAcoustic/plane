/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function compose(args: string[], input?: string): string {
  const directory = process.env.LAB_E2E_DIRECTORY;
  if (process.env.LAB_E2E_PROJECT !== "ooa-plane-e2e" || !directory)
    throw new Error("Work item detail checks require isolated services and private configuration");
  return execFileSync(
    "docker",
    [
      "compose",
      "-p",
      "ooa-plane-e2e",
      "--env-file",
      resolve(directory, "root.env"),
      "-f",
      "compose.lab.yml",
      "-f",
      "compose.lab-e2e.yml",
      ...args,
    ],
    { encoding: "utf8", input }
  );
}
function code(uri: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("Test enrollment is missing its secret");
  const bits = Array.from(secret, (character) => alphabet.indexOf(character).toString(2).padStart(5, "0")).join("");
  const bytes = Buffer.from(
    Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
      Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)
    )
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  return String((digest.readUInt32BE(digest[19]! & 15) & 0x7fffffff) % 1000000).padStart(6, "0");
}

test("personal planning native work item details match the project page including VC quota", async ({ page }) => {
  const exists = compose([
    "exec",
    "-T",
    "api",
    "python",
    "manage.py",
    "shell",
    "-c",
    "from plane.db.models import User; print(User.objects.filter(username='e2e-detail-admin').exists())",
  ])
    .trim()
    .endsWith("True");
  const args = exists ? ["reset", "--username", "e2e-detail-admin"] : ["bootstrap", "--workspace", "browser-peek-lab"];
  const invitation = compose(["exec", "-T", "api", "python", "manage.py", "lab_access", ...args])
    .trim()
    .split("\n")
    .at(-1)!;
  try {
    await page.goto(invitation);
  } catch {
    throw new Error("Could not open the isolated registration page");
  }
  await page.getByLabel("用户名", { exact: true }).fill("e2e-detail-admin");
  await page.getByLabel("显示姓名", { exact: true }).fill("工作项详情验收");
  await page.getByLabel("联系邮箱", { exact: true }).fill("detail-admin@example.org");
  await page.getByRole("button", { name: "开始绑定", exact: true }).click();
  await page.getByText("无法扫码？查看本地绑定地址", { exact: true }).click();
  const uri = (await page.locator("details p").textContent())!;
  await page.getByLabel("六位动态码", { exact: true }).fill(code(uri));
  await page.getByRole("button", { name: "确认绑定", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await expect(page.getByLabel("用户名", { exact: true })).toBeVisible();
  expect((await page.request.get(invitation)).status()).toBe(404);
  const seeded = compose(
    ["exec", "-T", "api", "python", "manage.py", "shell"],
    readFileSync("tools/lab/e2e/seed-peek-details.py", "utf8")
  );
  const fixture = JSON.parse(
    seeded
      .trim()
      .split("\n")
      .findLast((line) => line.startsWith("{"))!
  ) as { project: string; ordinary: string; issue: string; bounty: string; field: string };
  await page.waitForTimeout(30000 - (Date.now() % 30000) + 300);
  await page.goto("/");
  await page.getByLabel("用户名", { exact: true }).fill("e2e-detail-admin");
  await page.getByLabel("六位动态码", { exact: true }).fill(code(uri));
  const home = page.waitForURL(/\/browser-peek-lab(?:\/|$)/, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await home;
  const base = "/api/workspaces/browser-peek-lab/lab/";
  const plannerBefore = (await (await page.request.get(`${base}planner/`)).json()) as {
    items: { issue_id: string | null }[];
  };
  expect(plannerBefore.items.some((item) => item.issue_id === fixture.ordinary)).toBe(false);
  const csrf = ((await (await page.request.get("/auth/get-csrf-token/")).json()) as { csrf_token: string }).csrf_token;
  const referenced = await page.request.post(`${base}items/`, {
    data: { issue_id: fixture.ordinary },
    headers: { "X-CSRFToken": csrf },
  });
  expect(referenced.status()).toBe(201);
  const plannerAfter = (await (await page.request.get(`${base}planner/`)).json()) as {
    items: { issue_id: string | null }[];
  };
  expect(plannerAfter.items.filter((item) => item.issue_id === fixture.ordinary)).toHaveLength(1);
  const errors: string[] = [];
  page.on("pageerror", (error) => {
    if (!/^Minified React error #(418|423);/.test(error.message)) errors.push(error.message);
  });
  const source = `/api/workspaces/browser-peek-lab/projects/${fixture.project}/issues/${fixture.issue}/`;
  const assertContent = async (surface = page.locator("body")) => {
    await expect(surface.getByText("悬赏工作项的完整原生说明", { exact: true })).toBeVisible();
    await expect(surface.getByLabel("实测实验参数", { exact: true })).toHaveValue("相同原始参数 42");
    await expect(surface.getByRole("region", { name: "关联文档", exact: true })).toContainText(
      "Bounty native detail关联实验记录"
    );
    await expect(surface.getByRole("region", { name: "悬赏", exact: true })).toContainText("12.50 VC");
    await expect(surface.getByText(/^(属性|Properties)$/, { exact: true })).toBeVisible();
    await expect(surface.getByText(/^(活动|Activity)$/, { exact: true })).toBeVisible();
  };
  await page.goto(`/browser-peek-lab/projects/${fixture.project}/issues/${fixture.issue}`);
  await assertContent();
  await page.goto("/browser-peek-lab/lab/planner");
  const card = page
    .getByRole("region", { name: "文件夹看板区域", exact: true })
    .locator("article")
    .filter({ has: page.locator(`a[href="/browser-peek-lab/projects/${fixture.project}/issues/${fixture.issue}"]`) });
  await card.getByRole("link", { name: "Bounty native detail", exact: true }).click();
  const overview = page.locator(`[data-issue-peek-overview="${fixture.issue}"]`);
  await expect(overview).toBeVisible();
  await assertContent(overview);
  await expect(page).toHaveURL(/\/browser-peek-lab\/lab\/planner$/);
  const changed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(`/tasks/${fixture.issue}/field-values/`) &&
      response.request().method() === "PATCH"
  );
  const field = overview.getByLabel("实测实验参数", { exact: true });
  await field.fill("规划中更新参数 84");
  await field.press("Tab");
  expect((await changed).status()).toBe(200);
  await overview.locator("button").first().click();
  await page.goto(`/browser-peek-lab/projects/${fixture.project}/issues/${fixture.issue}`);
  await expect(page.getByLabel("实测实验参数", { exact: true })).toHaveValue("规划中更新参数 84");
  const native = await page.request.get(source);
  expect(native.status()).toBe(200);
  expect(((await native.json()) as { description_html: string }).description_html).toContain(
    "悬赏工作项的完整原生说明"
  );
  await page.goto(`/browser-peek-lab/projects/${fixture.project}/issues/${fixture.ordinary}`);
  await expect(page.getByText("同一工作项的完整原生说明", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "悬赏", exact: true })).toHaveCount(0);
  await page.goto("/browser-peek-lab/lab/planner");
  const ordinaryCard = page
    .getByRole("region", { name: "文件夹看板区域", exact: true })
    .locator("article")
    .filter({
      has: page.locator(`a[href="/browser-peek-lab/projects/${fixture.project}/issues/${fixture.ordinary}"]`),
    });
  await ordinaryCard.getByRole("link", { name: "Ordinary native detail", exact: true }).click();
  const ordinaryPeek = page.locator(`[data-issue-peek-overview="${fixture.ordinary}"]`);
  await expect(ordinaryPeek.getByText("同一工作项的完整原生说明", { exact: true })).toBeVisible();
  await expect(ordinaryPeek.getByLabel("实测实验参数", { exact: true })).toHaveValue("相同原始参数 42");
  await expect(ordinaryPeek.getByRole("region", { name: "关联文档", exact: true })).toContainText(
    "Ordinary native detail关联实验记录"
  );
  await expect(ordinaryPeek.getByRole("region", { name: "悬赏", exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});
