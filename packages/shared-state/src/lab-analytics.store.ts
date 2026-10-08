/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { makeAutoObservable, runInAction } from "mobx";
import type { LabAnalytics, LabAnalyticsFilter, LabChartDetails } from "@plane/types";
import type { LabStore } from "./lab.store";

export function labAnalyticsQuery(filters: LabAnalyticsFilter): URLSearchParams {
  const query = new URLSearchParams({ start: filters.start, end: filters.end });
  if (filters.projectId) query.set("project_id", filters.projectId);
  if (filters.userId) query.set("user_id", filters.userId);
  if (filters.team !== undefined) query.set("team", filters.team ? "1" : "0");
  return query;
}

export class LabAnalyticsStore {
  data: LabAnalytics | undefined;
  loadedFilters: LabAnalyticsFilter | undefined;
  projects: LabAnalytics["projects"] = [];
  members: LabAnalytics["members"] = [];
  canViewTeam = false;
  team = false;
  error = "";
  busy = false;
  private requestSerial = 0;

  constructor(readonly transport: LabStore) {
    makeAutoObservable(this, {}, { autoBind: true });
  }

  async load(filters: LabAnalyticsFilter) {
    const serial = ++this.requestSerial;
    this.busy = true;
    this.data = undefined;
    this.loadedFilters = undefined;
    this.error = "";
    try {
      const data = await this.transport.request<LabAnalytics>(`analytics/?${labAnalyticsQuery(filters)}`);
      runInAction(() => {
        if (serial === this.requestSerial) {
          this.data = data;
          this.loadedFilters = { ...filters };
          this.projects = data.projects;
          this.members = data.members;
          this.canViewTeam = data.can_view_team;
          this.team = data.team;
        }
      });
    } catch (error) {
      runInAction(() => {
        if (serial === this.requestSerial) this.error = error instanceof Error ? error.message : "图表加载失败";
      });
    } finally {
      runInAction(() => {
        if (serial === this.requestSerial) this.busy = false;
      });
    }
  }

  details(filters: LabAnalyticsFilter, chartId: string, key: string) {
    const query = labAnalyticsQuery(filters);
    query.set("chart", chartId);
    query.set("key", key);
    return this.transport.request<LabChartDetails>(`analytics/drilldown/?${query}`);
  }

  exportUrl(filters: LabAnalyticsFilter, format: "csv" | "json", chartId?: string, key?: string) {
    const query = labAnalyticsQuery(filters);
    if (format === "csv") query.set("format", "csv");
    if (chartId) query.set("chart", chartId);
    if (key) query.set("key", key);
    return `${this.transport.apiBase}/api/workspaces/${encodeURIComponent(this.transport.slug)}/lab/analytics/${key ? "drilldown/" : ""}?${query}`;
  }
}
