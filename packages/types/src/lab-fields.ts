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
  state: string;
  priority: string;
  start_date: string | null;
  target_date: string | null;
  editable: boolean;
  can_delete_issue?: boolean;
  bounty_id?: string | null;
  values: Record<string, LabFieldValue>;
};
export type LabTaskTableData = { tasks: LabTaskRow[]; fields: LabCustomField[] };
