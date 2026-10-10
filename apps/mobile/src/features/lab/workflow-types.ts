/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { LabBounty } from "@plane/types";

export type LabWorkflowAction = {
  id: string;
  action: string;
  label: string;
  node_id: string;
  body: Record<string, string>;
  enabled: boolean;
  reason: string;
};
export type LabWorkflow = {
  bounty_id: string;
  title: string;
  status: string;
  major: boolean;
  current_node: string;
  nodes: { id: string; label: string; x: number; y: number; state: "current" | "completed" | "upcoming" }[];
  edges: { id: string; source: string; target: string }[];
  actions: LabWorkflowAction[];
  history: {
    id: string;
    label: string;
    node_id: string;
    actor: string;
    created_at: string;
    reason: string;
    result: string | null;
  }[];
};

export const acceptanceLabels: Record<string, string> = {
  pass: "通过",
  partial: "部分通过",
  negative: "有效探索负结果",
  rework: "返工",
  reject: "不通过",
};

/** Keep a submission key stable across retries of the same opened action. */
export function workflowActionBody(
  action: LabWorkflowAction,
  data: FormData,
  bounty: LabBounty,
  result: string,
  requestKey: string
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...action.body };
  switch (action.action) {
    case "claim":
      return { ...body, deliverable: data.get("deliverable"), planned: data.get("planned") };
    case "submit":
      return { ...body, evidence: data.get("evidence") };
    case "accept":
      return {
        ...body,
        request_key: requestKey,
        result,
        reason: data.get("reason"),
        targets: ["rework", "reject"].includes(result)
          ? {}
          : Object.fromEntries(
              bounty.allocations.filter((row) => row.approved).map((row) => [row.id, String(data.get(row.id))])
            ),
      };
    case "reverse":
      return { request_key: requestKey, reason: data.get("reason") };
    case "publication-review":
    case "acceptance-review":
    case "cancel":
    case "reopen":
      return { ...body, reason: data.get("reason") };
    default:
      return body;
  }
}
