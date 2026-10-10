/** Copyright (c) 2026 OpenOceanAcoustic and contributors. SPDX-License-Identifier: AGPL-3.0-only */

import { makeAutoObservable, runInAction } from "mobx";
import type { LabContributionsCalendar, LabContributionsEntries, LabContributionsSummary } from "@plane/types";
import type { LabStore } from "./lab.store";

export function labContributionMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
}

export class LabContributionsStore {
  summary: LabContributionsSummary | undefined;
  calendar: LabContributionsCalendar | undefined;
  entries: LabContributionsEntries | undefined;
  selectedMonth = labContributionMonth();
  selectedProjectId = "";
  selectedDay = "";
  rangeBusy = false;
  summaryBusy = false;
  entriesBusy = false;
  private summaryError = "";
  private rangeError = "";
  private entriesError = "";
  private rangeSerial = 0;
  private summarySerial = 0;
  private entriesSerial = 0;

  constructor(readonly transport: LabStore) {
    makeAutoObservable(this, { transport: false }, { autoBind: true });
  }

  get error() {
    return this.summaryError || this.rangeError || this.entriesError;
  }

  async selectMonth(month: string) {
    this.selectedMonth = month;
    this.selectedDay = "";
    await this.loadRange();
  }

  async selectProject(projectId: string) {
    this.selectedProjectId = projectId;
    this.selectedDay = "";
    await this.loadRange();
  }

  async selectDay(day: string, projectId?: string) {
    const changedProject = projectId !== undefined && projectId !== this.selectedProjectId;
    if (projectId !== undefined) this.selectedProjectId = projectId;
    this.selectedDay = day;
    if (changedProject) await this.loadRange();
    else await this.loadEntries();
  }

  async refresh() {
    await Promise.all([this.loadSummary(), this.loadRange()]);
  }

  async loadMore() {
    if (this.entriesBusy || !this.entries?.next_cursor) return;
    await this.loadEntries(this.entries.next_cursor);
  }

  async loadSummary() {
    const serial = ++this.summarySerial;
    this.summaryBusy = true;
    this.summaryError = "";
    try {
      const summary = await this.transport.request<LabContributionsSummary>("me/contributions/");
      runInAction(() => {
        if (serial === this.summarySerial) this.summary = summary;
      });
    } catch (error) {
      runInAction(() => {
        if (serial === this.summarySerial) {
          this.summary = undefined;
          this.summaryError = error instanceof Error ? error.message : "个人 VC 汇总读取失败";
        }
      });
    } finally {
      runInAction(() => {
        if (serial === this.summarySerial) this.summaryBusy = false;
      });
    }
  }

  async loadRange() {
    const serial = ++this.rangeSerial;
    const entrySerial = ++this.entriesSerial;
    const query = new URLSearchParams({ month: this.selectedMonth });
    if (this.selectedProjectId) query.set("project_id", this.selectedProjectId);
    const entryQuery = new URLSearchParams(query);
    if (this.selectedDay) entryQuery.set("day", this.selectedDay);
    this.calendar = undefined;
    this.entries = undefined;
    this.rangeBusy = true;
    this.entriesBusy = true;
    this.rangeError = "";
    this.entriesError = "";
    try {
      const [calendar, entries] = await Promise.allSettled([
        this.transport.request<LabContributionsCalendar>(`me/contributions/calendar/?${query}`),
        this.transport.request<LabContributionsEntries>(`me/contributions/entries/?${entryQuery}`),
      ]);
      runInAction(() => {
        if (serial !== this.rangeSerial) return;
        if (calendar.status === "fulfilled") this.calendar = calendar.value;
        else this.rangeError = calendar.reason instanceof Error ? calendar.reason.message : "VC 日历读取失败";
        if (entrySerial !== this.entriesSerial) return;
        if (entries.status === "fulfilled") this.entries = entries.value;
        else this.entriesError = entries.reason instanceof Error ? entries.reason.message : "贡献记录读取失败";
      });
    } finally {
      runInAction(() => {
        if (serial !== this.rangeSerial) return;
        this.rangeBusy = false;
        if (entrySerial === this.entriesSerial) this.entriesBusy = false;
      });
    }
  }

  private async loadEntries(cursor?: string) {
    const serial = ++this.entriesSerial;
    const query = new URLSearchParams({ month: this.selectedMonth });
    if (this.selectedProjectId) query.set("project_id", this.selectedProjectId);
    if (this.selectedDay) query.set("day", this.selectedDay);
    if (cursor) query.set("cursor", cursor);
    else this.entries = undefined;
    this.entriesBusy = true;
    this.entriesError = "";
    try {
      const entries = await this.transport.request<LabContributionsEntries>(`me/contributions/entries/?${query}`);
      runInAction(() => {
        if (serial !== this.entriesSerial) return;
        if (cursor && this.entries) {
          const rows = new Map(this.entries.results.map((row) => [row.id, row]));
          for (const row of entries.results) rows.set(row.id, row);
          this.entries = { ...entries, results: [...rows.values()] };
        } else this.entries = entries;
      });
    } catch (error) {
      runInAction(() => {
        if (serial === this.entriesSerial)
          this.entriesError = error instanceof Error ? error.message : "贡献记录读取失败";
      });
    } finally {
      runInAction(() => {
        if (serial === this.entriesSerial) this.entriesBusy = false;
      });
    }
  }
}
