/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import test from "node:test";
import type { LabBounty } from "@plane/types";
import { workflowActionBody } from "./workflow-types";
import type { LabWorkflowAction } from "./workflow-types";

const bounty = {
  allocations: [
    { id: "approved", approved: true },
    { id: "pending", approved: false },
  ],
} as LabBounty;

function action(name: string, body: Record<string, string> = {}): LabWorkflowAction {
  return { id: name, action: name, body, enabled: true, label: name, node_id: "acceptance", reason: "" };
}

test("acceptance includes approved participants only and retains the request key across retries", () => {
  const form = new FormData();
  form.set("reason", "复验增加贡献");
  form.set("approved", "7.50");
  form.set("pending", "99");
  const first = workflowActionBody(action("accept"), form, bounty, "partial", "stable-key");
  assert.deepEqual(first.targets, { approved: "7.50" });
  assert.equal(first.request_key, "stable-key");
  assert.deepEqual(workflowActionBody(action("accept"), form, bounty, "partial", "stable-key"), first);
});

test("rework and rejection never send stale contribution inputs", () => {
  const form = new FormData();
  form.set("approved", "10");
  form.set("reason", "重新实验");
  for (const result of ["rework", "reject"]) {
    assert.deepEqual(workflowActionBody(action("accept"), form, bounty, result, "key").targets, {});
  }
});

test("major review preserves its acceptance ID and reversal targets the ledger endpoint separately", () => {
  const form = new FormData();
  form.set("reason", "独立复核意见");
  assert.deepEqual(
    workflowActionBody(action("acceptance-review", { acceptance_id: "acceptance" }), form, bounty, "pass", "key"),
    { acceptance_id: "acceptance", reason: "独立复核意见" }
  );
  assert.deepEqual(workflowActionBody(action("reverse", { ledger_id: "ledger" }), form, bounty, "pass", "key"), {
    reason: "独立复核意见",
    request_key: "key",
  });
});
