/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

export type LabVcTotals = { earned: string; reversed: string; net: string };

export type LabContributionProject = LabVcTotals & {
  id: string;
  name: string;
  participation: ("project" | "bounty" | "history")[];
  historical: boolean;
  can_open_project: boolean;
};

export type LabContributionsSummary = {
  timezone: string;
  totals: LabVcTotals;
  projects: LabContributionProject[];
};

export type LabContributionDay = LabVcTotals & {
  day: string;
  project_id: string;
  project: string;
  count: number;
};

export type LabContributionsCalendar = {
  timezone: string;
  month: string;
  totals: LabVcTotals;
  days: LabContributionDay[];
};

export type LabContributionEntry = {
  id: string;
  created_at: string;
  day: string;
  project_id: string;
  project: string;
  task_id: string;
  task_title: string;
  bounty_id: string;
  delta: string;
  kind: "award" | "reversal";
  reverses: string | null;
  archived: boolean;
  can_open_issue: boolean;
  can_open_bounty: boolean;
};

export type LabContributionsEntries = {
  timezone: string;
  results: LabContributionEntry[];
  next_cursor: string | null;
};
