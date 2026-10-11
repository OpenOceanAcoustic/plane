/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from "@playwright/test";

for (const path of ["/finance-permissions", "/mobile-finance-permissions"]) {
  test(`${path}: grants separate operations and revokes all permissions`, async ({ page }) => {
    const submitted: unknown[] = [];
    let permissions = ["view"];
    await page.route("**/api/workspaces/lab/lab/finance/**", async (route) => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON() as { permissions: string[] };
        submitted.push(body);
        permissions = body.permissions;
      }
      await route.fulfill({
        json: {
          project_id: "project-1",
          members: [
            { id: "creator", name: "项目创建者", permissions: ["view", "record", "approve", "pay"], owner: true },
            { id: "member", name: "团队成员", permissions, owner: false },
          ],
        },
      });
    });
    await page.route("**/auth/get-csrf-token/", (route) =>
      route.fulfill({ json: { csrf_token: "browser-test-csrf" } })
    );
    await page.goto(path);
    await expect(page.getByRole("button", { name: "项目创建者 · 全部权限" })).toBeDisabled();
    await page.getByRole("button", { name: "团队成员" }).click();
    await page.getByRole("checkbox", { name: "登记付款" }).check();
    await expect(page.getByRole("checkbox", { name: "查看", exact: true })).toBeChecked();
    await expect(page.getByRole("checkbox", { name: "核准奖励" })).not.toBeChecked();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("授权已保存")).toBeVisible();
    expect(submitted[0]).toEqual({ project_id: "project-1", user_id: "member", permissions: ["view", "pay"] });
    await page.reload();
    await page.getByRole("button", { name: "团队成员" }).click();
    await page.getByRole("checkbox", { name: "查看", exact: true }).uncheck();
    await expect(page.getByRole("checkbox", { name: "登记付款" })).not.toBeChecked();
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page.getByText("授权已保存")).toBeVisible();
    expect(submitted[1]).toEqual({ project_id: "project-1", user_id: "member", permissions: [] });
  });
}
