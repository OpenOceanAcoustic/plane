/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(page: Page) {
  const writes: string[] = [];
  await page.route("**/api/workspaces/lab/lab/**", async (route) => {
    if (route.request().method() !== "GET") writes.push(route.request().url());
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/planner/"))
      return route.fulfill({
        json: {
          user_id: "member",
          projects: [],
          items: [],
          folders: [],
          categories: [],
          timezone: "Asia/Shanghai",
          step_minutes: 15,
          week_start: 1,
        },
      });
    if (path.endsWith("/bounties/"))
      return route.fulfill({
        json: [
          {
            id: "vc-bounty",
            title: "项目原型测试",
            project: "未来项目",
            project_id: "project",
            status: "open",
            allocations: [],
            budget: "20.00",
            awarded: "0.00",
            major: false,
            deliverable: "测试反馈",
            criteria: "反馈完整",
            reward_estimate: { amount: "50.00", formula_version: 2 },
            access_level: "public",
          },
        ],
      });
    return route.fulfill({ json: [] });
  });
  await page.goto("/vc-market");
  await page.getByRole("button", { name: "VC 计算示例", exact: true }).click();
  return writes;
}

test("VC market uses a labelled local example without changing project formulas or money", async ({ page }) => {
  const writes = await setup(page);
  const dialog = page.getByRole("dialog", { name: "VC 计算示例", exact: true });
  await expect(dialog.getByLabel("VC 示例计算结果")).toContainText("示例奖励：¥100.00");
  await expect(dialog.getByLabel("VC 示例计算结果")).toContainText("示例比例：1 VC ≈ ¥10.0000");
  await dialog.getByLabel("示例 VC 奖励池（元）").fill("1200");
  await dialog.getByLabel("示例阶段总 VC").fill("300");
  await dialog.getByLabel("示例本次 VC").fill("25");
  await expect(dialog.getByLabel("VC 示例计算结果")).toContainText("示例奖励：¥100.00");
  await expect(dialog.getByLabel("VC 示例计算结果")).toContainText("示例比例：1 VC ≈ ¥4.0000");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("button", { name: "发布 VC 悬赏", exact: true })).toBeVisible();
  const card = page.getByRole("button", { name: "查看 VC 悬赏 项目原型测试", exact: true });
  await expect(card).toContainText("VC 配额 20.00");
  await expect(card).toContainText("现金参考 ¥50.00");
  expect(writes).toHaveLength(0);
});

test("invalid VC inputs hide the calculation and show the relevant validation", async ({ page }) => {
  const writes = await setup(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("示例阶段总 VC").fill("0");
  await expect(dialog.getByText("阶段总 VC 必须大于 0", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("VC 示例计算结果")).toHaveCount(0);
  await dialog.getByLabel("示例阶段总 VC").fill("5");
  await expect(dialog.getByText("本次 VC 不能超过阶段总 VC", { exact: true })).toBeVisible();
  await dialog.getByLabel("示例本次 VC").fill("1");
  await dialog.getByLabel("示例 VC 奖励池（元）").fill("");
  await expect(dialog.getByText("请输入有效的奖励池金额", { exact: true })).toBeVisible();
  await dialog.getByLabel("示例 VC 奖励池（元）").fill("-1");
  await expect(dialog.getByText("奖励池金额不能为负数", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("VC 示例计算结果")).toHaveCount(0);
  expect(writes).toHaveLength(0);
});

test("VC examples round currency to cents with exact decimal arithmetic", async ({ page }) => {
  await setup(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("示例 VC 奖励池（元）").fill("0.05");
  await dialog.getByLabel("示例阶段总 VC").fill("0.02");
  await dialog.getByLabel("示例本次 VC").fill("0.01");
  await expect(dialog.getByLabel("VC 示例计算结果")).toContainText("示例奖励：¥0.03");
  await expect(dialog.getByLabel("VC 示例计算结果")).toContainText("示例比例：1 VC ≈ ¥2.5000");
});
