/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

async function setup(
  page: Page,
  { canRecord = true, scope = "project", existingStage = false, allocation = false } = {}
) {
  const writes: { path: string; body: Record<string, unknown> }[] = [];
  await page.route("**/auth/get-csrf-token/", (route) => route.fulfill({ json: { csrf_token: "test-csrf" } }));
  await page.route("**/api/workspaces/lab/lab/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST") {
      writes.push({ path, body: route.request().postDataJSON() });
      return route.fulfill({ json: { id: "project-receipt" } });
    }
    if (path.endsWith("/finance/overview/"))
      return route.fulfill({
        json: {
          manager_id: null,
          is_manager: false,
          allowed_actions: canRecord ? ["receipt", "stage-allocation"] : [],
          projects: [
            { id: "project-a", name: "当前项目", allowed_actions: canRecord ? ["receipt", "stage-allocation"] : [] },
            { id: "project-b", name: "其他项目", allowed_actions: ["receipt"] },
          ],
          members: [],
          accounts: allocation
            ? [
                {
                  id: "project-cash",
                  kind: "project",
                  project_id: "project-a",
                  can_manage: true,
                  available: "1000.00",
                  label: "项目资金",
                },
              ]
            : [],
          settlements: [],
          commitments: [],
          operations: [],
          stages: existingStage
            ? [
                {
                  stage_id: "old-stage",
                  project_id: "project-a",
                  name: "旧阶段",
                  can_manage: true,
                  can_record: true,
                  execution_funded: "0",
                },
              ]
            : [],
        },
      });
    return route.fulfill({ json: [] });
  });
  await page.goto(`/receipt-form?scope=${scope}&form=${allocation ? "allocation" : "receipt"}`);
  return writes;
}

test("a project without stages or reward budget can receive cash directly", async ({ page }) => {
  const writes = await setup(page);
  await expect(page.getByLabel("项目", { exact: true })).toHaveValue("project-a");
  await expect(page.getByLabel("阶段", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "设置阶段预算", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();
  await page.getByLabel("税金（元）").fill("20");
  await page.getByLabel("管理费用（元）").fill("10");
  await page.getByLabel("操作／核准依据").fill("项目收款依据");
  await page.getByLabel("凭证或证据引用").fill("银行凭证");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("入账已保存")).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].path).toMatch(/finance\/receipt\/$/);
  expect(writes[0].body).toMatchObject({
    project_id: "project-a",
    gross: "1000.00",
    costs: "30.00",
    D: "970.00",
    source: "自筹资金",
    evidence: "银行凭证",
  });
  expect(writes[0].body).not.toHaveProperty("stage_id");
});

test("all-project mode requires an explicit eligible project", async ({ page }) => {
  const writes = await setup(page, { scope: "all" });
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await page.getByLabel("项目", { exact: true }).selectOption("project-b");
  await page.getByLabel("操作／核准依据").fill("项目收款依据");
  await page.getByLabel("凭证或证据引用").fill("银行凭证");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("入账已保存")).toBeVisible();
  expect(writes[0].body.project_id).toBe("project-b");
});

test("existing stages do not force receipt allocation or leak another project", async ({ page }) => {
  const writes = await setup(page, { existingStage: true });
  await expect(page.getByLabel("项目", { exact: true }).locator("option")).toHaveCount(2);
  await expect(page.getByLabel("阶段", { exact: true })).toHaveCount(0);
  await page.getByLabel("操作／核准依据").fill("项目收款依据");
  await page.getByLabel("凭证或证据引用").fill("银行凭证");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("入账已保存")).toBeVisible();
  expect(writes[0].body).not.toHaveProperty("stage_id");
});

test("missing record permission disables receipt even when another project permits it", async ({ page }) => {
  const writes = await setup(page, { canRecord: false });
  await expect(page.getByLabel("项目", { exact: true }).locator("option")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test("deductions cannot exceed the actual receipt", async ({ page }) => {
  const writes = await setup(page);
  await page.getByLabel("税金（元）").fill("1001");
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  expect(writes).toHaveLength(0);
});

test("project cash can be explicitly allocated to an optional stage later", async ({ page }) => {
  const writes = await setup(page, { existingStage: true, allocation: true });
  await page.getByLabel("已冻结的新阶段").selectOption("old-stage");
  await page.getByLabel("拨付执行奖励（元）").fill("100");
  await page.getByLabel("操作／核准依据").fill("可选阶段奖励拨付");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("入账已保存")).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].path).toMatch(/finance\/stage-allocation\/$/);
  expect(writes[0].body).toMatchObject({ from_account_id: "project-cash", stage_id: "old-stage", amount: "100" });
});
