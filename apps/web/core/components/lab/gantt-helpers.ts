/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */
export function ganttLabel(value: string): string {
  // The upstream SVG label API accepts innerHTML, so escape all user-controlled names.
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
export function ganttDay(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
export type LabGanttTask = {
  id: string;
  title: string;
  key: string;
  project_id: string;
  start_date: string | null;
  target_date: string | null;
  state: string;
  state_group: string;
  external_dependency: boolean;
};
export type LabGanttDependency = { id: string; predecessor_id: string; successor_id: string };
export type LabGanttData = { tasks: LabGanttTask[]; dependencies: LabGanttDependency[] };
export type LabGanttChange = {
  id: string;
  title: string;
  key: string;
  old_start_date: string | null;
  old_target_date: string | null;
  start_date: string;
  target_date: string;
};
