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

test("a late detail response cannot restore a bounty after its deletion succeeds", async (context) => {
  let finishDetail!: (response: Response) => void;
  context.mock.method(globalThis, "fetch", (url: string, options?: RequestInit) => {
    if (url.endsWith("/auth/get-csrf-token/")) return Promise.resolve(Response.json({ csrf_token: "test" }));
    if (options?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
    return new Promise<Response>((resolve) => {
      finishDetail = resolve;
    });
  });
  const store = new LabStore("", "lab");
  const detail = store.loadBountyDetail("published");
  await store.request("bounties/published/detail/", "DELETE", { reason: "误发布" });
  finishDetail(Response.json({ id: "published", status: "open" }));
  await detail;
  assert.equal(store.bounties.length, 0);
});

test("a stale market refresh cannot restore a deleted bounty or its pending action", async (context) => {
  const pending = new Map<string, (response: Response) => void>();
  context.mock.method(globalThis, "fetch", (url: string, options?: RequestInit) => {
    if (url.endsWith("/auth/get-csrf-token/")) return Promise.resolve(Response.json({ csrf_token: "test" }));
    if (options?.method === "DELETE") return Promise.resolve(new Response(null, { status: 204 }));
    return new Promise<Response>((resolve) => {
      pending.set(url, resolve);
    });
  });
  const store = new LabStore("", "lab");
  const refresh = store.loadMarket();
  await store.request("bounties/published/detail/", "DELETE", { reason: "误发布" });
  pending.get("/api/workspaces/lab/lab/stages/")!(Response.json([]));
  pending.get("/api/workspaces/lab/lab/bounties/")!(Response.json([{ id: "published", status: "open" }]));
  pending.get("/api/workspaces/lab/lab/inbox/")!(Response.json([{ id: "published", action: "claim" }]));
  await refresh;
  assert.equal(store.bounties.length, 0);
  assert.equal(store.todos.length, 0);
});

test("a denied deletion preserves the visible bounty and pending action", async (context) => {
  context.mock.method(globalThis, "fetch", (url: string, options?: RequestInit) => {
    if (url.endsWith("/auth/get-csrf-token/")) return Promise.resolve(Response.json({ csrf_token: "test" }));
    if (options?.method === "DELETE")
      return Promise.resolve(Response.json({ detail: "仅项目负责人可以执行" }, { status: 403 }));
    if (url.endsWith("/bounties/")) return Promise.resolve(Response.json([{ id: "published", status: "open" }]));
    if (url.endsWith("/inbox/")) return Promise.resolve(Response.json([{ id: "published", action: "claim" }]));
    return Promise.resolve(Response.json([]));
  });
  const store = new LabStore("", "lab");
  await store.loadMarket();
  await assert.rejects(store.request("bounties/published/detail/", "DELETE", { reason: "误发布" }), /仅项目负责人/);
  await store.loadMarket();
  assert.equal(store.bounties.length, 1);
  assert.equal(store.todos.length, 1);
});

test("a slow earlier market refresh cannot overwrite the stage balance after deletion", async (context) => {
  const responses: ((response: Response) => void)[] = [];
  context.mock.method(globalThis, "fetch", () => new Promise<Response>((resolve) => responses.push(resolve)));
  const store = new LabStore("", "lab");
  const beforeDelete = store.loadMarket();
  const afterDelete = store.loadMarket();
  responses[3]!(Response.json([{ id: "stage", reserved: "0.00" }]));
  responses[4]!(Response.json([]));
  responses[5]!(Response.json([]));
  await afterDelete;
  responses[0]!(Response.json([{ id: "stage", reserved: "20.00" }]));
  responses[1]!(Response.json([]));
  responses[2]!(Response.json([]));
  await beforeDelete;
  assert.equal(store.stages[0]?.reserved, "0.00");
});
