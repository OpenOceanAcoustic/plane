import { describe, expect, it, vi } from "vitest";
import { CoreService, safeTextHtml } from "./model";
import type { ApiClient } from "../../lib/client";

describe("mobile task property edits", () => {
  it("preserves the rich description while clearing dates and setting multiple owners", async () => {
    const request = vi.fn().mockResolvedValue({ id: "task" });
    const service = new CoreService({ request } as unknown as ApiClient, "laboratory", "project");
    await service.saveTask(
      { name: "实验", state_id: "active", priority: "high", start_date: "", target_date: "2026-10-15" },
      "task",
      ["owner-a", "owner-b"],
      ["label"]
    );
    expect(request).toHaveBeenCalledWith("/api/workspaces/laboratory/projects/project/issues/task/", "PATCH", {
      name: "实验",
      state_id: "active",
      priority: "high",
      start_date: null,
      target_date: "2026-10-15",
      assignee_ids: ["owner-a", "owner-b"],
      label_ids: ["label"],
    });
    expect(request.mock.calls[0]?.[2]).not.toHaveProperty("description_html");
  });

  it("uses the guarded task deletion seam with the submitted reason", async () => {
    const request = vi.fn().mockResolvedValue(null);
    await new CoreService({ request } as unknown as ApiClient, "laboratory", "project").deleteTask("task", "重复任务");
    expect(request).toHaveBeenCalledWith("/api/workspaces/laboratory/lab/tasks/task/", "DELETE", {
      reason: "重复任务",
    });
  });

  it("retains rich document nodes through description and comment edits", async () => {
    const request = vi.fn().mockResolvedValue(null);
    const service = new CoreService({ request } as unknown as ApiClient, "laboratory", "project");
    const html =
      '<table><tbody><tr><td><img data-asset-id="asset" src="/api/assets/asset/"></td></tr></tbody></table><span data-type="mention">成员</span>';
    await service.saveDescription("task", html);
    await service.comment("task", html, "comment");
    expect(request.mock.calls[0]?.[2]).toEqual({ description_html: html });
    expect(request.mock.calls[1]?.[2]).toEqual({ comment_html: html });
  });

  it("treats comment text as text rather than executable markup and preserves line breaks", () => {
    expect(safeTextHtml("<img src=x onerror=alert(1)>\nA&B")).toBe(
      "<p>&lt;img src=x onerror=alert(1)&gt;<br>A&amp;B</p>"
    );
  });
});
