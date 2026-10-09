/**
 * Copyright (c) 2026 OpenOceanAcoustic and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export type LabStatus = "todo" | "active" | "review" | "done";
export type LabBountyBudget = {
  project_id: string;
  project: string;
  stage_id: string | null;
  stage_name: string | null;
  budget: string | null;
  reserved: string | null;
  available: string | null;
  configured: boolean;
};
export type LabAcceptanceResult = "pass" | "partial" | "rework" | "reject" | "negative";
export type LabLedgerEntry = {
  id: string;
  created_at: string;
  delta: string;
  bounty_id: string;
  allocation_id: string;
  task: { id?: string; title: string; project: string; project_id?: string };
  participant: { id?: string; name: string };
  actor: string;
  reason: string;
  reverses: string | null;
  can_reverse: boolean;
};
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
  | "cancelled"
  | "deleted";
export type LabFolder = { id: string; name: string; position: number };
export type LabCategory = { id: string; name: string; color: string; position: number };
export type LabItemSchedule = {
  future_count: number;
  next_start: string | null;
  next_end: string | null;
  week_minutes: number;
  total_count: number;
};
export type LabItem = {
  id: string;
  title: string;
  description?: string;
  status: LabStatus;
  kind: string;
  category_id?: string | null;
  category_name?: string | null;
  category_color?: string | null;
  public: boolean;
  folder_id: string | null;
  issue_id: string | null;
  project_id?: string;
  project_name: string | null;
  issue_key: string | null;
  priority: string | null;
  target_date: string | null;
  schedule: LabItemSchedule;
  archived?: boolean;
  bounty_id?: string | null;
  bounty_status?: LabBountyStatus;
  bounty_detail_url?: string;
  is_bounty?: boolean;
  can_edit_issue?: boolean;
  can_open_issue?: boolean;
  estimated_reward?: string | null;
  reward_formula_version?: number | null;
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
  categories?: LabCategory[];
  default_category_id?: string | null;
  default_project_category_id?: string | null;
  items: LabItem[];
  projects: LabProject[];
  timezone: string;
  week_start: number;
  step_minutes: number;
};
export type LabCalendarColor = string;
export type LabEvent = {
  id: string;
  title: string;
  user_id: string;
  start: string;
  end: string;
  editable: boolean;
  revision?: number;
  color?: LabCalendarColor;
  category_id?: string | null;
  category_name?: string | null;
  category_color?: string | null;
  kind?: string;
  status?: LabStatus;
  item_id?: string;
  issue_id?: string;
  project_id?: string;
  bounty_id?: string | null;
  bounty_status?: LabBountyStatus;
  bounty_detail_url?: string;
  is_bounty?: boolean;
  can_open_issue?: boolean;
  can_edit_issue?: boolean;
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
  issue_id_snapshot?: string;
  title: string;
  deliverable: string;
  criteria: string;
  budget: string;
  claim_available?: string;
  reserved: string | null;
  awarded: string | null;
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
  access_level?: "project" | "task" | "public";
  public_summary?: string;
  issue_key?: string | null;
  detail_url?: string;
  category_color?: string | null;
  category_name?: string | null;
  can_edit_issue?: boolean;
  can_claim?: boolean;
  can_delete?: boolean;
  can_confirm?: boolean;
  can_submit?: boolean;
  can_manage_materials?: boolean;
  estimated_reward?: string | null;
  reward_formula_version?: number | null;
  stage_budget?: string;
  received_estimate?: { amount: string | null; formula_version: number | null; error?: string } | null;
  reward_estimate?: { amount: string | null; formula_version: number | null; error?: string } | null;
};
export type LabBountyMaterial = {
  id: string;
  kind: "document_version" | "attachment";
  label: string;
  shared_at?: string;
  url?: string;
  content?: string;
  [key: string]: unknown;
};
export type LabTask = { id: string; title: string; project_id: string; project: string; key: string };
export type LabTodo = { id: string; title: string; action: string; due_at: string | null; overdue: boolean };
