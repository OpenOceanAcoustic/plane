/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { LabAnalytics } from "../../../packages/types/src/lab-analytics";

function data(): LabAnalytics {
  return {
    timezone: "Asia/Shanghai",
    range: { start: "2026-10-01", end: "2026-10-09" },
    team: false,
    can_view_team: false,
    projects: [
      { id: "A", name: "项目 A" },
      { id: "B", name: "项目 B" },
    ],
    members: [{ id: "member", name: "成员" }],
    charts: [
      {
        id: "project-completion",
        domain: "project",
        title: "项目完成率",
        kind: "bar",
        unit: "%",
        note: "",
        series: [{ key: "percentage", label: "完成率" }],
        columns: [
          { key: "label", label: "项目" },
          { key: "total", label: "任务数" },
        ],
        rows: [{ id: "A", label: "项目 A", percentage: 0, completed: 0, total: 100 }],
      },
      {
        id: "project-status",
        domain: "project",
        title: "任务状态分布",
        kind: "donut",
        unit: "项",
        note: "",
        series: [{ key: "count", label: "任务" }],
        columns: [
          { key: "label", label: "状态" },
          { key: "count", label: "任务数" },
        ],
        rows: [{ id: "todo", label: "待做", count: 100 }],
      },
    ],
  };
}

test("one hundred open tasks render a valid zero completion rate rather than an empty chart", async ({ page }) => {
  await page.route("**/api/workspaces/lab/lab/analytics/?*", (route) => route.fulfill({ json: data() }));
  await page.goto("/analytics");
  const chart = page.getByTestId("chart-project-completion");
  await expect(chart.getByText("所选范围暂无数据")).toHaveCount(0);
  await expect(chart.locator("[data-chart-canvas] svg").first()).toBeVisible();
  await chart.getByText(/数据与明细/).click();
  await expect(chart.getByRole("cell", { name: "100", exact: true })).toBeVisible();
});

test("changing filters hides old charts and a rejected scope cannot export previous data", async ({ page }) => {
  await page.route("**/api/workspaces/lab/lab/analytics/?*", async (route) => {
    const parameters = new URL(route.request().url()).searchParams;
    if (parameters.get("project_id") === "B") {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({ status: 403, json: { detail: "没有项目权限" } });
    } else await route.fulfill({ json: data() });
  });
  await page.goto("/analytics");
  await expect(page.getByTestId("chart-project-status")).toBeVisible();
  await page.getByRole("combobox", { name: "统计项目", exact: true }).click();
  await page.getByRole("option", { name: "项目 B", exact: true }).click();
  await expect(page.getByTestId("chart-project-status")).toHaveCount(0);
  await expect(page.getByRole("alert")).toContainText("没有项目权限");
  await expect(page.getByTestId("chart-project-status")).toHaveCount(0);
});

test("PNG export produces an actual locally rendered PNG", async ({ page }) => {
  await page.route("**/api/workspaces/lab/lab/analytics/?*", (route) => route.fulfill({ json: data() }));
  await page.goto("/analytics");
  const chart = page.getByTestId("chart-project-status");
  await expect(chart.locator("[data-chart-canvas] svg").first()).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await chart.getByRole("button", { name: "PNG", exact: true }).click();
  const download = await downloaded;
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(readFileSync(path!).subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

test("empty data has an empty state and disables image export", async ({ page }) => {
  const empty = data();
  empty.charts = empty.charts.map((chart) => ({
    ...chart,
    rows: chart.rows.map(
      (row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [key, typeof value === "number" ? 0 : value])
        ) as typeof row
    ),
  }));
  await page.route("**/api/workspaces/lab/lab/analytics/?*", (route) => route.fulfill({ json: empty }));
  await page.goto("/analytics");
  const chart = page.getByTestId("chart-project-status");
  await expect(chart.getByText("所选范围暂无数据", { exact: true })).toBeVisible();
  await expect(chart.getByRole("button", { name: "PNG", exact: true })).toBeDisabled();
});
