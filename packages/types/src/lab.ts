/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type LabStatus = "todo" | "active" | "review" | "done";
export type LabAcceptanceResult = "pass" | "partial" | "rework" | "reject" | "negative";
export type LabBountyStatus =
  | "draft"
  | "publication_review"
  | "open"
  | "active"
  | "review"
  | "acceptance_review"
  | "partial"
  | "rework"
  | "rejected"
  | "done"
  | "cancelled";
export type LabFolder = { id: string; name: string; position: number };
export type LabItem = {
  id: string;
  title: string;
  description?: string;
  status: LabStatus;
  kind: string;
  public: boolean;
  folder_id: string | null;
  issue_id: string | null;
  project_id?: string;
  archived?: boolean;
};
export type LabProject = {
  id: string;
  name: string;
  lead: boolean;
  members: LabMember[];
  states: { id: string; name: string; group: string }[];
  mapping: Record<LabStatus, string | null>;
};
export type LabPlanner = {
  user_id: string;
  team_access: boolean;
  folders: LabFolder[];
  items: LabItem[];
  projects: LabProject[];
  timezone: string;
  week_start: number;
  step_minutes: number;
};
export type LabEvent = {
  id: string;
  title: string;
  user_id: string;
  start: string;
  end: string;
  editable: boolean;
  item_id?: string;
  issue_id?: string;
  project_id?: string;
};
export type LabMember = { id: string; name: string };
export type LabStage = {
  id: string;
  project_id: string;
  project: string;
  name: string;
  budget: string;
  reserved: string;
  frozen_at: string;
};
export type LabAllocation = {
  id: string;
  user_id: string;
  name: string;
  deliverable: string;
  planned: string;
  awarded: string;
  approved: boolean;
  confirmed: boolean;
  closed: boolean;
};
export type LabAcceptance = {
  id: string;
  result: LabAcceptanceResult;
  reason: string;
  targets: Record<string, string>;
  reviewer: string;
  approved_at: string | null;
};
export type LabBounty = {
  id: string;
  stage_id: string;
  project_id: string;
  project: string;
  issue_id: string | null;
  title: string;
  deliverable: string;
  criteria: string;
  budget: string;
  reserved: string;
  awarded: string;
  status: LabBountyStatus;
  major: boolean;
  major_reasons: string[];
  evidence: string;
  due_at: string | null;
  overdue: boolean;
  is_lead: boolean;
  is_reviewer: boolean;
  is_independent_reviewer: boolean;
  allocations: LabAllocation[];
  acceptances: LabAcceptance[];
};
export type LabTask = { id: string; title: string; project_id: string; project: string; key: string };
export type LabTodo = { id: string; title: string; action: string; due_at: string | null; overdue: boolean };
