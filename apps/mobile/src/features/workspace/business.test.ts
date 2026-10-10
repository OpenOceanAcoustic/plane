import { expect, test } from "vitest";
import { WorkspaceService, viewQuery, activeCycle } from "./business";
import type { ApiClient } from "../../lib/client";

test("publishing a draft reads the latest draft and keeps its project relations and rich description", async () => {
  const calls: { path: string; method: string; body: unknown }[] = [];
  const client = {
    request: async (path: string, method = "GET", body?: unknown) => {
      calls.push({ path, method, body });
      if (method === "GET")
        return {
          id: "draft-1",
          name: "海试准备",
          project_id: "project-1",
          description_html: "<p>校准</p>",
          priority: "high",
          state_id: "state-1",
          assignee_ids: ["u1"],
          label_ids: ["l1"],
          cycle_id: "c1",
          module_ids: ["m1"],
          created_by: "private-id",
        };
      return { id: "task-1", project_id: "project-1" };
    },
  } as unknown as ApiClient;
  const task = await new WorkspaceService(client, "lab space").publishDraft("draft-1");
  expect(task.id).toBe("task-1");
  expect(calls.map((c) => c.method)).toEqual(["GET", "POST"]);
  expect(calls[1]?.path).toBe("/api/workspaces/lab%20space/draft-to-issue/draft-1/");
  expect(calls[1]?.body).toMatchObject({
    name: "海试准备",
    description_html: "<p>校准</p>",
    assignee_ids: ["u1"],
    label_ids: ["l1"],
    cycle_id: "c1",
    module_ids: ["m1"],
  });
  expect(calls[1]?.body).not.toHaveProperty("created_by");
});
test("workspace views convert stored filters to server query without dropping pagination", () => {
  const query = new URLSearchParams(
    viewQuery({ project: ["p1", "p2"], priority: ["high"], state_group: ["started"], assignees: [] }, "next:1")
  );
  expect(query.get("project")).toBe("p1,p2");
  expect(query.get("priority")).toBe("high");
  expect(query.get("cursor")).toBe("next:1");
  expect(query.has("assignees")).toBe(false);
});
test("active cycles honor server status and fallback to date boundaries", () => {
  expect(activeCycle({ status: "current", start_date: "2026-10-01", end_date: "2026-10-31" }, "2026-10-10")).toBe(true);
  expect(activeCycle({ start_date: "2026-10-10T00:00:00Z", end_date: "2026-10-10T23:59:59Z" }, "2026-10-10")).toBe(
    true
  );
  expect(activeCycle({ start_date: "2026-10-11", end_date: "2026-11-01" }, "2026-10-10")).toBe(false);
});
