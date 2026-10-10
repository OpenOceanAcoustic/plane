/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import assert from "node:assert/strict";
import test from "node:test";
import type { LabContributionEntry } from "@plane/types";
import { LabStore } from "./lab.store";
import { LabContributionsStore } from "./lab-contributions.store";

const entry = (id: string): LabContributionEntry => ({
  id,
  created_at: "2026-10-02T02:00:00Z",
  day: "2026-10-02",
  project_id: "project-a",
  project: "项目 A",
  task_id: "task",
  task_title: "任务",
  bounty_id: "bounty",
  delta: "1.00",
  kind: "award",
  reverses: null,
  archived: false,
  can_open_issue: false,
  can_open_bounty: false,
});

test("a late month response cannot replace the newly selected month", async (context) => {
  const responses = new Map<string, (response: Response) => void>();
  context.mock.method(
    globalThis,
    "fetch",
    (url: string) => new Promise<Response>((resolve) => responses.set(url, resolve))
  );
  const store = new LabContributionsStore(new LabStore("", "lab"));
  const oldMonth = store.selectMonth("2026-09");
  const newMonth = store.selectMonth("2026-10");
  const complete = (month: string, net: string) => {
    responses.get(`/api/workspaces/lab/lab/me/contributions/calendar/?month=${month}`)!(
      Response.json({ month, timezone: "Asia/Shanghai", totals: { earned: net, reversed: "0.00", net }, days: [] })
    );
    responses.get(`/api/workspaces/lab/lab/me/contributions/entries/?month=${month}`)!(
      Response.json({ timezone: "Asia/Shanghai", results: [], next_cursor: null })
    );
  };
  complete("2026-10", "12.30");
  await newMonth;
  complete("2026-09", "6.00");
  await oldMonth;
  assert.equal(store.selectedMonth, "2026-10");
  assert.equal(store.calendar?.totals.net, "12.30");
});

test("project filtering does not change the all-time personal total", async (context) => {
  context.mock.method(globalThis, "fetch", (url: string) => {
    if (url.endsWith("/me/contributions/"))
      return Promise.resolve(
        Response.json({
          timezone: "Asia/Shanghai",
          totals: { earned: "40.00", reversed: "5.00", net: "35.00" },
          projects: [],
        })
      );
    if (url.includes("/calendar/"))
      return Promise.resolve(
        Response.json({
          month: "2026-10",
          timezone: "Asia/Shanghai",
          totals: { earned: "8.00", reversed: "0.00", net: "8.00" },
          days: [],
        })
      );
    return Promise.resolve(Response.json({ timezone: "Asia/Shanghai", results: [], next_cursor: null }));
  });
  const store = new LabContributionsStore(new LabStore("", "lab"));
  await store.loadSummary();
  await store.selectProject("project-a");
  assert.equal(store.summary?.totals.net, "35.00");
  assert.equal(store.calendar?.totals.net, "8.00");
});

test("selecting a day while the month loads preserves the day results", async (context) => {
  const responses = new Map<string, (response: Response) => void>();
  context.mock.method(
    globalThis,
    "fetch",
    (url: string) => new Promise<Response>((resolve) => responses.set(url, resolve))
  );
  const store = new LabContributionsStore(new LabStore("", "lab"));
  const month = store.selectMonth("2026-10");
  const day = store.selectDay("2026-10-02");
  responses.get("/api/workspaces/lab/lab/me/contributions/entries/?month=2026-10&day=2026-10-02")!(
    Response.json({ timezone: "Asia/Shanghai", results: [], next_cursor: "day-page" })
  );
  await day;
  responses.get("/api/workspaces/lab/lab/me/contributions/calendar/?month=2026-10")!(
    Response.json({
      month: "2026-10",
      timezone: "Asia/Shanghai",
      totals: { earned: "8.00", reversed: "0.00", net: "8.00" },
      days: [],
    })
  );
  responses.get("/api/workspaces/lab/lab/me/contributions/entries/?month=2026-10")!(
    Response.json({ timezone: "Asia/Shanghai", results: [], next_cursor: "month-page" })
  );
  await month;
  assert.equal(store.selectedDay, "2026-10-02");
  assert.equal(store.entries?.next_cursor, "day-page");
  assert.equal(store.calendar?.month, "2026-10");
});

test("a delayed next page cannot add old project records after filtering", async (context) => {
  let completePage!: (response: Response) => void;
  context.mock.method(globalThis, "fetch", (url: string) => {
    if (url.includes("cursor="))
      return new Promise<Response>((resolve) => {
        completePage = resolve;
      });
    if (url.includes("/calendar/"))
      return Promise.resolve(
        Response.json({
          month: "2026-10",
          timezone: "Asia/Shanghai",
          totals: { earned: "8.00", reversed: "0.00", net: "8.00" },
          days: [],
        })
      );
    const filtered = url.includes("project_id=");
    return Promise.resolve(
      Response.json({
        timezone: "Asia/Shanghai",
        results: [entry(filtered ? "filtered" : "first")],
        next_cursor: filtered ? null : "next",
      })
    );
  });
  const store = new LabContributionsStore(new LabStore("", "lab"));
  await store.selectMonth("2026-10");
  const nextPage = store.loadMore();
  await store.selectProject("project-a");
  completePage(Response.json({ timezone: "Asia/Shanghai", results: [entry("old-page")], next_cursor: null }));
  await nextPage;
  assert.deepEqual(
    store.entries?.results.map((row) => row.id),
    ["filtered"]
  );
});

test("a successful range does not hide a summary error and refresh retries it", async (context) => {
  let failed = true;
  context.mock.method(globalThis, "fetch", (url: string) => {
    if (url.endsWith("/me/contributions/"))
      return Promise.resolve(
        failed
          ? Response.json({ detail: "汇总暂不可用" }, { status: 503 })
          : Response.json({
              timezone: "Asia/Shanghai",
              totals: { earned: "40.00", reversed: "5.00", net: "35.00" },
              projects: [],
            })
      );
    if (url.includes("/calendar/"))
      return Promise.resolve(
        Response.json({
          month: "2026-10",
          timezone: "Asia/Shanghai",
          totals: { earned: "8.00", reversed: "0.00", net: "8.00" },
          days: [],
        })
      );
    return Promise.resolve(Response.json({ timezone: "Asia/Shanghai", results: [], next_cursor: null }));
  });
  const store = new LabContributionsStore(new LabStore("", "lab"));
  await store.refresh();
  assert.match(store.error, /汇总暂不可用/);
  assert.equal(Boolean(store.summary), false);
  assert.equal(store.calendar?.totals.net, "8.00");
  failed = false;
  await store.refresh();
  assert.equal(store.error, "");
  assert.equal(store.summary?.totals.net, "35.00");
});
