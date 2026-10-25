/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(page: Page, { status = "open", selected = "target", missing = false } = {}) {
  let currentStatus = status;
  const writes: string[] = [];
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test-csrf" } }));
  await page.route("**/api/workspaces/lab/lab/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/planner/"))
      return route.fulfill({
        json: {
          user_id: "member",
          projects: [{ id: "project", name: "测试项目", lead: false }],
          folders: [],
          items: [],
          categories: [],
          timezone: "Asia/Shanghai",
          week_start: 1,
          step_minutes: 15,
        },
      });
    if (path.endsWith("/finance/overview/")) return route.fulfill({ json: { accounts: [] } });
    if (path.endsWith("/cash-bounties/target/claim/")) {
      writes.push(path);
      currentStatus = "claimed";
      return route.fulfill({ json: {} });
    }
    if (path.endsWith("/cash-bounties/"))
      return route.fulfill({
        json: missing
          ? []
          : [
              {
                id: "target",
                project_id: "project",
                project: "测试项目",
                title: "UI点击测试",
                amount: "5.00",
                status: currentStatus,
                publisher: { id: "lead", name: "负责人" },
                reviewer: { id: "lead", name: "负责人" },
                claimed_by: currentStatus === "claimed" ? { id: "member", name: "成员" } : null,
                deliverable: "提交复现步骤和截图",
                criteria: "覆盖成功、失败和移动端状态",
                can_claim: currentStatus === "open",
                can_submit: currentStatus === "claimed",
              },
              {
                id: "another",
                project_id: "project",
                project: "测试项目",
                title: "其他开放任务",
                amount: "7.00",
                status: "open",
                deliverable: "其他交付",
                criteria: "",
                can_claim: true,
              },
            ],
      });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/cash-bounties${selected ? `?bounty_id=${selected}` : ""}`);
  return writes;
}

test("a cash bounty deep link shows the exact task and keeps it visible after claiming", async ({ page }) => {
  const writes = await setup(page);
  const card = page.getByRole("article", { name: "UI点击测试", exact: true });
  await expect(card).toContainText("¥5.00");
  await expect(card).toContainText("提交复现步骤和截图");
  await expect(card).toContainText("覆盖成功、失败和移动端状态");
  await expect(page.getByRole("article", { name: "其他开放任务" })).toHaveCount(0);
  expect(writes).toEqual([]);
  await card.getByRole("button", { name: "我要接" }).click();
  await expect(card.getByRole("button", { name: "提交成果" })).toBeVisible();
  expect(writes).toHaveLength(1);
  await page.getByRole("button", { name: "查看全部现金悬赏" }).click();
  await expect(page.getByRole("article", { name: "其他开放任务" })).toBeVisible();
});

for (const status of ["claimed", "submitted", "accepted", "paid", "cancelled", "proposed"]) {
  test(`a deep link remains visible for a ${status} task outside the default open filter`, async ({ page }) => {
    await setup(page, { status });
    await expect(page.getByRole("article", { name: "UI点击测试", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "我要接" })).toHaveCount(0);
  });
}

test("an unavailable target has an explicit error and can return to the full list", async ({ page }) => {
  await setup(page, { selected: "missing" });
  await expect(page.getByRole("alert")).toHaveText("悬赏不存在或你暂无查看权限。");
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("button", { name: "查看全部现金悬赏" }).click();
  await expect(page.getByRole("article", { name: "UI点击测试" })).toBeVisible();
});
