/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
export type LabFieldKind = "text" | "number" | "single_select" | "multi_select" | "date" | "member" | "boolean" | "url";
export type LabFieldValue = string | number | boolean | string[] | null;
export type LabCustomField = {
  id: string;
  name: string;
  kind: LabFieldKind;
  options: string[];
  archived: boolean;
  enabled: boolean;
};
export type LabTaskRow = {
  id: string;
  title: string;
  key: string;
  project_id: string;
  project: string;
  parent_id?: string | null;
  assignees?: { id: string; name: string }[];
  is_mine?: boolean;
  state: string;
  priority: string;
  start_date: string | null;
  target_date: string | null;
  completed_at?: string | null;
  completed_date?: string | null;
  archived_at?: string | null;
  revision?: string;
  can_restore_issue?: boolean;
  editable: boolean;
  can_delete_issue?: boolean;
  bounty_id?: string | null;
  values: Record<string, LabFieldValue>;
};
export type LabTaskTableData = { tasks: LabTaskRow[]; fields: LabCustomField[]; can_archive?: boolean };
export type LabTaskArchiveFilters = {
  archived?: "0" | "1";
  completed_from?: string;
  completed_to?: string;
  archived_from?: string;
  archived_to?: string;
};
export type LabTaskArchivePreview = {
  cutoff: string;
  total: number;
  preview_token: string | null;
  tasks: { id: string; title: string; key: string; project: string; completed_date: string }[];
};
