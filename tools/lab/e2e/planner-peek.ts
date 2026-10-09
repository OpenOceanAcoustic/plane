/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

export async function verifyPlannerNativePeek(page: Page, fixture: { project: string; issue: string }) {
  if (process.env.LAB_E2E_PROJECT !== "ooa-plane-e2e")
    throw new Error("Planner overview checks require isolated services");
  const source = `/api/workspaces/browser-lab/projects/${fixture.project}/issues/${fixture.issue}/`;
  const originalResponse = await page.request.get(source);
  expect(originalResponse.status()).toBe(200);
  const original = (await originalResponse.json()) as { priority: string };
  const issueLoaded = page.waitForResponse(
    (response) => new URL(response.url()).pathname === source && response.request().method() === "GET"
  );
  const card = page
    .getByRole("region", { name: "文件夹看板区域", exact: true })
    .locator("article")
    .filter({ hasText: "Original project task" });
  // Open the card's non-control area, matching normal card interaction.
  await card.locator(".lab-planner-card-meta").first().click();
  expect((await issueLoaded).status()).toBe(200);
  await expect(page).toHaveURL(/\/browser-lab\/lab\/planner$/);
  const overview = page.locator(`[data-issue-peek-overview="${fixture.issue}"]`);
  await expect(overview).toBeVisible();
  await expect(overview.getByText(/^(属性|Properties)$/, { exact: true })).toBeVisible();
  await expect(overview.getByText(/^(活动|Activity)$/, { exact: true })).toBeVisible();
  await expect(overview.getByText(/^(状态|State)$/, { exact: true })).toBeVisible();
  const viewport = page.viewportSize()!;
  const bounds = await overview.boundingBox();
  const surface = await page.locator("#full-screen-portal").boundingBox();
  expect(surface).not.toBeNull();
  expect(bounds!.x + bounds!.width).toBeGreaterThanOrEqual(surface!.x + surface!.width - 2);
  expect(bounds!.width).toBeGreaterThan(viewport.width * 0.35);
  const priorityRow = overview.getByText(/^(优先级|Priority)$/, { exact: true }).locator("../..");
  await priorityRow.getByRole("button").click();
  const changed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === source && response.request().method() === "PATCH"
  );
  await page.getByRole("option", { name: /^(高|High)$/, exact: true }).click();
  expect([200, 204]).toContain((await changed).status());
  await expect(priorityRow).toContainText(/高|High/);
  await expect
    .poll(async () => ((await (await page.request.get(source)).json()) as { priority: string }).priority)
    .toBe("high");
  await expect
    .poll(
      async () => {
        // Match the native IssueActivityService's property-only endpoint.
        const response = await page.request.get(`${source}history/?activity_type=issue-property`);
        expect(response.status()).toBe(200);
        const activities = (await response.json()) as {
          field: string;
          new_value: string;
        }[];
        expect(Array.isArray(activities)).toBe(true);
        return activities.some((event) => event.field === "priority" && event.new_value === "high");
      },
      { timeout: 30000 }
    )
    .toBe(true);
  await overview.locator("button").first().click();
  await expect(overview).toHaveCount(0);
  // Closing the native overview refreshes the planning projection.
  await expect(card).toContainText("高优先级");
  await page.reload();
  await card.getByRole("link", { name: "Original project task", exact: true }).click();
  await expect(overview).toContainText("set the priority to high");
  await overview.locator("button").first().click();
  const csrf = ((await (await page.request.get("/auth/get-csrf-token/")).json()) as { csrf_token: string }).csrf_token;
  const restored = await page.request.patch(source, {
    data: { priority: original.priority },
    headers: { "X-CSRFToken": csrf },
  });
  expect([200, 204]).toContain(restored.status());
}
