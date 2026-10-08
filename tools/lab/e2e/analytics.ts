/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

type Row = { id: string; [key: string]: string | number | null };
type Chart = { id: string; rows: Row[] };
type Statistics = { charts: Chart[] };

/** Exercises chart data through real domain records and the authenticated public UI. */
export async function verifyAnalytics(page: Page, fixture: { project: string }): Promise<void> {
  if (process.env.LAB_E2E_PROJECT !== "ooa-plane-e2e")
    throw new Error("Analytics browser tests require the isolated ooa-plane-e2e project");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(fixture.project))
    throw new Error("Invalid isolated project fixture ID");
  const output = execFileSync(
    "docker",
    ["compose", "-p", "ooa-plane-e2e", "-f", "compose.lab.yml", "exec", "-T", "api", "python", "manage.py", "shell"],
    {
      input: `project_id = '${fixture.project}'\n${readFileSync("tools/lab/e2e/seed-analytics.py", "utf8")}`,
      encoding: "utf8",
    }
  );
  const seed = JSON.parse(
    output
      .trim()
      .split("\n")
      .findLast((line) => line.startsWith("{"))!
  ) as {
    stage: string;
    bounty: string;
    issue: string;
    participant: string;
    project_name: string;
    today: string;
    tomorrow: string;
  };
  const base = "/api/workspaces/browser-lab/lab/";
  const query = new URLSearchParams({ start: seed.today, end: seed.tomorrow, project_id: fixture.project, team: "1" });
  const response = await page.request.get(`${base}analytics/?${query}`);
  expect(response.status()).toBe(200);
  const raw = await response.text();
  expect(raw).not.toContain("NEVER_EXPOSE_PRIVATE");
  const data = JSON.parse(raw) as Statistics;
  expect(data.charts).toHaveLength(12);
  const chart = (id: string) => data.charts.find((entry) => entry.id === id)!;
  const budget = chart("vc-budget").rows.find((row) => row.id === seed.stage)!;
  expect(budget.budget).toBe(100);
  expect(budget.awarded).toBe(10);
  expect(Number(budget.available) + Number(budget.reserved) + Number(budget.awarded)).toBe(100);
  const participant = chart("vc-participants").rows.find((row) => row.id === seed.participant)!;
  expect(participant.planned).toBe(20);
  expect(participant.awarded).toBe(10);
  const ledgerResponse = await page.request.get(`${base}ledger/?project_id=${fixture.project}`);
  expect(ledgerResponse.status()).toBe(200);
  const ledger = ((await ledgerResponse.json()) as { bounty_id: string; delta: string }[]).filter(
    (entry) => entry.bounty_id === seed.bounty
  );
  expect(ledger).toHaveLength(3);
  expect(ledger.reduce((sum, entry) => sum + Number(entry.delta), 0)).toBe(participant.awarded);
  expect(chart("vc-trend").rows.reduce((sum, row) => sum + Number(row.awarded), 0)).toBe(20);
  expect(chart("vc-trend").rows.reduce((sum, row) => sum + Number(row.reversed), 0)).toBe(10);
  expect(Object.fromEntries(chart("vc-acceptance").rows.map((row) => [row.id, row.count]))).toEqual({
    partial: 1,
    negative: 1,
  });
  const hours = chart("schedule-hours").rows.find((row) => row.user_id === seed.participant)!;
  expect(hours.hours).toBe(4);
  const privateQuery = new URLSearchParams(query);
  privateQuery.set("user_id", seed.participant);
  const privateResponse = await page.request.get(`${base}analytics/?${privateQuery}`);
  expect(privateResponse.status()).toBe(200);
  const privateData = (await privateResponse.json()) as Statistics;
  const overlap = privateData.charts.find((entry) => entry.id === "schedule-overlap")!.rows[0]!;
  expect(overlap.overlap_hours).toBe(1);
  expect(overlap.busy_hours).toBe(3);
  const drillQuery = new URLSearchParams(privateQuery);
  drillQuery.set("chart", "schedule-hours");
  drillQuery.set("key", hours.id);
  const privateDetails = await page.request.get(`${base}analytics/drilldown/?${drillQuery}`);
  expect(privateDetails.status()).toBe(200);
  expect(await privateDetails.text()).not.toContain("NEVER_EXPOSE_PRIVATE");
  expect(((await privateDetails.json()) as { records: { title: string; url: string | null }[] }).records).toEqual([
    expect.objectContaining({ title: "忙碌", url: null }),
    expect.objectContaining({ title: "忙碌", url: null }),
  ]);

  await page.goto("/browser-lab/lab/analytics");
  const overview = page.getByRole("region", { name: "实验室数据总览", exact: true });
  await expect(overview.getByTestId("chart-vc-participants")).toContainText("选择项目查看贡献统计");
  const filtered = page.waitForResponse(
    (entry) => {
      const url = new URL(entry.url());
      return url.pathname === `${base}analytics/` && url.searchParams.get("project_id") === fixture.project;
    },
    { timeout: 30000 }
  );
  await overview.getByRole("combobox", { name: "统计项目", exact: true }).click();
  await page.getByRole("option", { name: seed.project_name, exact: true }).click();
  expect((await filtered).status()).toBe(200);
  await expect(overview.locator('[data-testid^="chart-"]')).toHaveCount(12);
  await Promise.all(
    data.charts.map((entry) =>
      expect(overview.getByTestId(`chart-${entry.id}`).locator("[data-chart-canvas] svg").first()).toBeVisible()
    )
  );
  for (const domain of ["项目", "排期", "VC"]) {
    // Each button changes the same mounted grid; finish that render before choosing the next domain.
    // oxlint-disable-next-line no-await-in-loop
    await overview.getByRole("button", { name: domain, exact: true }).click();
    // oxlint-disable-next-line no-await-in-loop
    await expect(overview.locator('[data-testid^="chart-"]')).toHaveCount(4);
  }
  await overview.getByRole("button", { name: "全部图表", exact: true }).click();
  const participants = overview.getByTestId("chart-vc-participants");
  await participants.locator("summary").click();
  const row = participants.getByRole("row").filter({ hasText: "浏览器贡献成员" });
  await expect(row).toContainText("20");
  await expect(row).toContainText("10");
  await row.getByRole("button", { name: "查看明细", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("浏览器统计悬赏");
  await expect(dialog).toContainText("冲正");
  const detailDownload = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "导出明细 CSV", exact: true }).click();
  const detailPath = await (await detailDownload).path();
  expect(detailPath).not.toBeNull();
  expect(readFileSync(detailPath!, "utf8")).toContain("浏览器统计悬赏");
  if (await dialog.isVisible()) await dialog.getByRole("button", { name: "取消", exact: true }).click();
  const budgetCard = overview.getByTestId("chart-vc-budget");
  const csvDownload = page.waitForEvent("download");
  await budgetCard.getByRole("button", { name: "CSV", exact: true }).click();
  const csvPath = await (await csvDownload).path();
  expect(csvPath).not.toBeNull();
  const csv = readFileSync(csvPath!, "utf8");
  expect(csv).toContain("浏览器统计预算");
  expect(csv).toContain("100");
  expect(csv).not.toContain("NEVER_EXPOSE_PRIVATE");
  const jsonDownload = page.waitForEvent("download");
  await budgetCard.getByRole("button", { name: "JSON", exact: true }).click();
  const jsonPath = await (await jsonDownload).path();
  expect(jsonPath).not.toBeNull();
  const exported = JSON.parse(readFileSync(jsonPath!, "utf8")) as Chart;
  expect(exported.id).toBe("vc-budget");
  expect(exported.rows.find((entry) => entry.id === seed.stage)).toMatchObject(budget);
  const pngDownload = page.waitForEvent("download");
  await budgetCard.getByRole("button", { name: "PNG", exact: true }).click();
  const pngPath = await (await pngDownload).path();
  expect(pngPath).not.toBeNull();
  const png = readFileSync(pngPath!);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.length).toBeGreaterThan(1000);
  expect(await overview.getByRole("alert").count()).toBe(0);
}
