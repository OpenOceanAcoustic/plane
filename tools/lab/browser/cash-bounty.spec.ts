/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(
  page: Page,
  { status = "open", selected = "target", missing = false, lead = false, failPayment = false } = {}
) {
  let currentStatus = status;
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test-csrf" } }));
  await page.route("**/api/workspaces/lab/lab/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/planner/"))
      return route.fulfill({
        json: {
          user_id: "member",
          projects: [{ id: "project", name: "测试项目", lead }],
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
      writes.push({ path, body: route.request().postDataJSON() });
      currentStatus = "claimed";
      return route.fulfill({ json: {} });
    }
    if (path.endsWith("/cash-bounties/target/accept/")) {
      writes.push({ path, body: route.request().postDataJSON() });
      currentStatus = "accepted";
      return route.fulfill({ json: {} });
    }
    if (path.endsWith("/cash-bounties/target/pay/")) {
      writes.push({ path, body: route.request().postDataJSON() });
      if (failPayment) return route.fulfill({ status: 400, json: { detail: "项目现金余额不足" } });
      currentStatus = "paid";
      return route.fulfill({ json: {} });
    }
    if (path.endsWith("/cash-bounties/") && route.request().method() === "POST") {
      writes.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({ status: 201, json: { id: "created" } });
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
                can_accept: lead && currentStatus === "submitted",
                can_pay: lead && currentStatus === "accepted",
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

test("publishing supplies specific scope steps deliverables and acceptance without inventing a price", async ({
  page,
}) => {
  const writes = await setup(page, { lead: true, selected: "" });
  await page.getByRole("button", { name: "发布现金悬赏", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "发布现金悬赏", exact: true });
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "填入人工测试模板" }).click();
  await expect(dialog.getByLabel("任务入口与范围")).toHaveValue(/\/lab\/lab\/cash/);
  await expect(dialog.getByLabel("操作步骤")).toHaveValue(/切换/);
  await expect(dialog.getByLabel("验收标准", { exact: true })).not.toHaveValue("");
  await expect(dialog.getByRole("button", { name: "发布", exact: true })).toBeDisabled();
  await dialog.getByLabel("现金赏金", { exact: true }).fill("5");
  await dialog.getByRole("button", { name: "发布", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({ title: "现金悬赏页面人工测试", amount: "5" });
  for (const key of ["target", "steps", "deliverable", "criteria"]) expect(writes[0].body[key]).toBeTruthy();
});

test("acceptance does not post a payment and payment registration needs its own proof", async ({ page }) => {
  const writes = await setup(page, { status: "submitted", lead: true });
  const card = page.getByRole("article", { name: "UI点击测试", exact: true });
  await card.getByRole("button", { name: "验收成果", exact: true }).click();
  const acceptance = page.getByRole("dialog", { name: "验收成果", exact: true });
  await acceptance.getByLabel("验收意见（可选）").fill("合成测试报告通过");
  await acceptance.getByRole("button", { name: "验收通过", exact: true }).click();
  await expect(card.getByRole("button", { name: "登记付款 ¥5.00" })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].path).toMatch(/accept\/$/);
  await card.getByRole("button", { name: "登记付款 ¥5.00" }).click();
  const payment = page.getByRole("dialog", { name: "登记线下付款", exact: true });
  await expect(payment).toContainText("不会发起银行卡、微信或支付宝转账");
  await payment.getByRole("button", { name: "确认登记付款" }).click();
  expect(writes).toHaveLength(1);
  await payment.getByLabel("付款凭证或测试记账说明").fill("流程测试记账，未实际转账");
  await payment.getByRole("button", { name: "确认登记付款" }).click();
  await expect(card).toContainText("已登记付款");
  expect(writes).toHaveLength(2);
  expect(writes[1].body.payment_evidence).toBe("流程测试记账，未实际转账");
});

test("failed payment registration keeps the entered proof and does not show paid", async ({ page }) => {
  await setup(page, { status: "accepted", lead: true, failPayment: true });
  const card = page.getByRole("article", { name: "UI点击测试", exact: true });
  await card.getByRole("button", { name: "登记付款 ¥5.00" }).click();
  const dialog = page.getByRole("dialog", { name: "登记线下付款", exact: true });
  await dialog.getByLabel("付款凭证或测试记账说明").fill("流程测试记账，未实际转账");
  await dialog.getByRole("button", { name: "确认登记付款" }).click();
  await expect(dialog.getByLabel("付款凭证或测试记账说明")).toHaveValue("流程测试记账，未实际转账");
  await expect(dialog.getByRole("alert")).toContainText("余额不足");
  await dialog.getByRole("button", { name: "关闭弹窗", exact: true }).click();
  await expect(card).not.toContainText("已登记付款");
});
