/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import type { LabMember } from "./lab";

export type LabAnalyticsDomain = "project" | "schedule" | "vc";
export type LabChartRow = { id: string; label: string; [key: string]: string | number | null };
export type LabChart = {
  id: string;
  domain: LabAnalyticsDomain;
  title: string;
  kind: "donut" | "bar" | "line" | "stack" | "heatmap";
  unit: string;
  series: { key: string; label: string }[];
  columns: { key: string; label: string }[];
  rows: LabChartRow[];
  note: string;
  days?: string[];
  members?: LabMember[];
};
export type LabAnalytics = {
  timezone: string;
  range: { start: string; end: string };
  team: boolean;
  can_view_team: boolean;
  projects: { id: string; name: string }[];
  members: LabMember[];
  charts: LabChart[];
};
export type LabAnalyticsFilter = { start: string; end: string; projectId: string; userId: string; team?: boolean };
export type LabChartDetails = {
  chart: string;
  columns: { key: string; label: string }[];
  records: { title: string; url: string | null; [key: string]: string | number | null }[];
};
