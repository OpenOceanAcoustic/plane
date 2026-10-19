/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
import type { LabManagementRecord } from "@plane/types";

export type QualityFilter = "all" | "missing" | "draft" | "submitted" | "approved" | "outdated";
export function qualityStatus(row: LabManagementRecord) {
  if (row.document_status === "unavailable") return "文档不可用";
  if (!row.document_current && ["approved", "submitted"].includes(row.state))
    return row.document_status === "updated" ? "内容已更新，待复审" : "文档已更新或不可用，待复审";
  return (
    ({ draft: "草稿", rejected: "需修改", submitted: "待评审", approved: "已通过" } as Record<string, string>)[
      row.state
    ] ?? row.state
  );
}
export function qualityMatches(row: LabManagementRecord, filter: QualityFilter) {
  if (filter === "all") return true;
  if (filter === "outdated") return !row.document_current && ["approved", "submitted"].includes(row.state);
  if (filter === "draft") return ["draft", "rejected"].includes(row.state);
  if (filter === "approved") return row.state === "approved" && !!row.document_current;
  if (filter === "submitted") return row.state === "submitted" && !!row.document_current;
  return false;
}
