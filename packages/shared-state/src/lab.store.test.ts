/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import assert from "node:assert/strict";
import test from "node:test";
import type { LabPlanner } from "@plane/types";
import { LabStore } from "./lab.store";

const planner = (minutes: number): LabPlanner => ({
  user_id: "member",
  team_access: false,
  timezone: "Asia/Shanghai",
  week_start: 1,
  step_minutes: 15,
  folders: [],
  projects: [],
  items: [
    {
      id: "personal",
      title: "学习",
      status: "todo",
      kind: "study",
      public: false,
      folder_id: null,
      issue_id: null,
      project_name: null,
      issue_key: null,
      priority: null,
      target_date: null,
      schedule: { future_count: 1, next_start: null, next_end: null, week_minutes: minutes, total_count: 1 },
    },
  ],
});

test("a slow earlier refresh cannot replace the planning summary fetched after a save", async (context) => {
  const responses: ((response: Response) => void)[] = [];
  context.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => responses.push(resolve)));
  const store = new LabStore("", "lab");
  const oldRefresh = store.loadPlanner();
  const savedRefresh = store.loadPlanner();
  responses[1]!(new Response(JSON.stringify(planner(120)), { status: 200 }));
  await savedRefresh;
  assert.equal(store.planner?.items[0]?.schedule.week_minutes, 120);
  responses[0]!(new Response(JSON.stringify(planner(60)), { status: 200 }));
  await oldRefresh;
  assert.equal(store.planner?.items[0]?.schedule.week_minutes, 120);
});
